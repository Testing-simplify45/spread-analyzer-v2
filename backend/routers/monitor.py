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


# ── Candle fetching: one ranged call per symbol ───────────────────────────────
# Fyers allows up to 100 days per request at 1-min resolution. The old code
# requested a single day per call, so a 5-day window across 8 strikes fired
# ~80 requests. We now fetch the whole window per symbol in ONE call and split
# it by day locally, which cuts request volume by roughly 5x.
_range_cache: dict = {}
_range_stamp: dict = {}
_CACHE_TTL_SEC = 900          # completed sessions don't change
_last_call_ts = [0.0]
_last_candle_error = [None]   # last history failure, surfaced to the UI
_MIN_GAP_SEC = 0.25           # spacing between history calls


def _fetch_candles_range(fyers, symbol: str, start_date, end_date, resolution: str = "1"):
    """
    Fetch candles for symbol across [start_date, end_date] in one call.
    Returns {date_obj: DataFrame} split by session day.
    """
    import time
    import pandas as pd

    key = (symbol, str(start_date), str(end_date), resolution)
    now = time.time()
    stamped = _range_stamp.get(key)
    if stamped and (now - stamped) < _CACHE_TTL_SEC:
        return _range_cache.get(key, {})

    gap = time.time() - _last_call_ts[0]
    if gap < _MIN_GAP_SEC:
        time.sleep(_MIN_GAP_SEC - gap)

    by_day: dict = {}
    try:
        resp = fyers.history(data={
            "symbol":      symbol,
            "resolution":  str(resolution),
            "date_format": "1",
            "range_from":  start_date.strftime("%Y-%m-%d"),
            "range_to":    end_date.strftime("%Y-%m-%d"),
            "cont_flag":   "1",
        })
        _last_call_ts[0] = time.time()

        if resp.get("s") != "ok":
            # Surface the reason instead of silently returning empty —
            # a 429 looks identical to "no data" otherwise.
            code, msg = resp.get("code"), resp.get("message")
            _last_candle_error[0] = f"Fyers history API: code={code} {msg}"
            print(f"[Candles] {symbol} {start_date}..{end_date} -> {code} {msg}")
            return {}

        raw = resp.get("candles") or []
        if not raw:
            return {}

        ncol = len(raw[0])
        cols = ["timestamp", "open", "high", "low", "close", "volume"]
        if ncol > 6:
            cols.append("extra")
        df = pd.DataFrame(raw, columns=cols[:ncol])
        df["datetime"] = (
            pd.to_datetime(df["timestamp"], unit="s")
            .dt.tz_localize("UTC")
            .dt.tz_convert("Asia/Kolkata")
            .dt.tz_localize(None)
        )
        df = df[["datetime", "open", "high", "low", "close", "volume"]].set_index("datetime")

        for day, chunk in df.groupby(df.index.date):
            by_day[day] = chunk

        _range_cache[key] = by_day
        _range_stamp[key] = time.time()
    except Exception as e:
        _last_call_ts[0] = time.time()
        print(f"[Candles] {symbol} range fetch failed: {e}")

    return by_day


def spread_from_frames(df1, df2, strategy, ratio, df3=None, df2b=None):
    """
    Compute a spread series from already-fetched candle frames for ONE day.

    Returns 'spread' (close-based) plus 'spread_high'/'spread_low'.

    IMPORTANT: use 'spread' for 3D/5D ranges. The _high/_low columns pair each
    leg at its most favourable extreme within the same minute (leg1 high vs
    leg2 low). Those extremes occur at different seconds, so that combination
    never traded — it is a theoretical envelope, not an observed price, and it
    overstates the range badly on multi-leg spreads. The strategy-page charts
    aggregate 'spread', so ranges must use it too or the two pages disagree.
    """
    import pandas as pd

    if df1 is None or df2 is None or df1.empty or df2.empty:
        return pd.DataFrame()

    df1 = df1[~df1.index.duplicated(keep="last")]
    df2 = df2[~df2.index.duplicated(keep="last")]
    common = df1.index.intersection(df2.index)

    if df3 is not None:
        if df3.empty:
            return pd.DataFrame()
        df3 = df3[~df3.index.duplicated(keep="last")]
        common = common.intersection(df3.index)
    if df2b is not None:
        if df2b.empty:
            return pd.DataFrame()
        df2b = df2b[~df2b.index.duplicated(keep="last")]
        common = common.intersection(df2b.index)

    if common.empty:
        return pd.DataFrame()

    r = ratio or 1.0
    c1, h1, l1 = df1.loc[common, "close"], df1.loc[common, "high"], df1.loc[common, "low"]
    c2, h2, l2 = df2.loc[common, "close"], df2.loc[common, "high"], df2.loc[common, "low"]

    # butterfly_nfo averages the two L2 legs
    if df2b is not None:
        c2 = (c2 + df2b.loc[common, "close"]) / 2
        h2 = (h2 + df2b.loc[common, "high"])  / 2
        l2 = (l2 + df2b.loc[common, "low"])   / 2

    if strategy in ("index_p1", "index_p2", "nfo_bfo"):
        spread      = c1 - c2 * r
        spread_high = h1 - l2 * r
        spread_low  = l1 - h2 * r
    elif strategy == "butterfly_index":
        c3, h3, l3 = df3.loc[common, "close"], df3.loc[common, "high"], df3.loc[common, "low"]
        spread      = c1 - (c2 * r) - (c2 * r) + c3
        spread_high = h1 - (l2 * r) - (l2 * r) + h3
        spread_low  = l1 - (h2 * r) - (h2 * r) + l3
    elif strategy == "butterfly_nfo":
        # [L1 - (L2*r)] + [L3 - (L2*r)]
        c3, h3, l3 = df3.loc[common, "close"], df3.loc[common, "high"], df3.loc[common, "low"]
        spread      = (c1 - c2 * r) + (c3 - c2 * r)
        spread_high = (h1 - l2 * r) + (h3 - l2 * r)
        spread_low  = (l1 - h2 * r) + (l3 - h2 * r)
    else:
        return pd.DataFrame()

    return pd.DataFrame({
        "timestamp":   common,
        "spread":      spread.values,
        "spread_high": spread_high.values,
        "spread_low":  spread_low.values,
    })


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
    fl_mode:      str   = "atm"         # 'atm' | 'custom' — first-leg base strike
    fl_strike:    Optional[str] = ""    # custom base strike when fl_mode='custom'
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
    """
    Resolve the ATM strike from the live spot price.
    Surfaces the real Fyers error instead of flattening everything into a 404,
    so quota exhaustion and token expiry are distinguishable in the logs.
    """
    import time
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import INDEX_SYMBOL, round_to_nearest

        sym = INDEX_SYMBOL.get(index.upper())
        if not sym:
            raise HTTPException(status_code=404, detail=f"Unknown index: {index}")

        last = None
        for attempt in range(3):
            resp = fyers.quotes(data={"symbols": sym})
            last = resp

            if resp.get("s") == "ok":
                v = (resp.get("d") or [{}])[0].get("v", {})
                ltp = float(v.get("lp") or v.get("last_price") or 0)
                if ltp > 0:
                    return {"spot": ltp, "atm": round_to_nearest(ltp, addon)}
                print(f"[ATM] {index} returned ok but ltp=0 (market closed?)")
                break

            code = resp.get("code")
            msg  = resp.get("message", "")
            print(f"[ATM] {index} attempt {attempt+1}/3 -> code={code} msg={msg}")

            # 429 = rate limited, worth retrying. Auth errors are not.
            if code == 429 or "limit" in str(msg).lower():
                time.sleep(1.5 * (attempt + 1))
                continue
            break

        code = (last or {}).get("code")
        msg  = (last or {}).get("message", "no message")

        if code == 429 or "limit" in str(msg).lower():
            raise HTTPException(
                status_code=429,
                detail=f"Fyers rate limit reached while fetching {index} spot. "
                       f"Wait a few minutes and retry. ({msg})"
            )
        if code in (401, 403) or "token" in str(msg).lower() or "auth" in str(msg).lower():
            raise HTTPException(
                status_code=401,
                detail=f"Fyers token rejected — please log in again. ({msg})"
            )

        raise HTTPException(
            status_code=404,
            detail=f"Could not fetch {index} spot price. Fyers said: code={code} {msg}"
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ATM] {index} unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Diagnostics ───────────────────────────────────────────────────────────────

@router.get("/diag")
def diagnose(index: str = "NIFTY", exp1: str = "", strike: int = 0,
             opt_type: str = "CE", authorization: str = Header(None)):
    """
    One-shot health check for the history API.
    Makes a single-day call and a multi-day call for the same symbol and
    returns Fyers' raw reply for each, so we can see exactly what is failing.
    Example: /api/monitor/diag?index=NIFTY&exp1=25SEP&strike=24000&opt_type=CE
    """
    fyers = _get_fyers(authorization)
    out = {}

    try:
        from services.fyers_service import build_symbol, INDEX_SYMBOL

        # 1. Quotes — this is what /live uses and it currently works
        spot_sym = INDEX_SYMBOL.get(index.upper())
        q = fyers.quotes(data={"symbols": spot_sym})
        out["quotes"] = {"symbol": spot_sym, "s": q.get("s"),
                         "code": q.get("code"), "message": q.get("message")}

        if not exp1 or not strike:
            out["note"] = "Pass exp1 and strike to also test the history API."
            return out

        sym = build_symbol("NSE" if index.upper() != "SENSEX" else "BSE",
                           index.upper(), exp1, strike, opt_type)
        out["option_symbol"] = sym

        # Most recent completed weekday
        d = date.today() - timedelta(days=1)
        while d.weekday() >= 5:
            d -= timedelta(days=1)

        # 2. Single-day history (what the ORIGINAL code did)
        r1 = fyers.history(data={
            "symbol": sym, "resolution": "1", "date_format": "1",
            "range_from": d.strftime("%Y-%m-%d"),
            "range_to":   d.strftime("%Y-%m-%d"),
            "cont_flag": "1",
        })
        out["history_single_day"] = {
            "date": str(d), "s": r1.get("s"), "code": r1.get("code"),
            "message": r1.get("message"),
            "candle_count": len(r1.get("candles") or []),
        }

        # 3. Multi-day history (what the NEW code does)
        start = d - timedelta(days=10)
        r2 = fyers.history(data={
            "symbol": sym, "resolution": "1", "date_format": "1",
            "range_from": start.strftime("%Y-%m-%d"),
            "range_to":   d.strftime("%Y-%m-%d"),
            "cont_flag": "1",
        })
        candles2 = r2.get("candles") or []
        out["history_multi_day"] = {
            "range": f"{start} .. {d}", "s": r2.get("s"), "code": r2.get("code"),
            "message": r2.get("message"),
            "candle_count": len(candles2),
        }

        # 4. Which distinct sessions came back in the multi-day call
        if candles2:
            import pandas as pd
            ts = pd.to_datetime([c[0] for c in candles2], unit="s", utc=True)
            ts = ts.tz_convert("Asia/Kolkata").tz_localize(None)
            out["history_multi_day"]["distinct_days"] = sorted(
                {str(x) for x in pd.Series(ts).dt.date}
            )
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"

    return out


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
        from services.fyers_service import build_symbol

        # Most recent completed trading day
        yesterday = date.today() - timedelta(days=1)
        while yesterday.weekday() >= 5:
            yesterday -= timedelta(days=1)

        is_butterfly = body.strategy in ("butterfly_index", "butterfly_nfo")
        is_multi_idx = body.strategy in ("nfo_bfo", "butterfly_nfo")
        results = {}

        for opt_type, l1_strikes in [("CE", body.ce_strikes), ("PE", body.pe_strikes)]:
            for l1_strike in l1_strikes:
                key = f"{l1_strike}_{opt_type}"
                try:
                    l2_strike = derive_l2_strike(l1_strike, body.multiplier) if is_multi_idx else l1_strike
                    exp_l2    = body.exp_l2a if is_multi_idx and body.exp_l2a else body.exp2

                    sym1 = build_symbol(body.exchange1, body.index1, body.exp1, l1_strike, opt_type)
                    sym2 = build_symbol(body.exchange2, body.index2, exp_l2, l2_strike, opt_type)
                    sym3 = sym2b = None
                    if is_butterfly:
                        sym3 = build_symbol(body.exchange1, body.index1, body.exp3, l1_strike, opt_type)
                        if is_multi_idx and body.exp_l2b:
                            sym2b = build_symbol(body.exchange2, body.index2, body.exp_l2b, l2_strike, opt_type)

                    # Reuses the range cache when Range was clicked first
                    d1 = _fetch_candles_range(fyers, sym1, yesterday, yesterday).get(yesterday)
                    d2 = _fetch_candles_range(fyers, sym2, yesterday, yesterday).get(yesterday)
                    d3 = _fetch_candles_range(fyers, sym3, yesterday, yesterday).get(yesterday) if sym3 else None
                    d2b = _fetch_candles_range(fyers, sym2b, yesterday, yesterday).get(yesterday) if sym2b else None

                    df = spread_from_frames(d1, d2, body.strategy, body.ratio, df3=d3, df2b=d2b)
                    results[key] = round(float(df["spread"].iloc[-1]), 2) if not df.empty else None
                except Exception as inner:
                    print(f"[PrevClose] {key} failed: {inner}")
                    results[key] = None

        return {"prev_close": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/range")
def fetch_range(body: FetchRangeRequest, authorization: str = Header(None)):
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import build_symbol

        is_butterfly = body.strategy in ("butterfly_index", "butterfly_nfo")
        is_multi_idx = body.strategy in ("nfo_bfo", "butterfly_nfo")

        def prev_trading_days(n: int) -> list:
            """Previous trading days, most recent first. Never includes today."""
            out = []
            d = date.today() - timedelta(days=1)
            attempts = 0
            while len(out) < n and attempts < 30:
                if d.weekday() < 5:
                    out.append(d)
                d -= timedelta(days=1)
                attempts += 1
            return out

        # Walk 5 days once; derive both 3D and 5D from the same candles.
        want_days    = max(5, body.days)
        trading_days = prev_trading_days(want_days + 3)   # buffer for holidays
        if not trading_days:
            return {"ranges": {}, "ranges_3d": {}, "ranges_5d": {}, "days": body.days}

        window_start = min(trading_days)
        window_end   = max(trading_days)

        ranges_3d, ranges_5d = {}, {}

        for opt_type, l1_strikes in [("CE", body.ce_strikes), ("PE", body.pe_strikes)]:
            for l1_strike in l1_strikes:
                key = f"{l1_strike}_{opt_type}"
                try:
                    l2_strike = derive_l2_strike(l1_strike, body.multiplier) if is_multi_idx else l1_strike
                    exp_l2    = body.exp_l2a if is_multi_idx and body.exp_l2a else body.exp2

                    sym1 = build_symbol(body.exchange1, body.index1, body.exp1, l1_strike, opt_type)
                    sym2 = build_symbol(body.exchange2, body.index2, exp_l2, l2_strike, opt_type)
                    sym3 = sym2b = None
                    if is_butterfly:
                        sym3 = build_symbol(body.exchange1, body.index1, body.exp3, l1_strike, opt_type)
                        if is_multi_idx and body.exp_l2b:
                            sym2b = build_symbol(body.exchange2, body.index2, body.exp_l2b, l2_strike, opt_type)

                    # ONE ranged call per symbol for the whole window
                    days1 = _fetch_candles_range(fyers, sym1, window_start, window_end)
                    days2 = _fetch_candles_range(fyers, sym2, window_start, window_end)
                    days3 = _fetch_candles_range(fyers, sym3, window_start, window_end) if sym3 else None
                    days2b = _fetch_candles_range(fyers, sym2b, window_start, window_end) if sym2b else None

                    day_hi, day_lo = [], []
                    for d in trading_days:                # most recent first
                        if len(day_hi) >= want_days:
                            break
                        f1 = days1.get(d)
                        f2 = days2.get(d)
                        f3 = days3.get(d) if days3 is not None else None
                        f2b = days2b.get(d) if days2b is not None else None
                        if f1 is None or f2 is None:
                            continue
                        if days3 is not None and f3 is None:
                            continue
                        if days2b is not None and f2b is None:
                            continue

                        df = spread_from_frames(f1, f2, body.strategy, body.ratio, df3=f3, df2b=f2b)
                        if not df.empty:
                            # Close-based: the spread values that actually printed
                            s = df["spread"].dropna()
                            if len(s):
                                day_hi.append(float(s.max()))
                                day_lo.append(float(s.min()))

                    def summarise(n):
                        h, l = day_hi[:n], day_lo[:n]
                        return {
                            "high": round(max(h), 2) if h else None,
                            "low":  round(min(l), 2) if l else None,
                            "days_used": len(h),
                        }

                    ranges_3d[key] = summarise(3)
                    ranges_5d[key] = summarise(5)
                except Exception as inner:
                    print(f"[Range] {key} failed: {inner}")
                    empty = {"high": None, "low": None, "days_used": 0}
                    ranges_3d[key] = dict(empty)
                    ranges_5d[key] = dict(empty)

        primary = ranges_5d if body.days >= 5 else ranges_3d

        # If nothing resolved, say so explicitly rather than returning silent nulls
        filled = sum(1 for v in ranges_3d.values() if v.get("high") is not None)
        warning = None
        if filled == 0 and ranges_3d:
            warning = (_last_candle_error[0] or
                       "History API returned no candles for any strike. "
                       "Check /api/monitor/diag for the raw Fyers response.")
            print(f"[Range] no data for any strike — {warning}")

        return {"ranges": primary, "ranges_3d": ranges_3d, "ranges_5d": ranges_5d,
                "days": body.days, "warning": warning}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
