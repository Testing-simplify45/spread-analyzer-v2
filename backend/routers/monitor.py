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
        # (Leg1 - Leg2A*ratio) + (Leg3 - Leg2B*ratio), where Leg3 IS Leg1 —
        # both wings share one index/expiry/strike, matching the strategy page.
        # Here ltp2 = Leg 2A (far) and ltp3 = Leg 2B (near).
        if ltp2 is None or ltp3 is None: return None
        return round((ltp1 - (ltp2 * r)) + (ltp1 - (ltp3 * r)), 2)
    return None


# ── Models ────────────────────────────────────────────────────────────────────

def round_to_nearest_50(value: float) -> int:
    """Round a value to the nearest 50."""
    return int(round(value / 50) * 50)


def derive_l2_strike(l1_strike: int, multiplier: float) -> int:
    """Derive L2 strike from L1 using multiplier, rounded to nearest 50."""
    return round_to_nearest_50(l1_strike / multiplier)


def resolve_l2_strike(strategy: str, l1_strike: int, opt_type: str,
                      multiplier: float = 3.3, interval: int = 0) -> int:
    """
    Leg 2's strike for a given leg 1 strike.

      nfo_bfo / butterfly_nfo : L1 / multiplier, rounded to nearest 50
      index_p2                : CE -> L1 - interval,  PE -> L1 + interval
                                (leg 2 steps toward the money on both sides)
      everything else         : same strike as leg 1 (pure calendar)
    """
    if strategy in ("nfo_bfo", "butterfly_nfo"):
        return derive_l2_strike(l1_strike, multiplier)

    if strategy == "index_p2":
        step = int(interval or 0)
        if step <= 0:
            return l1_strike
        return l1_strike - step if opt_type.upper() == "CE" else l1_strike + step

    return l1_strike


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


def spread_from_frames(df1, df2, strategy, ratio, df3=None):
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

    if common.empty:
        return pd.DataFrame()

    r = ratio or 1.0
    c1, h1, l1 = df1.loc[common, "close"], df1.loc[common, "high"], df1.loc[common, "low"]
    c2, h2, l2 = df2.loc[common, "close"], df2.loc[common, "high"], df2.loc[common, "low"]

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
        # (Leg1 - Leg2A*r) + (Leg1 - Leg2B*r) — leg 3 is the same symbol as leg 1.
        # df2 carries Leg 2A, df3 carries Leg 2B.
        c3, h3, l3 = df3.loc[common, "close"], df3.loc[common, "high"], df3.loc[common, "low"]
        spread      = (c1 - c2 * r) + (c1 - c3 * r)
        spread_high = (h1 - l2 * r) + (h1 - l3 * r)
        spread_low  = (l1 - h2 * r) + (l1 - h3 * r)
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
    interval:   int   = 100      # index_p2: leg-2 strike offset
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

# Spot cache — several sections asking for the same index within a few seconds
# should not each hit Fyers. The working /straddle/all-spots endpoint batches
# three indices into one call; we do the same and cache briefly.
_spot_cache: dict = {}
_spot_stamp: dict = {}
_SPOT_TTL_SEC = 10


def _fetch_spots(fyers, indices: list) -> dict:
    """
    Fetch spot prices for several indices in ONE batched quotes call,
    mirroring /straddle/all-spots. Returns {INDEX: ltp} plus a possible
    '_error' key describing why nothing came back.
    """
    import time
    from services.fyers_service import INDEX_SYMBOL

    now = time.time()
    out, need = {}, []
    for ix in indices:
        ix = ix.upper()
        if _spot_stamp.get(ix) and (now - _spot_stamp[ix]) < _SPOT_TTL_SEC:
            out[ix] = _spot_cache[ix]
        elif INDEX_SYMBOL.get(ix):
            need.append(ix)

    if not need:
        return out

    sym_to_ix = {INDEX_SYMBOL[ix]: ix for ix in need}
    try:
        resp = fyers.quotes(data={"symbols": ",".join(sym_to_ix.keys())})
        if resp.get("s") != "ok":
            out["_error"] = {"code": resp.get("code"), "message": resp.get("message")}
            print(f"[Spot] batch failed -> code={resp.get('code')} {resp.get('message')}")
            return out

        for item in resp.get("d", []):
            name = item.get("n", "")
            v    = item.get("v", {})
            ltp  = float(v.get("lp") or v.get("last_price") or 0)
            if ltp <= 0:
                continue
            # Match on symbol name, as /straddle/all-spots does
            for sym, ix in sym_to_ix.items():
                if sym == name or sym.split(":")[-1] in name:
                    out[ix] = ltp
                    _spot_cache[ix] = ltp
                    _spot_stamp[ix] = time.time()
                    break
    except Exception as e:
        out["_error"] = {"code": None, "message": str(e)}
        print(f"[Spot] batch exception: {e}")

    # Fallback: index quotes can fail while history stays healthy. Derive spot
    # from the index's most recent candle instead of giving up.
    still_missing = [ix for ix in need if ix not in out]
    for ix in still_missing:
        ltp = _spot_from_history(fyers, INDEX_SYMBOL[ix])
        if ltp:
            out[ix] = ltp
            _spot_cache[ix] = ltp
            _spot_stamp[ix] = time.time()
            print(f"[Spot] {ix} recovered from history: {ltp}")

    return out


def _spot_from_history(fyers, symbol: str):
    """
    Last traded price for an index from candle history.
    Used when quotes() is unavailable but history() still works.
    """
    from datetime import date as _date
    try:
        d = _date.today()
        # Walk back far enough to clear a weekend or holiday
        start = d - timedelta(days=6)
        resp = fyers.history(data={
            "symbol": symbol, "resolution": "5", "date_format": "1",
            "range_from": start.strftime("%Y-%m-%d"),
            "range_to":   d.strftime("%Y-%m-%d"),
            "cont_flag": "1",
        })
        if resp.get("s") != "ok":
            print(f"[Spot] history fallback for {symbol} -> "
                  f"{resp.get('code')} {resp.get('message')}")
            return None
        candles = resp.get("candles") or []
        if not candles:
            return None
        return float(candles[-1][4])   # close of the most recent candle
    except Exception as e:
        print(f"[Spot] history fallback for {symbol} failed: {e}")
        return None


@router.get("/atm/{index}")
def get_atm(index: str, addon: int = 100, authorization: str = Header(None)):
    """
    Resolve the ATM strike from the live spot price.
    Uses a batched, briefly-cached quotes call so multiple sections don't each
    hammer Fyers, and reports Fyers' own code/message rather than guessing.
    """
    fyers = _get_fyers(authorization)
    try:
        from services.fyers_service import INDEX_SYMBOL, round_to_nearest

        ix = index.upper()
        if not INDEX_SYMBOL.get(ix):
            raise HTTPException(status_code=404, detail=f"Unknown index: {index}")

        # Warm the whole set — the extra symbols are free in a batched call
        spots = _fetch_spots(fyers, list(INDEX_SYMBOL.keys()))
        ltp = spots.get(ix)

        if ltp and ltp > 0:
            return {"spot": ltp, "atm": round_to_nearest(ltp, addon)}

        err   = spots.get("_error") or {}
        code  = err.get("code")
        msg   = err.get("message", "")
        lower = str(msg).lower()
        raw   = f"[Fyers code={code}: {msg}]" if msg else "[no error reported]"

        if code == 429 or any(k in lower for k in ("rate limit", "too many", "throttl")):
            raise HTTPException(status_code=429,
                detail=f"Fyers is rate limiting requests. Wait a few minutes. {raw}")

        if code in (401, 403, -15, -16, -17) or any(
                k in lower for k in ("token", "unauthor", "invalid app", "expired")):
            raise HTTPException(status_code=401,
                detail=f"Fyers rejected the token — log out and log in again. {raw}")

        if code in (-300, -50) or "bad request" in lower or "invalid" in lower:
            raise HTTPException(status_code=400,
                detail=f"Fyers rejected the spot request. {raw}")

        raise HTTPException(status_code=404,
            detail=f"Could not resolve {ix} spot from quotes or history. "
                   f"Set First Leg to Custom to continue without it. {raw}")
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

        # 1a. Quotes with a SINGLE bare symbol — the shape /atm used
        spot_sym = INDEX_SYMBOL.get(index.upper())
        q1 = fyers.quotes(data={"symbols": spot_sym})
        out["quotes_single_symbol"] = {
            "sent": spot_sym,
            "s": q1.get("s"), "code": q1.get("code"), "message": q1.get("message"),
            "got_price": bool(q1.get("d")),
        }

        # 1b. Quotes with a COMMA-JOINED list — the shape every working path uses
        multi = ",".join([INDEX_SYMBOL["NIFTY"], INDEX_SYMBOL["SENSEX"],
                          INDEX_SYMBOL["BANKNIFTY"]])
        q2 = fyers.quotes(data={"symbols": multi})
        out["quotes_multi_symbol"] = {
            "sent": multi,
            "s": q2.get("s"), "code": q2.get("code"), "message": q2.get("message"),
            "got_price": bool(q2.get("d")),
        }

        # 1c. Same call shape, but an OPTION symbol instead of an index symbol.
        # Other tabs prove option quotes work, so this isolates index symbols.
        opt_probe = None
        if exp1 and strike:
            opt_probe = build_symbol(
                "NSE" if index.upper() != "SENSEX" else "BSE",
                index.upper(), exp1, strike, opt_type)
            q3 = fyers.quotes(data={"symbols": opt_probe})
            out["quotes_option_symbol"] = {
                "sent": opt_probe, "s": q3.get("s"),
                "code": q3.get("code"), "message": q3.get("message"),
                "got_price": bool(q3.get("d")),
            }

        # 1d. Can we recover spot from history when quotes is down?
        fb = _spot_from_history(fyers, spot_sym)
        out["spot_from_history_fallback"] = fb

        index_ok  = q1.get("s") == "ok" or q2.get("s") == "ok"
        option_ok = out.get("quotes_option_symbol", {}).get("s") == "ok"
        if not index_ok and option_ok:
            out["verdict"] = ("Index-symbol quotes fail while option-symbol quotes "
                              "succeed. The history fallback supplies spot instead.")
        elif not index_ok and fb:
            out["verdict"] = ("Index quotes are down but history works — "
                              f"fallback resolved spot as {fb}.")
        elif index_ok:
            out["verdict"] = "Index quotes are working now."
        else:
            out["verdict"] = "Both quotes and history are failing — check the token."

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
                l2_strike = resolve_l2_strike(strategy, l1_strike, OT,
                                              multiplier=multiplier, interval=body.interval)

                # L1 symbol
                s1 = build_symbol(body.exchange1, body.index1, body.exp1, l1_strike, OT)
                # L2 symbol — uses index2 and derived strike for multi-index
                exp_l2 = body.exp_l2a if is_multi_idx and body.exp_l2a else body.exp2
                s2 = build_symbol(body.exchange2, body.index2, exp_l2, l2_strike, OT)

                sym_maps[opt_type][l1_strike] = {"s1": s1, "s2": s2, "l2_strike": l2_strike}
                all_syms += [s1, s2]

                if is_butterfly:
                    if is_multi_idx:
                        # Leg 1 and Leg 3 are the SAME symbol (one index/expiry/strike).
                        # The third symbol we need is Leg 2B — index 2, near expiry.
                        exp_l2b_code = body.exp_l2b or exp_l2
                        s3 = build_symbol(body.exchange2, body.index2, exp_l2b_code, l2_strike, OT)
                    else:
                        # Butterfly Index: three distinct expiries on one index
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
                    l2_strike = resolve_l2_strike(body.strategy, l1_strike, opt_type,
                                                  multiplier=body.multiplier,
                                                  interval=getattr(body, "interval", 0))
                    exp_l2    = body.exp_l2a if is_multi_idx and body.exp_l2a else body.exp2

                    sym1 = build_symbol(body.exchange1, body.index1, body.exp1, l1_strike, opt_type)
                    sym2 = build_symbol(body.exchange2, body.index2, exp_l2, l2_strike, opt_type)
                    sym3 = None
                    if is_butterfly:
                        if is_multi_idx:
                            # Leg 3 == Leg 1, so the third leg we fetch is Leg 2B
                            sym3 = build_symbol(body.exchange2, body.index2,
                                                body.exp_l2b or exp_l2, l2_strike, opt_type)
                        else:
                            sym3 = build_symbol(body.exchange1, body.index1,
                                                body.exp3, l1_strike, opt_type)

                    # Reuses the range cache when Range was clicked first
                    d1 = _fetch_candles_range(fyers, sym1, yesterday, yesterday).get(yesterday)
                    d2 = _fetch_candles_range(fyers, sym2, yesterday, yesterday).get(yesterday)
                    d3 = _fetch_candles_range(fyers, sym3, yesterday, yesterday).get(yesterday) if sym3 else None

                    df = spread_from_frames(d1, d2, body.strategy, body.ratio, df3=d3)
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
                    l2_strike = resolve_l2_strike(body.strategy, l1_strike, opt_type,
                                                  multiplier=body.multiplier,
                                                  interval=getattr(body, "interval", 0))
                    exp_l2    = body.exp_l2a if is_multi_idx and body.exp_l2a else body.exp2

                    sym1 = build_symbol(body.exchange1, body.index1, body.exp1, l1_strike, opt_type)
                    sym2 = build_symbol(body.exchange2, body.index2, exp_l2, l2_strike, opt_type)
                    sym3 = None
                    if is_butterfly:
                        if is_multi_idx:
                            # Leg 3 == Leg 1, so the third leg we fetch is Leg 2B
                            sym3 = build_symbol(body.exchange2, body.index2,
                                                body.exp_l2b or exp_l2, l2_strike, opt_type)
                        else:
                            sym3 = build_symbol(body.exchange1, body.index1,
                                                body.exp3, l1_strike, opt_type)

                    # ONE ranged call per symbol for the whole window
                    days1 = _fetch_candles_range(fyers, sym1, window_start, window_end)
                    days2 = _fetch_candles_range(fyers, sym2, window_start, window_end)
                    days3 = _fetch_candles_range(fyers, sym3, window_start, window_end) if sym3 else None

                    day_hi, day_lo = [], []
                    for d in trading_days:                # most recent first
                        if len(day_hi) >= want_days:
                            break
                        f1 = days1.get(d)
                        f2 = days2.get(d)
                        f3 = days3.get(d) if days3 is not None else None
                        if f1 is None or f2 is None:
                            continue
                        if days3 is not None and f3 is None:
                            continue

                        df = spread_from_frames(f1, f2, body.strategy, body.ratio, df3=f3)
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
