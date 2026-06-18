import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
}))
