"""
routers/auth.py
===============
Fyers authentication endpoints.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
from services.fyers_service import get_auth_url, exchange_code_for_token

router = APIRouter()

CLIENT_ID    = os.environ.get("FYERS_CLIENT_ID", "")
SECRET_KEY   = os.environ.get("FYERS_SECRET_KEY", "")
REDIRECT_URI = os.environ.get("FYERS_REDIRECT_URI", "http://localhost:5173/auth/callback")


class TokenRequest(BaseModel):
    auth_code: str


class TokenResponse(BaseModel):
    access_token: str
    client_id: str


@router.get("/login-url")
def get_login_url():
    """Get the Fyers OAuth login URL."""
    if not CLIENT_ID or not SECRET_KEY:
        raise HTTPException(status_code=500, detail="Fyers credentials not configured")
    url = get_auth_url(CLIENT_ID, SECRET_KEY, REDIRECT_URI)
    return {"url": url}


@router.post("/token", response_model=TokenResponse)
def generate_token(body: TokenRequest):
    """Exchange auth code for access token."""
    if not CLIENT_ID or not SECRET_KEY:
        raise HTTPException(status_code=500, detail="Fyers credentials not configured")

    token = exchange_code_for_token(
        CLIENT_ID, SECRET_KEY, REDIRECT_URI, body.auth_code
    )
    if not token:
        raise HTTPException(status_code=401, detail="Invalid auth code or token generation failed")

    return TokenResponse(access_token=token, client_id=CLIENT_ID)


@router.get("/extract-code")
def extract_auth_code(url: str):
    """Extract auth_code from a Fyers redirect URL."""
    from urllib.parse import urlparse, parse_qs
    try:
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        code   = params.get("auth_code", [None])[0]
        if not code:
            raise HTTPException(status_code=400, detail="auth_code not found in URL")
        return {"auth_code": code}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
