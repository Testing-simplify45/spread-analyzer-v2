"""
services/fyers_service.py
=========================
All Fyers API interactions in one place.
"""

from __future__ import annotations
import os
from datetime import date, datetime, timedelta
from typing import Optional
import pandas as pd
from fyers_apiv3 import fyersModel

# ── Months lookup ─────────────────────────────────────────────────────────────
_MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN",
           "JUL","AUG","SEP","OCT","NOV","DEC"]

# ── Fyers index symbols ───────────────────────────────────────────────────────
INDEX_SYMBOL = {
    "NIFTY":      "NSE:NIFTY50-INDEX",
    "BANKNIFTY":  "NSE:NIFTYBANK-INDEX",
    "FINNIFTY":   "NSE:FINNIFTY-INDEX",
    "MIDCPNIFTY": "NSE:MIDCPNIFTY-INDEX",
    "SENSEX":     "BSE:SENSEX-INDEX",
    "BANKEX":     "BSE:BANKEX-INDEX",
}

ATM_APPROX = {
    "NIFTY": 23300, "BANKNIFTY": 52000, "FINNIFTY": 23500,
    "MIDCPNIFTY": 11500, "SENSEX": 77000, "BANKEX": 59000,
}

STRIKE_GAP = {
    "NIFTY": 50, "BANKNIFTY": 100, "FINNIFTY": 50,
    "MIDCPNIFTY": 25, "SENSEX": 100, "BANKEX": 100,
}


# ── Symbol builder ────────────────────────────────────────────────────────────

def build_symbol(exchange: str, underlying: str, expiry_code: str,
                 strike: int, option_type: str) -> str:
    """
    Build Fyers option symbol.
    Monthly: BSE:SENSEX26AUG77000CE
    Weekly:  BSE:SENSEX2680677000CE
    """
    ot   = "CE" if option_type.upper() in ("C","CE") else "PE"
    code = expiry_code.strip().upper()

    if any(c.isalpha() for c in code):
        # Monthly format
        return f"{exchange}:{underlying}{code}{strike}{ot}"

    # Weekly YYMMDD → YYM(no-zero)DD
    yy = code[0:2]
    mm = str(int(code[2:4]))
    dd = code[4:6]
    return f"{exchange}:{underlying}{yy}{mm}{dd}{strike}{ot}"


def round_to_nearest(value: float, multiple: int) -> int:
    return int(round(value / multiple) * multiple)

def round_to_nearest_50(value: float) -> int:
    return round_to_nearest(value, 50)


# ── Fyers client factory ──────────────────────────────────────────────────────

def make_fyers(client_id: str, access_token: str) -> fyersModel.FyersModel:
    return fyersModel.FyersModel(
        client_id=client_id,
        token=access_token,
        log_path="",
    )


# ── Auth URL ──────────────────────────────────────────────────────────────────

def get_auth_url(client_id: str, secret_key: str, redirect_uri: str) -> str:
    session = fyersModel.SessionModel(
        client_id=client_id,
        secret_key=secret_key,
        redirect_uri=redirect_uri,
        response_type="code",
        grant_type="authorization_code",
    )
    return session.generate_authcode()


def exchange_code_for_token(
    client_id: str, secret_key: str,
    redirect_uri: str, auth_code: str
) -> Optional[str]:
    import time
    last_error = None
    for attempt in range(3):
        try:
            session = fyersModel.SessionModel(
                client_id=client_id,
                secret_key=secret_key,
                redirect_uri=redirect_uri,
                response_type="code",
                grant_type="authorization_code",
            )
            session.set_token(auth_code)
            resp = session.generate_token()
            if resp.get("s") == "ok":
                return resp["access_token"]
            last_error = resp.get("message", "Unknown error")
            print(f"[Auth] Token exchange attempt {attempt+1} failed: {last_error}")
        except Exception as e:
            last_error = str(e)
            print(f"[Auth] Token exchange attempt {attempt+1} exception: {e}")
        if attempt < 2:
            time.sleep(2 * (attempt + 1))  # 2s, 4s backoff
    print(f"[Auth] All token exchange attempts failed. Last error: {last_error}")
    return None


# ── Expiries ──────────────────────────────────────────────────────────────────

def get_expiries(fyers, underlying: str) -> list[dict]:
    """
    Returns list of {label, code} dicts.
    label: "06 AUG 26 (W)"
    code:  "260806" or "26AUG"
    """
    from collections import defaultdict

    sym = INDEX_SYMBOL.get(underlying)
    if not sym:
        return []

    try:
        resp = fyers.optionchain(data={"symbol": sym, "strikecount": 1, "timestamp": ""})
        if not (resp and resp.get("s") == "ok"):
            return []

        raw = resp.get("data", {}).get("expiryData", [])
        parsed = []
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            d = entry.get("date", "")
            try:
                dd, mm, yyyy = d.split("-")
                dd, mm, yyyy = int(dd), int(mm), int(yyyy)
            except Exception:
                continue
            yy  = yyyy % 100
            mon = _MONTHS[mm - 1]
            parsed.append((yy, mm, dd, mon))

        by_month = defaultdict(list)
        for yy, mm, dd, mon in parsed:
            by_month[(yy, mm)].append(dd)
        last_of_month = {k: max(v) for k, v in by_month.items()}

        result = []
        for yy, mm, dd, mon in parsed:
            is_monthly = (dd == last_of_month[(yy, mm)])
            if is_monthly:
                code  = f"{yy:02d}{mon}"
                label = f"{dd:02d} {mon} {yy:02d} (M)"
            else:
                code  = f"{yy:02d}{mm:02d}{dd:02d}"
                label = f"{dd:02d} {mon} {yy:02d} (W)"
            result.append({"label": label, "code": code})

        return result

    except Exception:
        return []


# ── Batch LTP ─────────────────────────────────────────────────────────────────

def get_batch_ltp(fyers, symbols: list[str]) -> dict[str, float]:
    """Fetch LTP for multiple symbols in one API call."""
    results = {}
    for i in range(0, len(symbols), 50):
        batch = symbols[i:i+50]
        try:
            resp = fyers.quotes(data={"symbols": ",".join(batch)})
            if resp.get("s") == "ok":
                for item in resp["d"]:
                    sym = item.get("n", "")
                    v   = item.get("v", {})
                    ltp = v.get("lp") or v.get("last_price") or v.get("close_price")
                    if ltp and sym:
                        results[sym] = float(ltp)
        except Exception:
            pass
    return results


# ── Candle history ────────────────────────────────────────────────────────────

def get_candles(fyers, symbol: str, trade_date: date,
                resolution: str = "1") -> pd.DataFrame:
    """
    Fetch OHLCV candles for a symbol on a given date.
    Returns DataFrame with IST datetime index.
    """
    date_str = trade_date.strftime("%Y-%m-%d")
    try:
        resp = fyers.history(data={
            "symbol":      symbol,
            "resolution":  str(resolution),
            "date_format": "1",
            "range_from":  date_str,
            "range_to":    date_str,
            "cont_flag":   "1",
        })
        if resp.get("s") == "ok" and resp.get("candles"):
            raw  = resp["candles"]
            ncol = len(raw[0]) if raw else 6
            cols = ["timestamp","open","high","low","close","volume"]
            if ncol > 6:
                cols.append("extra")
            df = pd.DataFrame(raw, columns=cols[:ncol])
            df["datetime"] = (
                pd.to_datetime(df["timestamp"], unit="s")
                .dt.tz_localize("UTC")
                .dt.tz_convert("Asia/Kolkata")
                .dt.tz_localize(None)
            )
            return df[["datetime","open","high","low","close","volume"]].set_index("datetime")
    except Exception:
        pass
    return pd.DataFrame()


# ── Spread computation ────────────────────────────────────────────────────────

def compute_spread_series(
    fyers,
    sym1: str, sym2: str,
    trade_date: date,
    ratio: float = 1.0,
    resolution: str = "1",
    sym3: Optional[str] = None,
    strategy: str = "index_p1",
    multiplier: float = 3.3,
) -> pd.DataFrame:
    """
    Fetch candles for two (or three, for butterfly strategies) symbols and
    compute the spread series.

    Two-leg (index_p1/index_p2/nfo_bfo):
      spread      = leg1_close - leg2_close * ratio
      spread_high = leg1_high  - leg2_low   * ratio
      spread_low  = leg1_low   - leg2_high  * ratio

    Three-leg butterfly (butterfly_index/butterfly_nfo), sym3 given:
      spread      = leg1_close - 2*(leg2_close*ratio) + leg3_close
      spread_high = leg1_high  - 2*(leg2_low*ratio)    + leg3_high
      spread_low  = leg1_low   - 2*(leg2_high*ratio)   + leg3_low

    `multiplier` is accepted for signature compatibility with callers that
    derive the L2 strike from it before building sym2 — it does not affect
    this calculation, since sym2 already reflects the derived strike.
    """
    df1 = get_candles(fyers, sym1, trade_date, resolution)
    df2 = get_candles(fyers, sym2, trade_date, resolution)

    if df1.empty or df2.empty:
        return pd.DataFrame()

    df1 = df1[~df1.index.duplicated(keep="last")]
    df2 = df2[~df2.index.duplicated(keep="last")]

    is_butterfly = strategy in ("butterfly_index", "butterfly_nfo")

    if is_butterfly and sym3:
        df3 = get_candles(fyers, sym3, trade_date, resolution)
        if df3.empty:
            return pd.DataFrame()
        df3 = df3[~df3.index.duplicated(keep="last")]

        common = df1.index.intersection(df2.index).intersection(df3.index)
        if common.empty:
            return pd.DataFrame()

        return pd.DataFrame({
            "timestamp":   common,
            "leg1_price":  df1.loc[common, "close"].values,
            "leg2_price":  df2.loc[common, "close"].values,
            "leg3_price":  df3.loc[common, "close"].values,
            "spread":      (df1.loc[common, "close"] - 2 * df2.loc[common, "close"] * ratio + df3.loc[common, "close"]).values,
            "spread_high": (df1.loc[common, "high"]  - 2 * df2.loc[common, "low"]   * ratio + df3.loc[common, "high"]).values,
            "spread_low":  (df1.loc[common, "low"]   - 2 * df2.loc[common, "high"]  * ratio + df3.loc[common, "low"]).values,
        })

    common = df1.index.intersection(df2.index)
    if common.empty:
        return pd.DataFrame()

    result = pd.DataFrame({
        "timestamp":   common,
        "leg1_price":  df1.loc[common, "close"].values,
        "leg2_price":  df2.loc[common, "close"].values,
        "spread":      (df1.loc[common, "close"] - df2.loc[common, "close"] * ratio).values,
        "spread_high": (df1.loc[common, "high"]  - df2.loc[common, "low"]   * ratio).values,
        "spread_low":  (df1.loc[common, "low"]   - df2.loc[common, "high"]  * ratio).values,
    })
    return result


def compute_day_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {"open": None, "high": None, "low": None, "current": None,
                "high_time": None, "low_time": None}

    h_col = "spread_high" if "spread_high" in df.columns else "spread"
    l_col = "spread_low"  if "spread_low"  in df.columns else "spread"

    hi_idx = df[h_col].idxmax()
    lo_idx = df[l_col].idxmin()

    return {
        "open":      round(float(df["spread"].iloc[0]), 2),
        "high":      round(float(df[h_col].max()), 2),
        "low":       round(float(df[l_col].min()), 2),
        "current":   round(float(df["spread"].iloc[-1]), 2),
        "high_time": str(df.loc[hi_idx, "timestamp"]),
        "low_time":  str(df.loc[lo_idx, "timestamp"]),
    }
