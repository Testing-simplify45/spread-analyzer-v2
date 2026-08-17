import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
})

// ── Auth ──────────────────────────────────────────────────────────────────────
export const getLoginUrl = () =>
  api.get('/auth/login-url').then(r => r.data.url)

export const generateToken = (authCode) =>
  api.post('/auth/token', { auth_code: authCode }).then(r => r.data)

export const extractAuthCode = (url) =>
  api.get('/auth/extract-code', { params: { url } }).then(r => r.data)

// ── Instruments ───────────────────────────────────────────────────────────────
export const getExpiries = (underlying, authHeader) =>
  api.get(`/instruments/expiries/${underlying}`, {
    headers: { Authorization: authHeader }
  }).then(r => r.data.expiries)

export const getAtm = (underlying) =>
  api.get(`/instruments/atm/${underlying}`).then(r => r.data)

// ── Spreads ───────────────────────────────────────────────────────────────────
export const fetchBatchLtp = (rows, ratio, authHeader) =>
  api.post('/spreads/batch-ltp', { rows, ratio }, {
    headers: { Authorization: authHeader }
  }).then(r => r.data.results)

export const fetchSpreadHistory = (row, tradeDate, resolution, authHeader) =>
  api.post('/spreads/history', row, {
    params:  { trade_date: tradeDate, resolution },
    headers: { Authorization: authHeader },
  }).then(r => r.data)

export const fetchMultiDayHistory = (row, days, resolution, authHeader) =>
  api.post('/spreads/multi-day-history', row, {
    params:  { days, resolution },
    headers: { Authorization: authHeader },
  }).then(r => r.data)

// ── Straddle ──────────────────────────────────────────────────────────────────
export const fetchAllSpots = (authHeader) =>
  api.get('/straddle/all-spots', {
    headers: { Authorization: authHeader }
  }).then(r => r.data)

export const fetchStraddleTable = (underlying, authHeader) =>
  api.get(`/straddle/table/${underlying}`, {
    headers: { Authorization: authHeader }
  }).then(r => r.data)

export const fetchIntradayStraddle = (underlying, expiryCode, atmStrike, authHeader) =>
  api.get(`/straddle/intraday/${underlying}/${expiryCode}`, {
    params:  { atm_strike: atmStrike },
    headers: { Authorization: authHeader }
  }).then(r => r.data)
