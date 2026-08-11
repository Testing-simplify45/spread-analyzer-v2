"""
routers/instruments.py
======================
Option instrument data — expiries, strikes.
"""

from fastapi import APIRouter, Header, HTTPException
from services.fyers_service import make_fyers, get_expiries, ATM_APPROX, STRIKE_GAP

router = APIRouter()


def _get_fyers(authorization: str):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    parts = authorization.split("|")
    if len(parts) != 2:
        raise HTTPException(status_code=401, detail="Token format: client_id|access_token")
    client_id, access_token = parts[0].replace("Bearer ", ""), parts[1]
    return make_fyers(client_id, access_token)


@router.get("/expiries/{underlying}")
def get_expiry_list(underlying: str, authorization: str = Header(None)):
    """Get available expiry dates for an underlying."""
    fyers    = _get_fyers(authorization)
    expiries = get_expiries(fyers, underlying.upper())
    return {"underlying": underlying, "expiries": expiries}


@router.get("/atm/{underlying}")
def get_atm(underlying: str):
    """Get approximate ATM strike for an underlying."""
    atm = ATM_APPROX.get(underlying.upper(), 25000)
    gap = STRIKE_GAP.get(underlying.upper(), 50)
    rounded = int(round(atm / gap) * gap)
    return {"underlying": underlying, "atm": rounded, "gap": gap}
