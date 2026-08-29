"""
routers/auth.py - Updated with password verification and profile management
"""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
import os
from services.fyers_service import make_fyers, get_auth_url, exchange_code_for_token

router = APIRouter()

CLIENT_ID    = os.environ.get("FYERS_CLIENT_ID", "")
SECRET_KEY   = os.environ.get("FYERS_SECRET_KEY", "")
REDIRECT_URI = os.environ.get("FYERS_REDIRECT_URI", "http://localhost:5173/auth/callback")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")


def get_supabase():
    """Get Supabase client."""
    try:
        from supabase import create_client
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Supabase connection failed: {e}")


def _get_fyers(authorization: str):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    parts = authorization.split("|")
    if len(parts) != 2:
        raise HTTPException(status_code=401, detail="Token format: client_id|access_token")
    client_id, access_token = parts[0].replace("Bearer ", ""), parts[1]
    return make_fyers(client_id, access_token)


# ── Models ────────────────────────────────────────────────────────────────────

class TokenRequest(BaseModel):
    auth_code: str

class TokenResponse(BaseModel):
    access_token: str
    client_id: str

class PasswordRequest(BaseModel):
    password: str

class ProfileCreate(BaseModel):
    name:     str
    password: str
    role:     str = "guest"

class ProfileUpdate(BaseModel):
    is_active: Optional[bool] = None
    role:      Optional[str]  = None


# ── Fyers Auth ────────────────────────────────────────────────────────────────

@router.get("/login-url")
def get_login_url():
    if not CLIENT_ID or not SECRET_KEY:
        raise HTTPException(status_code=500, detail="Fyers credentials not configured")
    url = get_auth_url(CLIENT_ID, SECRET_KEY, REDIRECT_URI)
    return {"url": url}


@router.post("/token", response_model=TokenResponse)
def generate_token(body: TokenRequest):
    if not CLIENT_ID or not SECRET_KEY:
        raise HTTPException(status_code=500, detail="Fyers credentials not configured")
    token = exchange_code_for_token(CLIENT_ID, SECRET_KEY, REDIRECT_URI, body.auth_code)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid auth code")
    return TokenResponse(access_token=token, client_id=CLIENT_ID)


@router.get("/extract-code")
def extract_auth_code(url: str):
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


# ── Password Verification ─────────────────────────────────────────────────────

@router.post("/verify-password")
def verify_password(body: PasswordRequest):
    """Verify password and return profile role."""
    try:
        supabase = get_supabase()
        result   = supabase.table("profiles")\
            .select("*")\
            .eq("password", body.password)\
            .eq("is_active", True)\
            .execute()

        if not result.data:
            raise HTTPException(status_code=401, detail="Invalid password")

        profile = result.data[0]
        return {
            "role":    profile["role"],
            "name":    profile["name"],
            "profile_id": profile["id"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Profile Management (Admin only) ──────────────────────────────────────────

@router.get("/profiles")
def get_profiles(authorization: str = Header(None)):
    """Get all profiles — requires valid Fyers token."""
    _get_fyers(authorization)  # Verify Fyers auth
    try:
        supabase = get_supabase()
        result   = supabase.table("profiles")\
            .select("id,name,password,role,is_active,created_at")\
            .order("created_at")\
            .execute()
        return {"profiles": result.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/profiles")
def create_profile(body: ProfileCreate, authorization: str = Header(None)):
    """Create a new profile."""
    _get_fyers(authorization)
    try:
        supabase = get_supabase()
        result   = supabase.table("profiles").insert({
            "name":      body.name,
            "password":  body.password,
            "role":      body.role,
            "is_active": True,
        }).execute()
        return {"profile": result.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/profiles/{profile_id}")
def update_profile(profile_id: str, body: ProfileUpdate, authorization: str = Header(None)):
    """Update a profile."""
    _get_fyers(authorization)
    try:
        supabase = get_supabase()
        updates  = {k: v for k, v in body.dict().items() if v is not None}
        result   = supabase.table("profiles")\
            .update(updates)\
            .eq("id", profile_id)\
            .execute()
        return {"profile": result.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/profiles/{profile_id}")
def delete_profile(profile_id: str, authorization: str = Header(None)):
    """Delete a profile."""
    _get_fyers(authorization)
    try:
        supabase = get_supabase()
        supabase.table("profiles").delete().eq("id", profile_id).execute()
        return {"message": "Profile deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
