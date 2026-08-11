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


# ── Request/Response models ───────────────────────────────────────────────────

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


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/batch-ltp")
def batch_ltp(body: BatchSpreadRequest, authorization: str = Header(None)):
    """
    Fetch live LTP for multiple spread rows in one batch call.
    Returns current spread for each row.
    """
    fyers = _get_fyers(authorization)

    # Build all symbols
    sym1_list = []
    sym2_list = []
    for row in body.rows:
        sym1_list.append(build_symbol(row.exchange1, row.underlying1,
                                       row.expiry_code1, row.strike1, row.type1))
        sym2_list.append(build_symbol(row.exchange2, row.underlying2,
                                       row.expiry_code2, row.strike2, row.type2))

    # Single batch API call
    all_syms = sym1_list + sym2_list
    ltp_map  = get_batch_ltp(fyers, all_syms)

    # Compute spreads
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


@router.post("/history")
def get_spread_history(
    body: SpreadRow,
    trade_date: str = Query(default=None),
    resolution: str = Query(default="1"),
    authorization: str = Header(None),
):
    """
    Get spread history for a single row on a given date.
    Returns list of {timestamp, spread, spread_high, spread_low} dicts.
    """
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

    # Convert to JSON-serializable list
    df["timestamp"] = df["timestamp"].astype(str)
    records = df[["timestamp","spread","spread_high","spread_low",
                   "leg1_price","leg2_price"]].to_dict("records")

    return {
        "data":    records,
        "stats":   stats,
        "symbols": {"sym1": sym1, "sym2": sym2},
    }


@router.post("/multi-day-history")
def get_multi_day_history(
    body: SpreadRow,
    days: int = Query(default=1),
    resolution: str = Query(default="1"),
    authorization: str = Header(None),
):
    """
    Get spread history across multiple trading days.
    days: 1, 5, 22 (1M), 130 (6M)
    """
    fyers = _get_fyers(authorization)

    sym1 = build_symbol(body.exchange1, body.underlying1,
                         body.expiry_code1, body.strike1, body.type1)
    sym2 = build_symbol(body.exchange2, body.underlying2,
                         body.expiry_code2, body.strike2, body.type2)

    frames = []
    d = date.today()
    collected = 0

    while collected < days:
        if d.weekday() < 5:  # Skip weekends
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
