# Option Spread Analyzer V2

Real-time NFO-BFO option spread analysis dashboard.

## Tech Stack

| Layer     | Technology        |
|-----------|------------------|
| Frontend  | React + Vite + Tailwind |
| Backend   | FastAPI (Python) |
| Auth      | Fyers API OAuth  |
| Deploy FE | Vercel (free)    |
| Deploy BE | Render (free)    |

---

## Project Structure

```
spread-analyzer-v2/
├── backend/
│   ├── main.py               ← FastAPI app
│   ├── requirements.txt
│   ├── render.yaml
│   ├── routers/
│   │   ├── auth.py           ← Fyers login endpoints
│   │   ├── instruments.py    ← Expiries, strikes
│   │   └── spreads.py        ← Live LTP + history
│   └── services/
│       └── fyers_service.py  ← All Fyers API logic
│
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── vercel.json
    └── src/
        ├── App.jsx
        ├── main.jsx
        ├── pages/
        │   ├── LoginPage.jsx
        │   ├── GenerateCodePage.jsx
        │   └── NfoBfoPage.jsx
        ├── components/
        │   ├── layout/DashboardLayout.jsx
        │   ├── SpreadChart.jsx
        │   └── SpreadTableRow.jsx
        ├── hooks/
        │   └── useAuthStore.js
        └── utils/
            └── api.js
```

---

## Setup Guide

### Step 1 — Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/spread-analyzer-v2.git
cd spread-analyzer-v2
```

### Step 2 — Backend setup (local)
```bash
cd backend
cp .env.example .env
# Fill in your Fyers credentials in .env
pip install -r requirements.txt
uvicorn main:app --reload
# API runs at http://localhost:8000
```

### Step 3 — Frontend setup (local)
```bash
cd frontend
npm install
# No .env needed for local dev (proxies to localhost:8000)
npm run dev
# App runs at http://localhost:5173
```

---

## Deployment

### Deploy Backend to Render
1. Go to render.com → New → Web Service
2. Connect your GitHub repo
3. Set Root Directory: `backend`
4. Add environment variables:
   - `FYERS_CLIENT_ID`
   - `FYERS_SECRET_KEY`
   - `FYERS_REDIRECT_URI` → your Vercel URL + `/auth/callback`
5. Deploy

### Deploy Frontend to Vercel
1. Go to vercel.com → New Project
2. Import your GitHub repo
3. Set Root Directory: `frontend`
4. Add environment variable:
   - `VITE_API_URL` → your Render backend URL + `/api`
5. Deploy

### Update Fyers Redirect URI
After deploying frontend, update in Fyers API dashboard:
```
Redirect URI: https://your-app.vercel.app/auth/callback
```

---

## Daily Login Flow

Fyers tokens expire at midnight every day.

1. Open the app → click **Login with Fyers**
2. Fyers redirects back with `auth_code` in URL
3. App auto-exchanges it for an access token
4. Token is stored in localStorage (expires at midnight)

---

## Features

- ✅ Fyers OAuth login
- ✅ Generate auth code helper page
- ✅ NFO-BFO spread table (2 sections)
- ✅ Batch LTP fetching (1 API call for all rows)
- ✅ Live spread chart (line + candlestick)
- ✅ Historical spread chart (1D/5D/1M/6M)
- ✅ Smart Y-axis (fits data range)
- ✅ Market hours X-axis
- ✅ Fetch on button click only (no auto-rerun)
