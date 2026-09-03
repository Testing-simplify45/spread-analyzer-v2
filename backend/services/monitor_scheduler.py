"""
services/monitor_scheduler.py
==============================
Background scheduler that runs every 30 seconds.
Fetches live spreads and sends Telegram alerts.
Runs even when browser is closed.
"""

import os
import threading
import time
from datetime import date, timedelta
from typing import Optional
import pandas as pd

from services.telegram_service import (
    send_telegram,
    alert_near_3d_low, alert_below_3d_low,
    alert_near_3d_high, alert_above_3d_high,
)

FYERS_CLIENT_ID = os.environ.get("FYERS_CLIENT_ID", "")
SUPABASE_URL    = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY    = os.environ.get("SUPABASE_KEY", "")

# Alert state — tracks which alerts have been sent to avoid duplicates
# Key: f"{index}_{strike}_{opt_type}_{exp1}_{exp2}_{level}"
_alert_sent: dict[str, bool] = {}

# Current Fyers token (updated by auth router when user logs in)
_fyers_token: Optional[str] = None
_fyers_client_id: Optional[str] = None


def set_fyers_token(client_id: str, access_token: str):
    """Called when user logs in — stores token for background use."""
    global _fyers_token, _fyers_client_id
    _fyers_token    = access_token
    _fyers_client_id = client_id
    print(f"[Monitor] Fyers token updated for {client_id}")


def get_fyers():
    """Get Fyers client if token available."""
    if not _fyers_token or not _fyers_client_id:
        return None
    try:
        from services.fyers_service import make_fyers
        return make_fyers(_fyers_client_id, _fyers_token)
    except Exception:
        return None


def get_supabase():
    """Get Supabase client."""
    try:
        from supabase import create_client
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception:
        return None


def load_monitor_configs():
    """Load all active monitor sections from Supabase."""
    try:
        sb     = get_supabase()
        if not sb:
            return []
        result = sb.table("monitor_configs").select("*").execute()
        configs = []
        for row in (result.data or []):
            sections = row.get("sections", [])
            configs.extend(sections)
        return configs
    except Exception as e:
        print(f"[Monitor] Error loading configs: {e}")
        return []


def get_atm_strike(fyers, index: str, addon: int) -> Optional[int]:
    """Get ATM strike from live spot price."""
    try:
        from services.fyers_service import INDEX_SYMBOL, round_to_nearest
        sym  = INDEX_SYMBOL.get(index)
        if not sym:
            return None
        resp = fyers.quotes(data={"symbols": sym})
        if resp.get("s") == "ok":
            v   = resp["d"][0].get("v", {})
            ltp = float(v.get("lp") or v.get("last_price") or 0)
            if ltp > 0:
                return round_to_nearest(ltp, addon)
    except Exception as e:
        print(f"[Monitor] ATM error for {index}: {e}")
    return None


def generate_strikes(atm: int, addon: int) -> list[int]:
    """Generate 2 ITM + ATM + 4 OTM strikes."""
    return [atm - 2*addon, atm - addon, atm, atm + addon,
            atm + 2*addon, atm + 3*addon, atm + 4*addon]


def get_spread_ltp(fyers, exchange: str, index: str,
                    exp1: str, exp2: str, strike: int, opt_type: str) -> Optional[float]:
    """Get live spread LTP = Leg1 - Leg2."""
    try:
        from services.fyers_service import build_symbol, get_batch_ltp
        sym1 = build_symbol(exchange, index, exp1, strike, opt_type)
        sym2 = build_symbol(exchange, index, exp2, strike, opt_type)
        ltp_map = get_batch_ltp(fyers, [sym1, sym2])
        ltp1 = ltp_map.get(sym1)
        ltp2 = ltp_map.get(sym2)
        if ltp1 is not None and ltp2 is not None:
            return round(ltp1 - ltp2, 2)
    except Exception as e:
        print(f"[Monitor] LTP error: {e}")
    return None


def get_3d_range(fyers, exchange: str, index: str,
                  exp1: str, exp2: str, strike: int, opt_type: str,
                  days: int = 3) -> tuple[Optional[float], Optional[float]]:
    """Get high and low across last N trading days."""
    try:
        from services.fyers_service import build_symbol, compute_spread_series
        sym1 = build_symbol(exchange, index, exp1, strike, opt_type)
        sym2 = build_symbol(exchange, index, exp2, strike, opt_type)

        all_highs, all_lows = [], []
        d = date.today()
        collected = 0

        while collected < days:
            if d.weekday() < 5:
                df = compute_spread_series(fyers, sym1, sym2, d, 1.0, "1")
                if not df.empty:
                    spreads = df["spread"].dropna().values
                    if len(spreads):
                        all_highs.append(float(spreads.max()))
                        all_lows.append(float(spreads.min()))
                collected += 1
            d -= timedelta(days=1)

        if all_highs and all_lows:
            return max(all_highs), min(all_lows)
    except Exception as e:
        print(f"[Monitor] Range error: {e}")
    return None, None


def check_alerts(index: str, strike: int, opt_type: str,
                  exp1: str, exp2: str,
                  current: float, d3_high: float, d3_low: float):
    """Check if any alert conditions are met and send Telegram."""
    prefix = f"{index}_{strike}_{opt_type}_{exp1}_{exp2}"

    # Near 3D LOW (current <= d3_low + 1)
    if current <= d3_low + 1:
        key = f"{prefix}_near_low"
        if not _alert_sent.get(key):
            msg = alert_near_3d_low(index, strike, opt_type, exp1, exp2, d3_low, d3_high, current)
            if send_telegram(msg):
                _alert_sent[key] = True
                print(f"[Monitor] Alert sent: near 3D low for {index} {strike} {opt_type}")

    # 5pts BELOW 3D LOW
    if current <= d3_low - 5:
        key = f"{prefix}_below_low_5"
        if not _alert_sent.get(key):
            pts = d3_low - current
            msg = alert_below_3d_low(index, strike, opt_type, exp1, exp2, d3_low, d3_high, current, pts)
            if send_telegram(msg):
                _alert_sent[key] = True
                print(f"[Monitor] Alert sent: below 3D low by 5pts for {index} {strike} {opt_type}")

    # Near 3D HIGH (current >= d3_high - 1)
    if current >= d3_high - 1:
        key = f"{prefix}_near_high"
        if not _alert_sent.get(key):
            msg = alert_near_3d_high(index, strike, opt_type, exp1, exp2, d3_low, d3_high, current)
            if send_telegram(msg):
                _alert_sent[key] = True
                print(f"[Monitor] Alert sent: near 3D high for {index} {strike} {opt_type}")

    # 5pts ABOVE 3D HIGH
    if current >= d3_high + 5:
        key = f"{prefix}_above_high_5"
        if not _alert_sent.get(key):
            pts = current - d3_high
            msg = alert_above_3d_high(index, strike, opt_type, exp1, exp2, d3_low, d3_high, current, pts)
            if send_telegram(msg):
                _alert_sent[key] = True
                print(f"[Monitor] Alert sent: above 3D high by 5pts for {index} {strike} {opt_type}")

    # Reset alerts if price moves away from boundaries
    if current > d3_low + 5:
        _alert_sent.pop(f"{prefix}_near_low", None)
        _alert_sent.pop(f"{prefix}_below_low_5", None)
    if current < d3_high - 5:
        _alert_sent.pop(f"{prefix}_near_high", None)
        _alert_sent.pop(f"{prefix}_above_high_5", None)


def run_monitor_cycle():
    """Run one cycle of the monitor — fetch LTPs and check alerts."""
    print(f"[Monitor] Running cycle at {time.strftime('%H:%M:%S')}")

    fyers = get_fyers()
    if not fyers:
        print("[Monitor] No Fyers token — skipping cycle")
        return

    sections = load_monitor_configs()
    if not sections:
        print("[Monitor] No monitor configs — skipping")
        return

    for section in sections:
        try:
            exchange = section.get("exchange", "NSE")
            index    = section.get("index",    "NIFTY")
            exp1     = section.get("exp1",     "")
            exp2     = section.get("exp2",     "")
            addon    = int(section.get("addon", 100))
            d3_ranges = section.get("d3_ranges", {})  # pre-computed ranges

            if not exp1 or not exp2:
                continue

            # Get ATM
            atm = get_atm_strike(fyers, index, addon)
            if not atm:
                continue

            strikes = generate_strikes(atm, addon)

            for strike in strikes:
                for opt_type in ["CE", "PE"]:
                    current = get_spread_ltp(fyers, exchange, index, exp1, exp2, strike, opt_type)
                    if current is None:
                        continue

                    # Get pre-computed 3D range
                    range_key = f"{strike}_{opt_type}"
                    d3_high   = d3_ranges.get(range_key, {}).get("high")
                    d3_low    = d3_ranges.get(range_key, {}).get("low")

                    if d3_high is None or d3_low is None:
                        continue

                    check_alerts(index, strike, opt_type, exp1, exp2,
                                  current, d3_high, d3_low)

        except Exception as e:
            print(f"[Monitor] Section error: {e}")


def _scheduler_loop():
    """Background loop — runs every 30 seconds."""
    print("[Monitor] Scheduler started!")
    send_telegram("🟢 <b>Option Spread Analyzer</b>\nMonitor scheduler started!\n⏰ " + 
                  datetime.now().strftime('%H:%M:%S'))
    
    cycle_count = 0
    while True:
        try:
            run_monitor_cycle()
            cycle_count += 1
            
            # Send heartbeat every 15 minutes (30 cycles × 30 seconds = 15 minutes)
            if cycle_count % 30 == 0:
                send_telegram(
                    f"💚 <b>Monitor Active</b>\n"
                    f"Scheduler running normally\n"
                    f"Cycles completed: {cycle_count}\n"
                    f"⏰ {datetime.now().strftime('%H:%M:%S')}"
                )
        except Exception as e:
            print(f"[Monitor] Cycle error: {e}")
        time.sleep(30)


def start_scheduler():
    """Start the background scheduler thread."""
    t = threading.Thread(target=_scheduler_loop, daemon=True)
    t.start()
    print("[Monitor] Background scheduler thread started")
