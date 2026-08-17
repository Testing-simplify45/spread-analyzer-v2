"""
main.py — FastAPI entry point
Option Spread Analyzer Backend
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, spreads, instruments, straddle

app = FastAPI(
    title="Option Spread Analyzer API",
    version="2.0.0",
    description="Real-time option spread analysis powered by Fyers API",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,        prefix="/api/auth",        tags=["Auth"])
app.include_router(instruments.router, prefix="/api/instruments",  tags=["Instruments"])
app.include_router(spreads.router,     prefix="/api/spreads",      tags=["Spreads"])
app.include_router(straddle.router,    prefix="/api/straddle",     tags=["Straddle"])


@app.get("/")
def root():
    return {"status": "ok", "message": "Option Spread Analyzer API v2.0"}


@app.get("/health")
def health():
    return {"status": "healthy"}
