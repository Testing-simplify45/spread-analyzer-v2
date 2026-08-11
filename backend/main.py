"""
main.py — FastAPI entry point
Option Spread Analyzer Backend
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, spreads, instruments

app = FastAPI(
    title="Option Spread Analyzer API",
    version="2.0.0",
    description="Real-time option spread analysis powered by Fyers API",
)

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Will restrict to Vercel URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router,        prefix="/api/auth",        tags=["Auth"])
app.include_router(instruments.router, prefix="/api/instruments",  tags=["Instruments"])
app.include_router(spreads.router,     prefix="/api/spreads",      tags=["Spreads"])


@app.get("/")
def root():
    return {"status": "ok", "message": "Option Spread Analyzer API v2.0"}


@app.get("/health")
def health():
    return {"status": "healthy"}
