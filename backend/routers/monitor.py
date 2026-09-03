"""
routers/monitor.py
==================
Live spread monitor endpoints.
- Save/load monitor configurations
- Fetch live spread data for all sections
- Compute 3D/5D ranges
"""

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import date, timedelta
import os
import pandas as pd

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

router = APIRouter()


def _get_fyers(authorization: str):
    from services.fyers_service import make_fyers
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    parts = authorization.split("|")
    if len(parts) != 2:
        raise HTTPException(status_code=401, detail="Token format: client_id|access_token")
    client_id, access_token = parts[0].replace("Bearer ", ""), parts[1]
    # Store token for background scheduler
    from services.monitor_scheduler import set_fyers_token
    set_fyers_token(client_id, access_token)
    return make_fyers(client_id, access_token)


def get_supabase():
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ── Models ────────────────────────────────────────────────────────────────────

class MonitorSection(BaseModel):
    id:       str
    exchange: str = "NSE"
    index:    str = "NIFTY"
    exp1:     str = ""
    exp1_label: str = ""
    exp2:     str = ""
    exp2_label: str = ""
    addon:    int = 100
    d3_ranges: dict = {}


class SaveConfigRequest(BaseModel):
    sections: list[MonitorSection]
    user_id:  str = "default"


class FetchLiveRequest(BaseModel):
    exchange: str
    index:    str
    exp1:     str
    exp2:     str
    addon:    int = 100
    strikes:  list[int] = []


class FetchRangeRequest(BaseModel):
    exchange: str
    index:    str
    exp1:     str
    exp2:     str
    strikes:  list[int]
    days:     int = 3


# ── Save/Load configs ─────────────────────────────────────────────────────────

@router.get("/test-telegram")
def test_telegram(authorization: str = Header(None)):
    """Send a test Telegram message."""
    _get_fyers(authorization)
    from services.telegram_service import send_telegram
    import os
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "NOT SET")
    chat  = os.environ.get("TELEGRAM_CHAT_ID", "NOT SET")
    result = send_telegram(
        f"🧪 <b>Test Message</b>\n"
        f"Option Spread Analyzer is connected!\n"
        f"Token configured: {'✅' if token != 'NOT SET' else '❌'}\n"
        f"Chat ID configured: {'✅' if chat != 'NOT SET' else '❌'}"
    )
    return {
        "sent": result,
        "token_set": token != "NOT SET",
        "chat_id_set": chat != "NOT SET",
        "token_preview": token[:10] + "..." if token != "NOT SET" else "NOT SET",
        "chat_id": chat,
    }
def save_config(body: SaveConfigRequest, authorization: str = Header(None)):
    """Save monitor sections to Supabase."""
    _get_fyers(authorization)
    try:
        sb = get_supabase()
        sections_data = [s.dict() for s in body.sections]

        # Upsert config for this user
        existing = sb.table("monitor_configs")\
            .select("id")\
            .eq("user_id", body.user_id)\
            .execute()

        if existing.data:
            sb.table("monitor_configs")\
                .update({"sections": sections_data, "updated_at": "now()"})\
                .eq("user_id", body.user_id)\
                .execute()
        else:
            sb.table("monitor_configs")\
                .insert({"user_id": body.user_id, "sections": sections_data})\
                .execute()

        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/load")
def load_config(user_id: str = "default", authorization: str = Header(None)):
    """Load monitor sections from Supabase."""
    _get_fyers(authorization)
    try:
        sb = get_supabase()
        result = sb.table("monitor_configs")\
            .select("sections")\
            .eq("user_id", user_id)\
            .execute()

        if result.data:
            return {"sections": result.data[0]["sections"]}
        return {"sections": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── ATM detection ─────────────────────────────────────────────────────────────

@router.get("/atm/{index}")
def get_atm(index: str, addon: int = 100, authorization: str = Header(None)):
    """Get ATM strike from live spot price."""
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import INDEX_SYMBOL, round_to_nearest
        sym  = INDEX_SYMBOL.get(index.upper())
        if not sym:
            raise HTTPException(status_code=404, detail=f"Unknown index: {index}")

        resp = fyers.quotes(data={"symbols": sym})
        if resp.get("s") == "ok":
            v   = resp["d"][0].get("v", {})
            ltp = float(v.get("lp") or v.get("last_price") or 0)
            if ltp > 0:
                atm = round_to_nearest(ltp, addon)
                # Generate 2 ITM + ATM + 4 OTM
                strikes = [
                    atm - 2*addon, atm - addon, atm,
                    atm + addon, atm + 2*addon, atm + 3*addon, atm + 4*addon
                ]
                return {"spot": ltp, "atm": atm, "strikes": strikes}

        raise HTTPException(status_code=404, detail="Could not fetch spot price")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Live spread data ──────────────────────────────────────────────────────────

@router.post("/live")
def fetch_live_spreads(body: FetchLiveRequest, authorization: str = Header(None)):
    """
    Fetch live spread LTP for all strikes and both CE/PE.
    Returns current spread + prev close for each strike.
    """
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import build_symbol, get_batch_ltp, get_candles

        exchange = body.exchange
        index    = body.index
        strikes  = body.strikes

        # Build all symbols for batch call
        sym1_list_ce, sym2_list_ce = [], []
        sym1_list_pe, sym2_list_pe = [], []

        for strike in strikes:
            sym1_list_ce.append(build_symbol(exchange, index, body.exp1, strike, "CE"))
            sym2_list_ce.append(build_symbol(exchange, index, body.exp2, strike, "CE"))
            sym1_list_pe.append(build_symbol(exchange, index, body.exp1, strike, "PE"))
            sym2_list_pe.append(build_symbol(exchange, index, body.exp2, strike, "PE"))

        all_syms = sym1_list_ce + sym2_list_ce + sym1_list_pe + sym2_list_pe
        ltp_map  = get_batch_ltp(fyers, all_syms)

        # Get yesterday's close for prev close
        yesterday = date.today() - timedelta(days=1)
        while yesterday.weekday() >= 5:
            yesterday -= timedelta(days=1)

        results_ce = []
        results_pe = []

        for i, strike in enumerate(strikes):
            # CE spread
            ltp1_ce = ltp_map.get(sym1_list_ce[i])
            ltp2_ce = ltp_map.get(sym2_list_ce[i])
            current_ce = round(ltp1_ce - ltp2_ce, 2) if ltp1_ce and ltp2_ce else None

            # PE spread
            ltp1_pe = ltp_map.get(sym1_list_pe[i])
            ltp2_pe = ltp_map.get(sym2_list_pe[i])
            current_pe = round(ltp1_pe - ltp2_pe, 2) if ltp1_pe and ltp2_pe else None

            results_ce.append({
                "strike": strike, "opt_type": "CE",
                "current": current_ce,
                "ltp1": ltp1_ce, "ltp2": ltp2_ce,
                "prev_close": None,  # Fetched separately
                "change": None,
            })
            results_pe.append({
                "strike": strike, "opt_type": "PE",
                "current": current_pe,
                "ltp1": ltp1_pe, "ltp2": ltp2_pe,
                "prev_close": None,
                "change": None,
            })

        return {"ce": results_ce, "pe": results_pe}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Prev close ────────────────────────────────────────────────────────────────

@router.post("/prev-close")
def fetch_prev_close(body: FetchLiveRequest, authorization: str = Header(None)):
    """Fetch yesterday's closing spread for all strikes."""
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import build_symbol, get_candles, compute_spread_series

        yesterday = date.today() - timedelta(days=1)
        while yesterday.weekday() >= 5:
            yesterday -= timedelta(days=1)

        results = {}
        for strike in body.strikes:
            for opt_type in ["CE", "PE"]:
                sym1 = build_symbol(body.exchange, body.index, body.exp1, strike, opt_type)
                sym2 = build_symbol(body.exchange, body.index, body.exp2, strike, opt_type)
                df   = compute_spread_series(fyers, sym1, sym2, yesterday, 1.0, "1")
                if not df.empty:
                    results[f"{strike}_{opt_type}"] = round(float(df["spread"].iloc[-1]), 2)
                else:
                    results[f"{strike}_{opt_type}"] = None

        return {"prev_close": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── 3D/5D Range ───────────────────────────────────────────────────────────────

@router.post("/range")
def fetch_range(body: FetchRangeRequest, authorization: str = Header(None)):
    """
    Fetch high/low across last N trading days for all strikes.
    """
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import build_symbol, compute_spread_series

        results = {}

        for strike in body.strikes:
            for opt_type in ["CE", "PE"]:
                sym1 = build_symbol(body.exchange, body.index, body.exp1, strike, opt_type)
                sym2 = build_symbol(body.exchange, body.index, body.exp2, strike, opt_type)

                all_highs, all_lows = [], []
                d = date.today()
                collected = 0

                while collected < body.days:
                    if d.weekday() < 5:
                        df = compute_spread_series(fyers, sym1, sym2, d, 1.0, "1")
                        if not df.empty:
                            spreads = df["spread"].dropna().values
                            if len(spreads):
                                all_highs.append(float(spreads.max()))
                                all_lows.append(float(spreads.min()))
                        collected += 1
                    d -= timedelta(days=1)

                key = f"{strike}_{opt_type}"
                if all_highs and all_lows:
                    results[key] = {
                        "high": round(max(all_highs), 2),
                        "low":  round(min(all_lows),  2),
                    }
                else:
                    results[key] = {"high": None, "low": None}

        return {"ranges": results, "days": body.days}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
