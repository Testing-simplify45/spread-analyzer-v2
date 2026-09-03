"""
services/telegram_service.py
============================
Sends Telegram alerts for spread monitor.
"""

import os
import requests
from datetime import datetime
import zoneinfo
IST = zoneinfo.ZoneInfo("Asia/Kolkata")

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")


def send_telegram(message: str) -> bool:
    """Send a message via Telegram bot."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"[Telegram] Not configured. Message: {message}")
        return False
    try:
        url  = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        resp = requests.post(url, json={
            "chat_id":    TELEGRAM_CHAT_ID,
            "text":       message,
            "parse_mode": "HTML",
        }, timeout=10)
        return resp.status_code == 200
    except Exception as e:
        print(f"[Telegram] Error: {e}")
        return False


def fmt_expiry(code: str) -> str:
    """Format expiry code to readable date e.g. 26AUG → 26 Aug"""
    months = {
        "JAN":"Jan","FEB":"Feb","MAR":"Mar","APR":"Apr",
        "MAY":"May","JUN":"Jun","JUL":"Jul","AUG":"Aug",
        "SEP":"Sep","OCT":"Oct","NOV":"Nov","DEC":"Dec",
    }
    code = code.upper().strip()
    for m, ml in months.items():
        if m in code:
            return code.replace(m, f" {ml}").strip()
    return code


def alert_near_3d_low(
    index: str, strike: int, option_type: str,
    exp1: str, exp2: str,
    d3_low: float, d3_high: float, current: float,
) -> str:
    e1 = fmt_expiry(exp1)
    e2 = fmt_expiry(exp2)
    return (
        f"🟡 <b>{index} {strike} {option_type} ({e1} - {e2})</b> near 3D LOW\n"
        f"3D Range: {d3_low:.0f} / {d3_high:.0f} | Current: {current:.0f}\n"
        f"⏰ {datetime.now(IST).strftime('%H:%M:%S')}"
    )


def alert_below_3d_low(
    index: str, strike: int, option_type: str,
    exp1: str, exp2: str,
    d3_low: float, d3_high: float, current: float, pts: float,
) -> str:
    e1 = fmt_expiry(exp1)
    e2 = fmt_expiry(exp2)
    return (
        f"🔴 <b>{index} {strike} {option_type} ({e1} - {e2})</b> BELOW 3D LOW by {pts:.0f}pts\n"
        f"3D Range: {d3_low:.0f} / {d3_high:.0f} | Current: {current:.0f}\n"
        f"⏰ {datetime.now(IST).strftime('%H:%M:%S')}"
    )


def alert_near_3d_high(
    index: str, strike: int, option_type: str,
    exp1: str, exp2: str,
    d3_low: float, d3_high: float, current: float,
) -> str:
    e1 = fmt_expiry(exp1)
    e2 = fmt_expiry(exp2)
    return (
        f"🟡 <b>{index} {strike} {option_type} ({e1} - {e2})</b> near 3D HIGH\n"
        f"3D Range: {d3_low:.0f} / {d3_high:.0f} | Current: {current:.0f}\n"
        f"⏰ {datetime.now(IST).strftime('%H:%M:%S')}"
    )


def alert_above_3d_high(
    index: str, strike: int, option_type: str,
    exp1: str, exp2: str,
    d3_low: float, d3_high: float, current: float, pts: float,
) -> str:
    e1 = fmt_expiry(exp1)
    e2 = fmt_expiry(exp2)
    return (
        f"🔴 <b>{index} {strike} {option_type} ({e1} - {e2})</b> ABOVE 3D HIGH by {pts:.0f}pts\n"
        f"3D Range: {d3_low:.0f} / {d3_high:.0f} | Current: {current:.0f}\n"
        f"⏰ {datetime.now(IST).strftime('%H:%M:%S')}"
    )
