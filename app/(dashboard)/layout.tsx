'use client'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { useAuthStore, isTokenExpired } from '@/store/auth'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/contacts': 'Contacts',
  '/campaigns': 'Campaigns',
  '/templates': 'Templates',
  '/analytics': 'Analytics',
  '/whatsapp': 'WhatsApp',
  '/settings': 'Settings',
  '/leads': 'Leads',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const token = useAuthStore((s) => s.token)
  const _hasHydrated = useAuthStore((s) => s._hasHydrated)
  const logout = useAuthStore((s) => s.logout)

  useEffect(() => {
    if (!_hasHydrated) return
    if (!token || isTokenExpired(token)) {
      logout()
      router.push('/login')
    }
  }, [_hasHydrated, token, logout, router])

  // Still rehydrating from localStorage — don't flash a redirect
  if (!_hasHydrated) return null

  if (!token || isTokenExpired(token)) return null

  const title = pageTitles[pathname] || 'WA Reach'

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header title={title} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
