"""
main.py — FastAPI entry point
Option Spread Analyzer Backend
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, spreads, instruments, straddle, monitor

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
app.include_router(monitor.router,     prefix="/api/monitor",      tags=["Monitor"])


@app.on_event("startup")
async def startup_event():
    """Start background scheduler on app startup."""
    from services.monitor_scheduler import start_scheduler
    start_scheduler()
    print("[App] Background scheduler started!")


@app.get("/")
def root():
    return {"status": "ok", "message": "Option Spread Analyzer API v2.0"}


@app.get("/health")
def health():
    return {"status": "healthy"}
