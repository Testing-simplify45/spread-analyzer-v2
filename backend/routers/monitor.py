"""
routers/monitor.py
==================
Live spread monitor endpoints — multi-strategy support.
Strategies: index_p1, index_p2, nfo_bfo, butterfly_index, butterfly_nfo
"""

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import date, timedelta
import os

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
    from services.monitor_scheduler import set_fyers_token
    set_fyers_token(client_id, access_token)
    return make_fyers(client_id, access_token)


def get_supabase():
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ── Formula ───────────────────────────────────────────────────────────────────

def compute_spread(strategy: str, ltp1, ltp2, ltp3, ratio: float, multiplier: float):
    """Compute spread value based on strategy."""
    r = ratio or 1.0
    m = multiplier or 3.3
    if ltp1 is None:
        return None
    if strategy in ("index_p1", "index_p2"):
        if ltp2 is None: return None
        return round(ltp1 - (ltp2 * r), 2)
    elif strategy == "nfo_bfo":
        if ltp2 is None: return None
        return round(ltp1 - (ltp2 * m * r), 2)
    elif strategy == "butterfly_index":
        if ltp2 is None or ltp3 is None: return None
        return round(ltp1 - (ltp2 * r) - (ltp2 * r) + ltp3, 2)
    elif strategy == "butterfly_nfo":
        if ltp2 is None or ltp3 is None: return None
        return round(ltp1 - (ltp2 * m * r) - (ltp2 * m * r) + ltp3, 2)
    return None


# ── Models ────────────────────────────────────────────────────────────────────

class MonitorSection(BaseModel):
    id:          str
    exchange:    str   = "NSE"
    index:       str   = "NIFTY"
    strategy:    str   = "index_p1"
    exp1:        str   = ""
    exp1_label:  str   = ""
    exp2:        str   = ""
    exp2_label:  str   = ""
    exp3:        str   = ""
    exp3_label:  str   = ""
    addon:       int   = 100
    ratio:       float = 1.0
    multiplier:  float = 3.3
    interval:    int   = 100
    d3_ranges:   dict  = {}


class SaveConfigRequest(BaseModel):
    sections: list[MonitorSection]
    user_id:  str = "default"


class FetchLiveRequest(BaseModel):
    exchange:   str
    index:      str
    exp1:       str
    exp2:       str
    exp3:       str   = ""
    addon:      int   = 100
    ce_strikes: list[int] = []
    pe_strikes: list[int] = []
    strategy:   str   = "index_p1"
    ratio:      float = 1.0
    multiplier: float = 3.3
    interval:   int   = 100


class FetchRangeRequest(BaseModel):
    exchange:   str
    index:      str
    exp1:       str
    exp2:       str
    exp3:       str   = ""
    ce_strikes: list[int] = []
    pe_strikes: list[int] = []
    strategy:   str   = "index_p1"
    ratio:      float = 1.0
    multiplier: float = 3.3
    days:       int   = 3


# ── Save/Load config ──────────────────────────────────────────────────────────

@router.get("/test-telegram")
def test_telegram():
    from services.telegram_service import send_telegram
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "NOT SET")
    chat  = os.environ.get("TELEGRAM_CHAT_ID",   "NOT SET")
    result = send_telegram(
        f"🧪 <b>Test Message</b>\n"
        f"Option Spread Analyzer connected!\n"
        f"Token: {'✅' if token != 'NOT SET' else '❌'}\n"
        f"Chat ID: {'✅' if chat != 'NOT SET' else '❌'}"
    )
    return {
        "sent":          result,
        "token_set":     token != "NOT SET",
        "chat_id_set":   chat  != "NOT SET",
        "token_preview": token[:15] + "..." if token != "NOT SET" else "NOT SET",
        "chat_id":       chat,
    }


@router.post("/config/save")
def save_config(body: SaveConfigRequest, authorization: str = Header(None)):
    _get_fyers(authorization)
    try:
        sb = get_supabase()
        sections_data = [s.dict() for s in body.sections]
        existing = sb.table("monitor_configs").select("id").eq("user_id", body.user_id).execute()
        if existing.data:
            sb.table("monitor_configs")\
                .update({"sections": sections_data, "updated_at": "now()"})\
                .eq("user_id", body.user_id).execute()
        else:
            sb.table("monitor_configs")\
                .insert({"user_id": body.user_id, "sections": sections_data}).execute()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config/load")
def load_config(user_id: str = "default", authorization: str = Header(None)):
    _get_fyers(authorization)
    try:
        sb = get_supabase()
        result = sb.table("monitor_configs").select("sections").eq("user_id", user_id).execute()
        if result.data:
            return {"sections": result.data[0]["sections"]}
        return {"sections": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── ATM ───────────────────────────────────────────────────────────────────────

@router.get("/atm/{index}")
def get_atm(index: str, addon: int = 100, authorization: str = Header(None)):
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import INDEX_SYMBOL, round_to_nearest
        sym = INDEX_SYMBOL.get(index.upper())
        if not sym:
            raise HTTPException(status_code=404, detail=f"Unknown index: {index}")
        resp = fyers.quotes(data={"symbols": sym})
        if resp.get("s") == "ok":
            v   = resp["d"][0].get("v", {})
            ltp = float(v.get("lp") or v.get("last_price") or 0)
            if ltp > 0:
                atm = round_to_nearest(ltp, addon)
                return {"spot": ltp, "atm": atm}
        raise HTTPException(status_code=404, detail="Could not fetch spot price")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Live spreads ──────────────────────────────────────────────────────────────

@router.post("/live")
def fetch_live_spreads(body: FetchLiveRequest, authorization: str = Header(None)):
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import build_symbol, get_batch_ltp

        exchange   = body.exchange
        index      = body.index
        strategy   = body.strategy
        ratio      = body.ratio
        multiplier = body.multiplier
        is_butterfly = strategy in ("butterfly_index", "butterfly_nfo")

        # Build all symbols
        all_syms = []
        sym_maps = {"ce": {}, "pe": {}}

        for opt_type, strikes in [("ce", body.ce_strikes), ("pe", body.pe_strikes)]:
            OT = opt_type.upper()
            for strike in strikes:
                s1 = build_symbol(exchange, index, body.exp1, strike, OT)
                s2 = build_symbol(exchange, index, body.exp2, strike, OT)
                sym_maps[opt_type][strike] = {"s1": s1, "s2": s2}
                all_syms += [s1, s2]
                if is_butterfly and body.exp3:
                    s3 = build_symbol(exchange, index, body.exp3, strike, OT)
                    sym_maps[opt_type][strike]["s3"] = s3
                    all_syms.append(s3)

        ltp_map = get_batch_ltp(fyers, list(set(all_syms)))

        results_ce, results_pe = [], []
        for opt_type, strikes, results in [
            ("ce", body.ce_strikes, results_ce),
            ("pe", body.pe_strikes, results_pe),
        ]:
            for strike in strikes:
                sm   = sym_maps[opt_type].get(strike, {})
                ltp1 = ltp_map.get(sm.get("s1"))
                ltp2 = ltp_map.get(sm.get("s2"))
                ltp3 = ltp_map.get(sm.get("s3")) if is_butterfly else None
                current = compute_spread(strategy, ltp1, ltp2, ltp3, ratio, multiplier)
                results.append({
                    "strike": strike, "opt_type": opt_type.upper(),
                    "current": current,
                    "ltp1": ltp1, "ltp2": ltp2, "ltp3": ltp3,
                    "prev_close": None, "change": None,
                })

        return {"ce": results_ce, "pe": results_pe}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Prev close ────────────────────────────────────────────────────────────────

@router.post("/prev-close")
def fetch_prev_close(body: FetchLiveRequest, authorization: str = Header(None)):
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import build_symbol, compute_spread_series

        yesterday = date.today() - timedelta(days=1)
        while yesterday.weekday() >= 5:
            yesterday -= timedelta(days=1)

        is_butterfly = body.strategy in ("butterfly_index", "butterfly_nfo")
        results = {}

        for opt_type, strikes in [("CE", body.ce_strikes), ("PE", body.pe_strikes)]:
            for strike in strikes:
                sym1 = build_symbol(body.exchange, body.index, body.exp1, strike, opt_type)
                sym2 = build_symbol(body.exchange, body.index, body.exp2, strike, opt_type)
                sym3 = build_symbol(body.exchange, body.index, body.exp3, strike, opt_type) if is_butterfly and body.exp3 else None
                df = compute_spread_series(fyers, sym1, sym2, yesterday, 1.0, "1", sym3=sym3,
                                           strategy=body.strategy, ratio=body.ratio, multiplier=body.multiplier)
                key = f"{strike}_{opt_type}"
                if not df.empty:
                    results[key] = round(float(df["spread"].iloc[-1]), 2)
                else:
                    results[key] = None

        return {"prev_close": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Range ─────────────────────────────────────────────────────────────────────

@router.post("/range")
def fetch_range(body: FetchRangeRequest, authorization: str = Header(None)):
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import build_symbol, compute_spread_series

        is_butterfly = body.strategy in ("butterfly_index", "butterfly_nfo")
        results = {}

        # FIX 1: Start from yesterday — never include today's candle
        def prev_trading_days(n: int) -> list:
            days_list = []
            d = date.today() - timedelta(days=1)  # start from yesterday
            while len(days_list) < n:
                if d.weekday() < 5:  # Mon-Fri only
                    days_list.append(d)
                d -= timedelta(days=1)
            return days_list

        for opt_type, strikes in [("CE", body.ce_strikes), ("PE", body.pe_strikes)]:
            for strike in strikes:
                sym1 = build_symbol(body.exchange, body.index, body.exp1, strike, opt_type)
                sym2 = build_symbol(body.exchange, body.index, body.exp2, strike, opt_type)
                sym3 = build_symbol(body.exchange, body.index, body.exp3, strike, opt_type) if is_butterfly and body.exp3 else None

                all_highs, all_lows = [], []

                # FIX 2: Try up to body.days but use whatever data is available
                # Try up to 2x days to find enough candles with real data
                trading_days = prev_trading_days(body.days * 2)

                for d in trading_days:
                    if len(all_highs) >= body.days:
                        break  # collected enough days with real data
                    df = compute_spread_series(fyers, sym1, sym2, d, 1.0, "1", sym3=sym3,
                                               strategy=body.strategy, ratio=body.ratio, multiplier=body.multiplier)
                    if not df.empty:
                        spreads = df["spread"].dropna().values
                        if len(spreads):
                            all_highs.append(float(spreads.max()))
                            all_lows.append(float(spreads.min()))

                key = f"{strike}_{opt_type}"
                # FIX 2: Return whatever we have (even if < requested days) instead of None
                results[key] = {
                    "high": round(max(all_highs), 2) if all_highs else None,
                    "low":  round(min(all_lows),  2) if all_lows  else None,
                    "days_used": len(all_highs),  # so frontend knows how many days were used
                }

        return {"ranges": results, "days": body.days}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
