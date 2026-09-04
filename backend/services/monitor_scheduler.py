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
from datetime import date, timedelta, datetime
import zoneinfo
IST = zoneinfo.ZoneInfo("Asia/Kolkata")
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

# Today's high/low tracker — resets each trading day
# Key: f"{index}_{strike}_{opt_type}_{exp1}_{exp2}"
_today_high: dict[str, float] = {}
_today_low:  dict[str, float] = {}
_today_date: Optional[str]    = None  # tracks current date to reset daily

# Current Fyers token (updated by auth router when user logs in)
_fyers_token: Optional[str] = None
_fyers_client_id: Optional[str] = None


def update_today_range(key: str, value: float):
    """Update today's high/low for a strike. Resets at start of new trading day."""
    global _today_date, _today_high, _today_low
    from datetime import date
    today_str = str(date.today())
    if _today_date != today_str:
        # New day — reset all tracking
        _today_high.clear()
        _today_low.clear()
        _today_date = today_str
        _alert_sent.clear()  # also reset alerts for the new day
        print(f"[Monitor] New trading day {today_str} — alert state reset")
    if key not in _today_high or value > _today_high[key]:
        _today_high[key] = value
    if key not in _today_low or value < _today_low[key]:
        _today_low[key] = value


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


def generate_strikes(strategy: str, atm: int, addon: int) -> dict:
    """Generate CE and PE strikes based on strategy."""
    if strategy in ("index_p1", "index_p2"):
        return {
            "ce": [atm, atm + addon, atm + 2*addon, atm + 3*addon],
            "pe": [atm, atm - addon, atm - 2*addon, atm - 3*addon],
        }
    return {
        "ce": [atm, atm + addon, atm + 2*addon, atm + 3*addon, atm + 4*addon, atm + 5*addon],
        "pe": [atm, atm - addon, atm - 2*addon, atm - 3*addon, atm - 4*addon, atm - 5*addon],
    }


def round_to_nearest_50(value: float) -> int:
    return int(round(value / 50) * 50)


def derive_l2_strike(l1_strike: int, multiplier: float) -> int:
    return round_to_nearest_50(l1_strike / multiplier)


def compute_spread_value(strategy: str, ltp1, ltp2, ltp3, ratio: float, multiplier: float = 3.3):
    """
    Compute spread based on strategy formula.
    NFO/BFO:       L1 - (L2 * ratio)   — L2 derived from L1/multiplier
    Butterfly NFO: [L1 - (L2*ratio)] + [L3 - (L2*ratio)]
    """
    r = ratio or 1.0
    if ltp1 is None: return None
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
        if ltp2 is None or ltp3 is None: return None
        return round((ltp1 - (ltp2 * r)) + (ltp3 - (ltp2 * r)), 2)
    return None


def get_spread_ltp(fyers,
                    exchange1: str, index1: str, exp1: str,
                    exchange2: str, index2: str, exp_l2: str,
                    l1_strike: int, opt_type: str,
                    strategy: str = "index_p1", ratio: float = 1.0,
                    multiplier: float = 3.3,
                    exp3: str = "", exp_l2b: str = "") -> Optional[float]:
    """Get live spread LTP using strategy formula, supporting multi-index."""
    try:
        from services.fyers_service import build_symbol, get_batch_ltp
        is_multi_idx  = strategy in ("nfo_bfo", "butterfly_nfo")
        is_butterfly  = strategy in ("butterfly_index", "butterfly_nfo")

        l2_strike = derive_l2_strike(l1_strike, multiplier) if is_multi_idx else l1_strike
        sym1 = build_symbol(exchange1, index1, exp1, l1_strike, opt_type)
        sym2 = build_symbol(exchange2, index2, exp_l2, l2_strike, opt_type)
        syms = [sym1, sym2]
        sym3 = sym2b = None

        if is_butterfly:
            sym3 = build_symbol(exchange1, index1, exp3, l1_strike, opt_type)
            syms.append(sym3)
            if is_multi_idx and exp_l2b:
                sym2b = build_symbol(exchange2, index2, exp_l2b, l2_strike, opt_type)
                syms.append(sym2b)

        ltp_map = get_batch_ltp(fyers, syms)
        ltp1 = ltp_map.get(sym1)
        ltp2 = ltp_map.get(sym2)
        ltp3 = ltp_map.get(sym3) if sym3 else None

        if sym2b:
            ltp2b = ltp_map.get(sym2b)
            if ltp2 is not None and ltp2b is not None:
                ltp2 = (ltp2 + ltp2b) / 2

        return compute_spread_value(strategy, ltp1, ltp2, ltp3, ratio, multiplier)
    except Exception as e:
        print(f"[Monitor] LTP error: {e}")
    return None


def get_3d_range(fyers, exchange: str, index: str,
                  exp1: str, exp2: str, strike: int, opt_type: str,
                  days: int = 3) -> tuple[Optional[float], Optional[float]]:
    """Get high and low across last N completed trading days (never includes today)."""
    try:
        from services.fyers_service import build_symbol, compute_spread_series
        sym1 = build_symbol(exchange, index, exp1, strike, opt_type)
        sym2 = build_symbol(exchange, index, exp2, strike, opt_type)

        all_highs, all_lows = [], []
        # FIX: start from yesterday, never today
        d = date.today() - timedelta(days=1)
        # Try up to days*2 calendar days to find enough data
        max_lookback = days * 2 * 2
        attempts = 0

        while len(all_highs) < days and attempts < max_lookback:
            if d.weekday() < 5:
                df = compute_spread_series(fyers, sym1, sym2, d, 1.0, "1")
                if not df.empty:
                    hi = df["spread_high"].dropna()
                    lo = df["spread_low"].dropna()
                    if len(hi) and len(lo):
                        all_highs.append(float(hi.max()))
                        all_lows.append(float(lo.min()))
            d -= timedelta(days=1)
            attempts += 1

        # Return whatever data we have (fallback gracefully)
        if all_highs and all_lows:
            return max(all_highs), min(all_lows)
    except Exception as e:
        print(f"[Monitor] Range error: {e}")
    return None, None


def check_alerts(index: str, strike: int, opt_type: str,
                  exp1: str, exp2: str,
                  current: float, d3_high: float, d3_low: float,
                  prev_close: Optional[float] = None,
                  today_high: Optional[float] = None,
                  today_low:  Optional[float] = None,
                  pc_threshold: float = 10.0):
    """Check if any alert conditions are met and send Telegram."""
    prefix = f"{index}_{strike}_{opt_type}_{exp1}_{exp2}"

    # Near 3D LOW (current <= d3_low + 1)
    if current <= d3_low + 1:
        key = f"{prefix}_near_low"
        if not _alert_sent.get(key):
            msg = alert_near_3d_low(index, strike, opt_type, exp1, exp2, d3_low, d3_high, current,
                                    today_high=today_high, today_low=today_low)
            if send_telegram(msg):
                _alert_sent[key] = True
                print(f"[Monitor] Alert sent: near 3D low for {index} {strike} {opt_type}")

    # 5pts BELOW 3D LOW
    if current <= d3_low - 5:
        key = f"{prefix}_below_low_5"
        if not _alert_sent.get(key):
            pts = d3_low - current
            msg = alert_below_3d_low(index, strike, opt_type, exp1, exp2, d3_low, d3_high, current, pts,
                                     today_high=today_high, today_low=today_low)
            if send_telegram(msg):
                _alert_sent[key] = True
                print(f"[Monitor] Alert sent: below 3D low by 5pts for {index} {strike} {opt_type}")

    # Near 3D HIGH (current >= d3_high - 1)
    if current >= d3_high - 1:
        key = f"{prefix}_near_high"
        if not _alert_sent.get(key):
            msg = alert_near_3d_high(index, strike, opt_type, exp1, exp2, d3_low, d3_high, current,
                                     today_high=today_high, today_low=today_low)
            if send_telegram(msg):
                _alert_sent[key] = True
                print(f"[Monitor] Alert sent: near 3D high for {index} {strike} {opt_type}")

    # 5pts ABOVE 3D HIGH
    if current >= d3_high + 5:
        key = f"{prefix}_above_high_5"
        if not _alert_sent.get(key):
            pts = current - d3_high
            msg = alert_above_3d_high(index, strike, opt_type, exp1, exp2, d3_low, d3_high, current, pts,
                                      today_high=today_high, today_low=today_low)
            if send_telegram(msg):
                _alert_sent[key] = True
                print(f"[Monitor] Alert sent: above 3D high by 5pts for {index} {strike} {opt_type}")

    # Prev close ± threshold alert (once only)
    today_line = f"📊 Today's Range: {today_low:.0f} — {today_high:.0f}\n" if today_high is not None and today_low is not None else ""
    if prev_close is not None:
        if current >= prev_close + pc_threshold:
            key = f"{prefix}_pc_high"
            if not _alert_sent.get(key):
                pts = round(current - prev_close, 2)
                msg = (
                    f"📈 <b>{index} {strike} {opt_type}</b> Prev Close +{pts:.0f} Alert\n"
                    f"Prev Close: <b>{prev_close:.0f}</b> | Current: <b>{current:.0f}</b>\n"
                    f"Threshold: ±{pc_threshold:.0f}\n"
                    f"{today_line}"
                    f"⏰ {datetime.now(IST).strftime('%H:%M:%S')}"
                )
                if send_telegram(msg):
                    _alert_sent[key] = True
        if current <= prev_close - pc_threshold:
            key = f"{prefix}_pc_low"
            if not _alert_sent.get(key):
                pts = round(prev_close - current, 2)
                msg = (
                    f"📉 <b>{index} {strike} {opt_type}</b> Prev Close -{pts:.0f} Alert\n"
                    f"Prev Close: <b>{prev_close:.0f}</b> | Current: <b>{current:.0f}</b>\n"
                    f"Threshold: ±{pc_threshold:.0f}\n"
                    f"{today_line}"
                    f"⏰ {datetime.now(IST).strftime('%H:%M:%S')}"
                )
                if send_telegram(msg):
                    _alert_sent[key] = True

    # Reset alerts if price moves away from boundaries
    if current > d3_low + 5:
        _alert_sent.pop(f"{prefix}_near_low", None)
        _alert_sent.pop(f"{prefix}_below_low_5", None)
    if current < d3_high - 5:
        _alert_sent.pop(f"{prefix}_near_high", None)
        _alert_sent.pop(f"{prefix}_above_high_5", None)


def run_monitor_cycle():
    """Run one cycle of the monitor — fetch LTPs and check alerts."""
    print(f"[Monitor] Running cycle at {datetime.now(IST).strftime('%H:%M:%S')}")

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

            # Auto-fetch 3D ranges if not saved yet
            if not d3_ranges:
                print(f"[Monitor] d3_ranges empty for {index} {exp1}-{exp2}, auto-fetching...")
                try:
                    from services.fyers_service import build_symbol, compute_spread_series
                    from datetime import date as _date
                    strike_map_tmp = generate_strikes(strategy, atm, addon)
                    auto_ranges = {}
                    for ot, strikes_tmp in [("CE", strike_map_tmp["ce"]), ("PE", strike_map_tmp["pe"])]:
                        for s in strikes_tmp:
                            all_h, all_l = [], []
                            d = _date.today() - timedelta(days=1)
                            attempts = 0
                            while len(all_h) < 3 and attempts < 20:
                                if d.weekday() < 5:
                                    sym1 = build_symbol(exchange, index, exp1, s, ot)
                                    sym2 = build_symbol(exchange, index, exp2, s, ot)
                                    df = compute_spread_series(fyers, sym1, sym2, d, ratio, "1")
                                    if not df.empty:
                                        hi = df["spread_high"].dropna()
                                        lo = df["spread_low"].dropna()
                                        if len(hi) and len(lo):
                                            all_h.append(float(hi.max()))
                                            all_l.append(float(lo.min()))
                                d -= timedelta(days=1)
                                attempts += 1
                            if all_h:
                                auto_ranges[f"{s}_{ot}"] = {
                                    "high": round(max(all_h), 2),
                                    "low":  round(min(all_l), 2),
                                    "days_used": len(all_h),
                                }
                    d3_ranges = auto_ranges
                    print(f"[Monitor] Auto-fetched 3D ranges for {index}: {len(d3_ranges)} strikes")
                    # Save back to Supabase so future cycles use cached ranges
                    try:
                        from services.supabase_service import get_supabase
                        sb = get_supabase()
                        rows = sb.table("monitor_configs").select("id,sections").execute()
                        for row in (rows.data or []):
                            updated_sections = []
                            changed = False
                            for sec in (row.get("sections") or []):
                                if sec.get("exp1") == exp1 and sec.get("exp2") == exp2 and sec.get("index") == index:
                                    sec["d3_ranges"] = auto_ranges
                                    changed = True
                                updated_sections.append(sec)
                            if changed:
                                sb.table("monitor_configs").update({"sections": updated_sections}).eq("id", row["id"]).execute()
                                print(f"[Monitor] Saved auto-ranges to Supabase for {index}")
                    except Exception as se:
                        print(f"[Monitor] Could not save auto-ranges: {se}")
                except Exception as re:
                    print(f"[Monitor] Auto-range fetch failed: {re}")

            strategy     = section.get("strategy",     "index_p1")
            ratio        = float(section.get("ratio",        1.0))
            multiplier   = float(section.get("multiplier",   3.3))
            exp3         = section.get("exp3",    "")
            index2       = section.get("index2",  index)
            exchange2    = {"NIFTY":"NSE","BANKNIFTY":"NSE","FINNIFTY":"NSE","MIDCPNIFTY":"NSE","SENSEX":"BSE","BANKEX":"BSE"}.get(index2, "NSE")
            exp_l2a      = section.get("exp_l2a", exp2)
            exp_l2b      = section.get("exp_l2b", "")
            pc_mode      = section.get("pc_mode",      "default")
            pc_threshold = float(section.get("pc_threshold", 10.0))
            effective_pc = pc_threshold if pc_mode == "custom" else 10.0

            strike_map = generate_strikes(strategy, atm, addon)

            for opt_type, strikes in [("CE", strike_map["ce"]), ("PE", strike_map["pe"])]:
                for l1_strike in strikes:
                    current = get_spread_ltp(
                        fyers,
                        exchange, index, exp1,
                        exchange2, index2, exp_l2a,
                        l1_strike, opt_type,
                        strategy=strategy, ratio=ratio,
                        multiplier=multiplier, exp3=exp3, exp_l2b=exp_l2b
                    )
                    if current is None:
                        continue

                    range_key   = f"{l1_strike}_{opt_type}"
                    tracker_key = f"{index}_{l1_strike}_{opt_type}_{exp1}_{exp2}"
                    d3_high     = d3_ranges.get(range_key, {}).get("high")
                    d3_low      = d3_ranges.get(range_key, {}).get("low")
                    prev_close  = section.get("prev_closes", {}).get(range_key)

                    update_today_range(tracker_key, current)
                    t_high = _today_high.get(tracker_key)
                    t_low  = _today_low.get(tracker_key)

                    if d3_high is None or d3_low is None:
                        continue

                    check_alerts(index, l1_strike, opt_type, exp1, exp2,
                                  current, d3_high, d3_low,
                                  prev_close=prev_close,
                                  today_high=t_high, today_low=t_low,
                                  pc_threshold=effective_pc)

        except Exception as e:
            print(f"[Monitor] Section error: {e}")


def is_market_hours() -> bool:
    """Check if current time is within NSE market hours (9:15 AM - 3:30 PM IST, Mon-Fri)."""
    now = datetime.now(IST)
    if now.weekday() >= 5:  # Saturday or Sunday
        return False
    market_open  = now.replace(hour=9,  minute=15, second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=30, second=0, microsecond=0)
    return market_open <= now <= market_close


def _scheduler_loop():
    """Background loop — runs every 30 seconds."""
    print("[Monitor] Scheduler started!")
    send_telegram(
        "🟢 <b>Option Spread Analyzer</b>\n"
        "Monitor scheduler started!\n"
        f"⏰ {datetime.now(IST).strftime('%H:%M:%S')}"
    )

    last_heartbeat = time.time()
    HEARTBEAT_INTERVAL = 15 * 60  # 15 minutes in seconds

    while True:
        try:
            if is_market_hours():
                run_monitor_cycle()

                # Send heartbeat every 15 minutes
                now = time.time()
                if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                    send_telegram(
                        f"💚 <b>Monitor Active</b>\n"
                        f"Scheduler running normally\n"
                        f"⏰ {datetime.now(IST).strftime('%H:%M:%S')}"
                    )
                    last_heartbeat = now
            else:
                print(f"[Monitor] Outside market hours — skipping cycle")
        except Exception as e:
            print(f"[Monitor] Cycle error: {e}")
        time.sleep(30)


def start_scheduler():
    """Start the background scheduler thread."""
    t = threading.Thread(target=_scheduler_loop, daemon=True)
    t.start()
    print("[Monitor] Background scheduler thread started")
