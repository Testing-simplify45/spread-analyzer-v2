import { create } from 'zustand'

const STORAGE_KEY = 'osa_auth'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    // Check if token is from today
    if (data.date !== new Date().toISOString().split('T')[0]) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return data
  } catch {
    return null
  }
}

const saved = loadFromStorage()

export const useAuthStore = create((set, get) => ({
  accessToken: saved?.accessToken || null,
  clientId:    saved?.clientId    || null,
  isAuthenticated: !!saved?.accessToken,

  login: (accessToken, clientId) => {
    const data = {
      accessToken,
      clientId,
      date: new Date().toISOString().split('T')[0],
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    set({ accessToken, clientId, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({ accessToken: null, clientId: null, isAuthenticated: false })
  },

  getAuthHeader: () => {
    const { clientId, accessToken } = get()
    if (!clientId || !accessToken) return null
    return `Bearer ${clientId}|${accessToken}`
  },
}))
