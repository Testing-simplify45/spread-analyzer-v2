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

def compute_spread(strategy: str, ltp1, ltp2, ltp3, ratio: float, multiplier: float = 3.3):
    """
    Compute spread value based on strategy.
    NFO/BFO:       L1 - (L2 * ratio)
    Butterfly NFO: [L1 - (L2*ratio)] + [L3 - (L2*ratio)]
    For NFO/BFO: L2 strike is derived from L1/multiplier rounded to nearest 50
    """
    r = ratio or 1.0
    if ltp1 is None:
        return None
    if strategy in ("index_p1", "index_p2"):
        if ltp2 is None: return None
        return round(ltp1 - (ltp2 * r), 2)
    elif strategy == "nfo_bfo":
        if ltp2 is None: return None
        return round(ltp1 - (ltp2 * r), 2)
    elif strategy == "butterfly_index":
        if ltp2 is None or ltp3 is None: return None
        return round(ltp1 - (ltp2 * r) - (ltp2 * r) + ltp3, 2)
    elif strategy == "butterfly_nfo":
        # [L1 - (L2*ratio)] + [L3 - (L2*ratio)]
        if ltp2 is None or ltp3 is None: return None
        return round((ltp1 - (ltp2 * r)) + (ltp3 - (ltp2 * r)), 2)
    return None


# ── Models ────────────────────────────────────────────────────────────────────

def round_to_nearest_50(value: float) -> int:
    """Round a value to the nearest 50."""
    return int(round(value / 50) * 50)


def derive_l2_strike(l1_strike: int, multiplier: float) -> int:
    """Derive L2 strike from L1 using multiplier, rounded to nearest 50."""
    return round_to_nearest_50(l1_strike / multiplier)


class MonitorSection(BaseModel):
    id:           str
    exchange:     str   = "NSE"
    index:        str   = "NIFTY"
    index2:       str   = "NIFTY"       # L2 index for multi-index strategies
    strategy:     str   = "index_p1"
    exp1:         str   = ""
    exp1_label:   str   = ""
    exp2:         str   = ""
    exp2_label:   str   = ""
    exp3:         str   = ""
    exp3_label:   str   = ""
    exp_l2a:      str   = ""            # L2 near expiry (multi-index)
    exp_l2b:      str   = ""            # L2 far expiry (butterfly multi-index)
    addon:        int   = 100
    ratio:        float = 1.0
    multiplier:   float = 3.3
    interval:     int   = 100
    pc_mode:      str   = "default"     # 'default' | 'custom'
    pc_threshold: float = 10.0
    d3_ranges:    dict  = {}


class SaveConfigRequest(BaseModel):
    sections: list[MonitorSection]
    user_id:  str = "default"


class FetchLiveRequest(BaseModel):
    exchange1:  str   = "NSE"
    exchange2:  str   = "NSE"
    index1:     str   = "NIFTY"
    index2:     str   = "NIFTY"
    exp1:       str   = ""
    exp2:       str   = ""
    exp3:       str   = ""
    exp_l2a:    str   = ""
    exp_l2b:    str   = ""
    addon:      int   = 100
    ce_strikes: list[int] = []
    pe_strikes: list[int] = []
    strategy:   str   = "index_p1"
    ratio:      float = 1.0
    multiplier: float = 3.3
    interval:   int   = 100


class FetchRangeRequest(BaseModel):
    exchange1:  str   = "NSE"
    exchange2:  str   = "NSE"
    index1:     str   = "NIFTY"
    index2:     str   = "NIFTY"
    exp1:       str   = ""
    exp2:       str   = ""
    exp3:       str   = ""
    exp_l2a:    str   = ""
    exp_l2b:    str   = ""
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

        strategy     = body.strategy
        ratio        = body.ratio
        multiplier   = body.multiplier
        is_butterfly = strategy in ("butterfly_index", "butterfly_nfo")
        is_multi_idx = strategy in ("nfo_bfo", "butterfly_nfo")

        # For multi-index: L1/L3 use index1, L2 uses index2 with derived strike
        # For single-index: all legs use index1

        all_syms = []
        sym_maps = {"ce": {}, "pe": {}}

        for opt_type, l1_strikes in [("ce", body.ce_strikes), ("pe", body.pe_strikes)]:
            OT = opt_type.upper()
            for l1_strike in l1_strikes:
                # L2 strike derived from L1 for multi-index strategies
                l2_strike = derive_l2_strike(l1_strike, multiplier) if is_multi_idx else l1_strike

                # L1 symbol
                s1 = build_symbol(body.exchange1, body.index1, body.exp1, l1_strike, OT)
                # L2 symbol — uses index2 and derived strike for multi-index
                exp_l2 = body.exp_l2a if is_multi_idx and body.exp_l2a else body.exp2
                s2 = build_symbol(body.exchange2, body.index2, exp_l2, l2_strike, OT)

                sym_maps[opt_type][l1_strike] = {"s1": s1, "s2": s2, "l2_strike": l2_strike}
                all_syms += [s1, s2]

                if is_butterfly:
                    if is_multi_idx:
                        # L3 = index1, exp3; L2b = index2 far
                        s3 = build_symbol(body.exchange1, body.index1, body.exp3, l1_strike, OT)
                        exp_l2b = body.exp_l2b if body.exp_l2b else exp_l2
                        s2b = build_symbol(body.exchange2, body.index2, exp_l2b, l2_strike, OT)
                        sym_maps[opt_type][l1_strike]["s3"]  = s3
                        sym_maps[opt_type][l1_strike]["s2b"] = s2b
                        all_syms += [s3, s2b]
                    else:
                        s3 = build_symbol(body.exchange1, body.index1, body.exp3, l1_strike, OT)
                        sym_maps[opt_type][l1_strike]["s3"] = s3
                        all_syms.append(s3)

        ltp_map = get_batch_ltp(fyers, list(set(all_syms)))

        results_ce, results_pe = [], []
        for opt_type, l1_strikes, results in [
            ("ce", body.ce_strikes, results_ce),
            ("pe", body.pe_strikes, results_pe),
        ]:
            for l1_strike in l1_strikes:
                sm   = sym_maps[opt_type].get(l1_strike, {})
                ltp1 = ltp_map.get(sm.get("s1"))
                ltp2 = ltp_map.get(sm.get("s2"))
                ltp3 = ltp_map.get(sm.get("s3")) if is_butterfly else None

                # For butterfly_nfo: average L2 legs if both available
                if strategy == "butterfly_nfo" and sm.get("s2b"):
                    ltp2b = ltp_map.get(sm["s2b"])
                    if ltp2 is not None and ltp2b is not None:
                        ltp2 = (ltp2 + ltp2b) / 2  # average of near and far L2

                current = compute_spread(strategy, ltp1, ltp2, ltp3, ratio, multiplier)
                results.append({
                    "strike": l1_strike,
                    "l2_strike": sm.get("l2_strike"),
                    "opt_type": opt_type.upper(),
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

        is_butterfly  = body.strategy in ("butterfly_index", "butterfly_nfo")
        is_multi_idx  = body.strategy in ("nfo_bfo", "butterfly_nfo")
        results = {}

        for opt_type, l1_strikes in [("CE", body.ce_strikes), ("PE", body.pe_strikes)]:
            for l1_strike in l1_strikes:
                l2_strike = derive_l2_strike(l1_strike, body.multiplier) if is_multi_idx else l1_strike
                exp_l2    = body.exp_l2a if is_multi_idx and body.exp_l2a else body.exp2

                sym1 = build_symbol(body.exchange1, body.index1, body.exp1, l1_strike, opt_type)
                sym2 = build_symbol(body.exchange2, body.index2, exp_l2, l2_strike, opt_type)
                sym3 = None
                if is_butterfly:
                    sym3 = build_symbol(body.exchange1, body.index1, body.exp3, l1_strike, opt_type)

                df = compute_spread_series(fyers, sym1, sym2, yesterday, 1.0, "1", sym3=sym3,
                                           strategy=body.strategy, ratio=body.ratio, multiplier=body.multiplier)
                key = f"{l1_strike}_{opt_type}"
                results[key] = round(float(df["spread"].iloc[-1]), 2) if not df.empty else None

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

        def prev_trading_days(n: int) -> list:
            """Return up to n*4 previous trading days to ensure enough data."""
            days_list = []
            d = date.today() - timedelta(days=1)  # start from yesterday
            # Look back up to n*4 trading days to find enough candles
            max_days = n * 4 * 2  # generous lookback
            attempts = 0
            while len(days_list) < n * 4 and attempts < max_days:
                if d.weekday() < 5:
                    days_list.append(d)
                d -= timedelta(days=1)
                attempts += 1
            return days_list

        is_multi_idx = body.strategy in ("nfo_bfo", "butterfly_nfo")

        for opt_type, l1_strikes in [("CE", body.ce_strikes), ("PE", body.pe_strikes)]:
            for l1_strike in l1_strikes:
                l2_strike = derive_l2_strike(l1_strike, body.multiplier) if is_multi_idx else l1_strike
                exp_l2    = body.exp_l2a if is_multi_idx and body.exp_l2a else body.exp2

                sym1 = build_symbol(body.exchange1, body.index1, body.exp1, l1_strike, opt_type)
                sym2 = build_symbol(body.exchange2, body.index2, exp_l2, l2_strike, opt_type)
                sym3 = None
                if is_butterfly:
                    sym3 = build_symbol(body.exchange1, body.index1, body.exp3, l1_strike, opt_type)

                all_highs, all_lows = [], []
                trading_days = prev_trading_days(body.days * 2)

                for d in trading_days:
                    if len(all_highs) >= body.days:
                        break
                    df = compute_spread_series(fyers, sym1, sym2, d, 1.0, "1", sym3=sym3,
                                               strategy=body.strategy, ratio=body.ratio, multiplier=body.multiplier)
                    if not df.empty:
                        spreads = df["spread"].dropna().values
                        if len(spreads):
                            all_highs.append(float(spreads.max()))
                            all_lows.append(float(spreads.min()))

                key = f"{l1_strike}_{opt_type}"
                results[key] = {
                    "high": round(max(all_highs), 2) if all_highs else None,
                    "low":  round(min(all_lows),  2) if all_lows  else None,
                    "days_used": len(all_highs),
                }

        return {"ranges": results, "days": body.days}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
