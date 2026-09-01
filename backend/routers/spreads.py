"""
routers/spreads.py
==================
Spread data endpoints — live LTP, historical candles, day stats.
"""

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import date, timedelta
import pandas as pd
from services.fyers_service import (
    make_fyers, build_symbol, get_batch_ltp,
    compute_spread_series, compute_day_stats,
)

router = APIRouter()


def _get_fyers(authorization: str):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    parts = authorization.split("|")
    if len(parts) != 2:
        raise HTTPException(status_code=401, detail="Token format: client_id|access_token")
    client_id, access_token = parts[0].replace("Bearer ", ""), parts[1]
    return make_fyers(client_id, access_token)


# ── Models ────────────────────────────────────────────────────────────────────

class SpreadRow(BaseModel):
    exchange1:    str
    underlying1:  str
    expiry_code1: str
    strike1:      int
    type1:        str
    exchange2:    str
    underlying2:  str
    expiry_code2: str
    strike2:      int
    type2:        str
    ratio:        float = 1.0


class BatchSpreadRequest(BaseModel):
    rows:  list[SpreadRow]
    ratio: float = 1.0


# ── Batch LTP ─────────────────────────────────────────────────────────────────

@router.post("/batch-ltp")
def batch_ltp(body: BatchSpreadRequest, authorization: str = Header(None)):
    fyers = _get_fyers(authorization)

    sym1_list = []
    sym2_list = []
    for row in body.rows:
        sym1_list.append(build_symbol(row.exchange1, row.underlying1,
                                       row.expiry_code1, row.strike1, row.type1))
        sym2_list.append(build_symbol(row.exchange2, row.underlying2,
                                       row.expiry_code2, row.strike2, row.type2))

    all_syms = sym1_list + sym2_list
    ltp_map  = get_batch_ltp(fyers, all_syms)

    results = []
    for i, row in enumerate(body.rows):
        ltp1    = ltp_map.get(sym1_list[i])
        ltp2    = ltp_map.get(sym2_list[i])
        current = round(ltp1 - ltp2 * body.ratio, 2) if ltp1 and ltp2 else None
        results.append({
            "strike1":  row.strike1,
            "strike2":  row.strike2,
            "sym1":     sym1_list[i],
            "sym2":     sym2_list[i],
            "ltp1":     ltp1,
            "ltp2":     ltp2,
            "current":  current,
        })

    return {"results": results}


# ── Spread history ────────────────────────────────────────────────────────────

@router.post("/history")
def get_spread_history(
    body: SpreadRow,
    trade_date: str = Query(default=None),
    resolution: str = Query(default="1"),
    authorization: str = Header(None),
):
    fyers = _get_fyers(authorization)

    if not trade_date:
        d = date.today()
    else:
        d = date.fromisoformat(trade_date)

    sym1 = build_symbol(body.exchange1, body.underlying1,
                         body.expiry_code1, body.strike1, body.type1)
    sym2 = build_symbol(body.exchange2, body.underlying2,
                         body.expiry_code2, body.strike2, body.type2)

    df = compute_spread_series(fyers, sym1, sym2, d, body.ratio, resolution)

    if df.empty:
        return {"data": [], "stats": {}, "symbols": {"sym1": sym1, "sym2": sym2}}

    stats = compute_day_stats(df)
    df["timestamp"] = df["timestamp"].astype(str)
    records = df[["timestamp","spread","spread_high","spread_low",
                   "leg1_price","leg2_price"]].to_dict("records")

    return {
        "data":    records,
        "stats":   stats,
        "symbols": {"sym1": sym1, "sym2": sym2},
    }


# ── Multi-day history ─────────────────────────────────────────────────────────

@router.post("/multi-day-history")
def get_multi_day_history(
    body: SpreadRow,
    days: int = Query(default=1),
    resolution: str = Query(default="1"),
    authorization: str = Header(None),
):
    fyers = _get_fyers(authorization)

    sym1 = build_symbol(body.exchange1, body.underlying1,
                         body.expiry_code1, body.strike1, body.type1)
    sym2 = build_symbol(body.exchange2, body.underlying2,
                         body.expiry_code2, body.strike2, body.type2)

    frames = []
    d = date.today()
    collected = 0

    while collected < days:
        if d.weekday() < 5:
            df = compute_spread_series(fyers, sym1, sym2, d, body.ratio, resolution)
            if not df.empty:
                df["date"] = str(d)
                frames.append(df)
            collected += 1
        d -= timedelta(days=1)

    if not frames:
        return {"data": [], "symbols": {"sym1": sym1, "sym2": sym2}}

    combined = pd.concat(frames[::-1], ignore_index=True)
    combined["timestamp"] = combined["timestamp"].astype(str)
    records = combined[["timestamp","date","spread","spread_high",
                          "spread_low"]].to_dict("records")

    return {
        "data":    records,
        "symbols": {"sym1": sym1, "sym2": sym2},
    }


# ── Butterfly Index ───────────────────────────────────────────────────────────

class ButterflyIndexRequest(BaseModel):
    exchange:   str
    underlying: str
    exp1:       str
    strike1:    int
    exp2:       str
    strike2:    int
    exp3:       str
    strike3:    int
    type:       str
    trade_date: str
    resolution: str = "1"


@router.post("/butterfly-index")
def butterfly_index(body: ButterflyIndexRequest, authorization: str = Header(None)):
    """
    Butterfly Index spread.
    Formula: (Leg3 - Leg2) - (Leg2 - Leg1) = Leg1 - 2*Leg2 + Leg3
    """
    fyers = _get_fyers(authorization)
    d     = date.fromisoformat(body.trade_date)

    sym1 = build_symbol(body.exchange, body.underlying, body.exp1, body.strike1, body.type)
    sym2 = build_symbol(body.exchange, body.underlying, body.exp2, body.strike2, body.type)
    sym3 = build_symbol(body.exchange, body.underlying, body.exp3, body.strike3, body.type)

    from services.fyers_service import get_candles
    df1 = get_candles(fyers, sym1, d, body.resolution)
    df2 = get_candles(fyers, sym2, d, body.resolution)
    df3 = get_candles(fyers, sym3, d, body.resolution)

    if df1.empty or df2.empty or df3.empty:
        return {"data": [], "stats": {}}

    common = df1.index.intersection(df2.index).intersection(df3.index)
    if common.empty:
        return {"data": [], "stats": {}}

    result = pd.DataFrame({
        "timestamp": common,
        "leg1_price": df1.loc[common, "close"].values,
        "leg2_price": df2.loc[common, "close"].values,
        "leg3_price": df3.loc[common, "close"].values,
    })

    # Formula: (Leg3 - Leg2) - (Leg2 - Leg1)
    result["spread"]      = (result["leg3_price"] - result["leg2_price"]) - (result["leg2_price"] - result["leg1_price"])
    result["spread_high"] = (df3.loc[common, "high"].values  - df2.loc[common, "low"].values)  - (df2.loc[common, "low"].values  - df1.loc[common, "high"].values)
    result["spread_low"]  = (df3.loc[common, "low"].values   - df2.loc[common, "high"].values) - (df2.loc[common, "high"].values - df1.loc[common, "low"].values)

    stats = compute_day_stats(result)
    result["timestamp"] = result["timestamp"].astype(str)
    records = result[["timestamp", "spread", "spread_high", "spread_low"]].to_dict("records")

    return {"data": records, "stats": stats}


# ── Butterfly NFO-BFO ─────────────────────────────────────────────────────────

class ButterflyNfoBfoRequest(BaseModel):
    leg1_exchange:    str
    leg1_underlying:  str
    leg1_expiry:      str
    leg1_strike:      int
    leg2a_exchange:   str
    leg2a_underlying: str
    leg2a_expiry:     str
    leg2a_strike:     int
    leg2b_exchange:   str
    leg2b_underlying: str
    leg2b_expiry:     str
    leg2b_strike:     int
    leg3_exchange:    str
    leg3_underlying:  str
    leg3_expiry:      str
    leg3_strike:      int
    option_type:      str
    ratio:            float = 3.3
    trade_date:       str
    resolution:       str = "1"


@router.post("/butterfly-nfobfo")
def butterfly_nfobfo(body: ButterflyNfoBfoRequest, authorization: str = Header(None)):
    """
    Butterfly NFO-BFO spread.
    Formula: (Leg1 - Leg2a*Ratio) + (Leg3 - Leg2b*Ratio)
    Leg1 = Leg3 = SENSEX (same expiry, same strike)
    Leg2a = NIFTY far expiry
    Leg2b = NIFTY near expiry
    """
    fyers = _get_fyers(authorization)
    d     = date.fromisoformat(body.trade_date)

    sym1  = build_symbol(body.leg1_exchange,  body.leg1_underlying,  body.leg1_expiry,  body.leg1_strike,  body.option_type)
    sym2a = build_symbol(body.leg2a_exchange, body.leg2a_underlying, body.leg2a_expiry, body.leg2a_strike, body.option_type)
    sym2b = build_symbol(body.leg2b_exchange, body.leg2b_underlying, body.leg2b_expiry, body.leg2b_strike, body.option_type)
    # sym3 is same as sym1 since Leg3 = Leg1 (same SENSEX expiry + strike)

    from services.fyers_service import get_candles
    df1  = get_candles(fyers, sym1,  d, body.resolution)
    df2a = get_candles(fyers, sym2a, d, body.resolution)
    df2b = get_candles(fyers, sym2b, d, body.resolution)

    if df1.empty or df2a.empty or df2b.empty:
        return {"data": [], "stats": {}}

    # Align all dataframes to df1's index using nearest timestamp
    # This handles minor tick differences between BSE and NSE
    df2a_aligned = df2a.reindex(df1.index, method='nearest', tolerance=pd.Timedelta('2min'))
    df2b_aligned = df2b.reindex(df1.index, method='nearest', tolerance=pd.Timedelta('2min'))

    # Drop rows where any leg has no data
    valid_mask = (
        df1["close"].notna() &
        df2a_aligned["close"].notna() &
        df2b_aligned["close"].notna()
    )
    df1_v   = df1[valid_mask]
    df2a_v  = df2a_aligned[valid_mask]
    df2b_v  = df2b_aligned[valid_mask]

    if df1_v.empty:
        return {"data": [], "stats": {}}

    r = body.ratio
    result = pd.DataFrame({"timestamp": df1_v.index})

    leg1_close  = df1_v["close"].values
    leg2a_close = df2a_v["close"].values
    leg2b_close = df2b_v["close"].values

    # Formula: (Leg1 - Leg2a*ratio) + (Leg1 - Leg2b*ratio)
    result["spread"]      = (leg1_close - leg2a_close * r) + (leg1_close - leg2b_close * r)
    result["spread_high"] = (df1_v["high"].values - df2a_v["low"].values * r) + (df1_v["high"].values - df2b_v["low"].values * r)
    result["spread_low"]  = (df1_v["low"].values  - df2a_v["high"].values * r) + (df1_v["low"].values  - df2b_v["high"].values * r)

    stats = compute_day_stats(result)
    result["timestamp"] = result["timestamp"].astype(str)
    records = result[["timestamp", "spread", "spread_high", "spread_low"]].to_dict("records")

    return {"data": records, "stats": stats}
