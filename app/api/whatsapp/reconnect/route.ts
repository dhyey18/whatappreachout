import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = await getAuthUser(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const manager = getWAManager(auth.id)

    // Start the connection (force=true overrides any stale lock)
    manager.connect(true).catch(console.error)

    // Wait up to 8 s for a QR or connected event.
    // This keeps the Vercel function alive long enough for Baileys to finish
    // the WA handshake and generate a QR — typically 3-5 s on a warm instance.
    // Without this wait, the function returns immediately and on Vercel the
    // background Baileys process can be frozen before it ever gets a QR.
    const result = await new Promise<{ qrDataURL?: string; connected?: boolean }>((resolve) => {
      const timer = setTimeout(() => {
        manager.emitter.off('qr', onQR)
        manager.emitter.off('connected', onConnected)
        resolve({})
      }, 8_000)

      const onQR = (qrDataURL: string) => {
        clearTimeout(timer)
        manager.emitter.off('connected', onConnected)
        resolve({ qrDataURL })
      }
      const onConnected = () => {
        clearTimeout(timer)
        manager.emitter.off('qr', onQR)
        resolve({ connected: true })
      }

      manager.emitter.once('qr', onQR)
      manager.emitter.once('connected', onConnected)

      // If already has a QR (e.g. same instance, re-triggered), return immediately
      if (manager.qrDataURL) {
        clearTimeout(timer)
        manager.emitter.off('qr', onQR)
        manager.emitter.off('connected', onConnected)
        resolve({ qrDataURL: manager.qrDataURL })
      }
      if (manager.status === 'connected') {
        clearTimeout(timer)
        manager.emitter.off('qr', onQR)
        manager.emitter.off('connected', onConnected)
        resolve({ connected: true })
      }
    })

    return Response.json({
      status: manager.status,
      isAutoReconnecting: manager.isAutoReconnecting,
      qrDataURL: result.qrDataURL ?? manager.qrDataURL ?? null,
      connected: result.connected ?? false,
    })
  } catch (err) {
    console.error('[whatsapp/reconnect] error:', err)
    return Response.json({ error: 'Failed to start connection' }, { status: 503 })
  }
}
