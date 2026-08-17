import { create } from 'zustand'

export const useNotificationStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,

  addNotification: (notification) => {
    const newNotif = {
      id: Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      read: false,
      ...notification,
    }
    set(state => ({
      notifications: [newNotif, ...state.notifications].slice(0, 50), // max 50
      unreadCount: state.unreadCount + 1,
    }))
  },

  markAllRead: () => {
    set(state => ({
      notifications: state.notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0,
    }))
  },

  clearAll: () => {
    set({ notifications: [], unreadCount: 0 })
  },
}))
