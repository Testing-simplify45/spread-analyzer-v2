"""
routers/straddle.py
===================
Straddle Monitor endpoints.
Straddle = ATM Call LTP + ATM Put LTP
"""

from fastapi import APIRouter, Header, HTTPException
from datetime import date, timedelta
from typing import Optional
import pandas as pd
from services.fyers_service import (
    make_fyers, get_expiries, get_batch_ltp,
    build_symbol, get_candles, INDEX_SYMBOL,
)

router = APIRouter()

# Alert thresholds (points above day low)
ALERT_THRESHOLDS = {
    "SENSEX":    30,
    "NIFTY":     15,
    "BANKNIFTY": 20,
}

# ATM rounding
ATM_ROUND = {
    "NIFTY":     50,
    "BANKNIFTY": 100,
    "SENSEX":    100,
    "BANKEX":    100,
}

EXCHANGE_MAP = {
    "NIFTY":     "NSE",
    "BANKNIFTY": "NSE",
    "SENSEX":    "BSE",
    "BANKEX":    "BSE",
}


def _get_fyers(authorization: str):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    parts = authorization.split("|")
    if len(parts) != 2:
        raise HTTPException(status_code=401, detail="Token format: client_id|access_token")
    client_id, access_token = parts[0].replace("Bearer ", ""), parts[1]
    return make_fyers(client_id, access_token)


def round_atm(spot: float, underlying: str) -> int:
    rnd = ATM_ROUND.get(underlying, 50)
    return int(round(spot / rnd) * rnd)


def get_spot_price(fyers, underlying: str) -> Optional[float]:
    idx_sym = INDEX_SYMBOL.get(underlying)
    if not idx_sym:
        return None
    try:
        resp = fyers.quotes(data={"symbols": idx_sym})
        if resp.get("s") == "ok":
            v = resp["d"][0].get("v", {})
            return float(v.get("lp") or v.get("last_price") or 0)
    except Exception:
        pass
    return None


def get_straddle_ltp(fyers, underlying: str, expiry_code: str, atm_strike: int) -> dict:
    exchange = EXCHANGE_MAP.get(underlying, "NSE")
    sym_ce = build_symbol(exchange, underlying, expiry_code, atm_strike, "CE")
    sym_pe = build_symbol(exchange, underlying, expiry_code, atm_strike, "PE")
    ltp_map = get_batch_ltp(fyers, [sym_ce, sym_pe])
    ce_ltp = ltp_map.get(sym_ce)
    pe_ltp = ltp_map.get(sym_pe)
    straddle = round(ce_ltp + pe_ltp, 2) if ce_ltp and pe_ltp else None
    return {"ce_ltp": ce_ltp, "pe_ltp": pe_ltp, "straddle": straddle,
            "sym_ce": sym_ce, "sym_pe": sym_pe, "strike": atm_strike}


def get_prev_day_straddle(fyers, underlying, expiry_code, atm_strike, today):
    prev = today - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    exchange = EXCHANGE_MAP.get(underlying, "NSE")
    sym_ce = build_symbol(exchange, underlying, expiry_code, atm_strike, "CE")
    sym_pe = build_symbol(exchange, underlying, expiry_code, atm_strike, "PE")
    df_ce = get_candles(fyers, sym_ce, prev)
    df_pe = get_candles(fyers, sym_pe, prev)
    if df_ce.empty or df_pe.empty:
        return None
    return round(float(df_ce["close"].iloc[-1]) + float(df_pe["close"].iloc[-1]), 2)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/all-spots")
def get_all_spots(authorization: str = Header(None)):
    """Get live spot prices for NIFTY, BANKNIFTY, SENSEX in one call."""
    fyers = _get_fyers(authorization)
    syms  = [INDEX_SYMBOL["NIFTY"], INDEX_SYMBOL["BANKNIFTY"], INDEX_SYMBOL["SENSEX"]]
    results = {}
    try:
        resp = fyers.quotes(data={"symbols": ",".join(syms)})
        if resp.get("s") == "ok":
            for item in resp["d"]:
                sym = item.get("n", "")
                v   = item.get("v", {})
                ltp = float(v.get("lp") or v.get("last_price") or 0)
                if "NIFTY50" in sym:    results["NIFTY"]     = ltp
                elif "NIFTYBANK" in sym: results["BANKNIFTY"] = ltp
                elif "SENSEX" in sym:    results["SENSEX"]    = ltp
    except Exception:
        pass
    return results


@router.get("/table/{underlying}")
def get_straddle_table(underlying: str, authorization: str = Header(None)):
    """Get straddle values for all live expiries using single batch LTP call."""
    fyers = _get_fyers(authorization)
    und   = underlying.upper()
    today = date.today()

    spot = get_spot_price(fyers, und)
    if not spot or spot <= 0:
        return {"underlying": und, "spot": None, "atm": None, "data": [], "error": "Could not fetch spot price"}

    atm_strike = round_atm(spot, und)
    expiries   = get_expiries(fyers, und)
    if not expiries:
        return {"underlying": und, "spot": spot, "atm": atm_strike, "data": [], "error": "Could not fetch expiries"}

    exchange = EXCHANGE_MAP.get(und, "NSE")

    # Build ALL symbols for one single batch call
    exp_subset = expiries[:8]
    all_symbols = []
    for exp in exp_subset:
        code = exp["code"]
        all_symbols.append(build_symbol(exchange, und, code, atm_strike, "CE"))
        all_symbols.append(build_symbol(exchange, und, code, atm_strike, "PE"))

    # Single batch LTP call for all expiries
    ltp_map = get_batch_ltp(fyers, all_symbols)

    results = []
    for exp in exp_subset:
        try:
            code  = exp["code"]
            label = exp["label"]

            sym_ce = build_symbol(exchange, und, code, atm_strike, "CE")
            sym_pe = build_symbol(exchange, und, code, atm_strike, "PE")

            ce_ltp = ltp_map.get(sym_ce)
            pe_ltp = ltp_map.get(sym_pe)
            today_val = round(ce_ltp + pe_ltp, 2) if ce_ltp and pe_ltp else None

            # Yesterday close
            yesterday = get_prev_day_straddle(fyers, und, code, atm_strike, today)
            change    = round(today_val - yesterday, 2) if today_val and yesterday else None

            results.append({
                "expiry":      label,
                "expiry_code": code,
                "atm_strike":  atm_strike,
                "spot":        spot,
                "yesterday":   yesterday,
                "today":       today_val,
                "change":      change,
                "ce_ltp":      ce_ltp,
                "pe_ltp":      pe_ltp,
                "threshold":   ALERT_THRESHOLDS.get(und, 15),
                "sym_ce":      sym_ce,
                "sym_pe":      sym_pe,
            })
        except Exception as e:
            continue

    return {"underlying": und, "spot": spot, "atm": atm_strike, "data": results}

    return {"underlying": und, "spot": spot, "atm": atm_strike, "data": results}


@router.get("/intraday/{underlying}/{expiry_code}")
def get_intraday_straddle(
    underlying:    str,
    expiry_code:   str,
    atm_strike:    int,
    authorization: str = Header(None),
):
    """Get intraday straddle chart data."""
    fyers    = _get_fyers(authorization)
    und      = underlying.upper()
    exchange = EXCHANGE_MAP.get(und, "NSE")
    today    = date.today()

    sym_ce = build_symbol(exchange, und, expiry_code, atm_strike, "CE")
    sym_pe = build_symbol(exchange, und, expiry_code, atm_strike, "PE")
    df_ce  = get_candles(fyers, sym_ce, today)
    df_pe  = get_candles(fyers, sym_pe, today)

    if df_ce.empty or df_pe.empty:
        return {"data": [], "stats": {}, "alert": False}

    common = df_ce.index.intersection(df_pe.index)
    if common.empty:
        return {"data": [], "stats": {}, "alert": False}

    result = pd.DataFrame({
        "timestamp": common,
        "ce":        df_ce.loc[common, "close"].values,
        "pe":        df_pe.loc[common, "close"].values,
    })
    result["straddle"] = result["ce"] + result["pe"]

    day_high    = round(float(result["straddle"].max()), 2)
    day_low     = round(float(result["straddle"].min()), 2)
    day_open    = round(float(result["straddle"].iloc[0]), 2)
    day_current = round(float(result["straddle"].iloc[-1]), 2)

    result["timestamp"] = result["timestamp"].astype(str)
    threshold = ALERT_THRESHOLDS.get(und, 15)

    return {
        "data":    result[["timestamp", "straddle", "ce", "pe"]].to_dict("records"),
        "stats":   {
            "open":            day_open,
            "high":            day_high,
            "low":             day_low,
            "current":         day_current,
            "change_from_low": round(day_current - day_low, 2),
        },
        "alert":     day_current > day_low + threshold,
        "threshold": threshold,
    }
