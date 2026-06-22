import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'
import connectDB from '@/lib/mongodb'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Auth optional for debug — remove this endpoint after diagnosing
  const auth = await getAuthUser(req).catch(() => null)
  void auth

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    platform: {
      node: process.version,
      env: process.env.NODE_ENV,
      render: !!process.env.RENDER,
      vercel: !!process.env.VERCEL,
      port: process.env.PORT,
    },
  }

  // 1. MongoDB
  try {
    await connectDB()
    results.mongodb = 'connected'
  } catch (e) {
    results.mongodb = `ERROR: ${(e as Error).message}`
  }

  // 2. Baileys version fetch (the suspected culprit)
  try {
    const start = Date.now()
    const { fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys')
    const result = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout after 5s')), 5_000)),
    ])
    results.baileysVersionFetch = { ok: true, version: result.version, ms: Date.now() - start }
  } catch (e) {
    results.baileysVersionFetch = { ok: false, error: (e as Error).message }
  }

  // 3. WhatsApp reachability (can we reach WA servers?)
  try {
    const start = Date.now()
    const res = await Promise.race([
      fetch('https://web.whatsapp.com/', { method: 'HEAD' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout after 5s')), 5_000)),
    ])
    results.whatsappReachable = { ok: res.ok || res.status < 500, status: res.status, ms: Date.now() - start }
  } catch (e) {
    results.whatsappReachable = { ok: false, error: (e as Error).message }
  }

  // 4. WA Manager state (only if authenticated)
  if (auth) {
    try {
      const manager = getWAManager(auth.id)
      results.manager = {
        status: manager.status,
        hasQR: !!manager.qrDataURL,
        isAutoReconnecting: manager.isAutoReconnecting,
        hasSavedCreds: manager.hasSavedCreds(),
      }
    } catch (e) {
      results.manager = `ERROR: ${(e as Error).message}`
    }
  } else {
    results.manager = 'skipped (not authenticated)'
  }

  return Response.json(results, { status: 200 })
}
