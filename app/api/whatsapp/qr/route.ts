import { NextRequest } from 'next/server'
import { getAuthUser, verifyToken } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // EventSource cannot send custom headers — accept token as query param too
  let auth = await getAuthUser(req)
  if (!auth) {
    const token = req.nextUrl.searchParams.get('token')
    if (token) auth = verifyToken(token)
  }
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const manager = getWAManager()
  const encoder = new TextEncoder()

  // If already connected, return a simple JSON response (not SSE)
  if (manager.status === 'connected') {
    return Response.json({ type: 'connected', phone: manager.phoneNumber })
  }

  // If disconnected, start connecting now
  if (manager.status === 'disconnected') {
    manager.connect().catch(() => {})
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false

      const send = (payload: object) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {
          closed = true
        }
      }

      const close = () => {
        if (closed) return
        closed = true
        cleanup()
        try { controller.close() } catch {}
      }

      // Send current QR immediately if we already have one
      if (manager.qrDataURL) {
        send({ type: 'qr', qrDataURL: manager.qrDataURL })
      }
      send({ type: 'status', status: manager.status, isAutoReconnecting: manager.isAutoReconnecting })

      // Keep-alive ping every 15s — prevents proxies / Next.js from buffering the stream
      const keepAlive = setInterval(() => {
        if (closed) { clearInterval(keepAlive); return }
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          closed = true
          clearInterval(keepAlive)
        }
      }, 15_000)

      const onQR = (qrDataURL: string) => send({ type: 'qr', qrDataURL })
      const onConnected = (phone: string) => {
        send({ type: 'connected', phone })
        close()
      }
      const onStatus = (status: string) => send({ type: 'status', status, isAutoReconnecting: manager.isAutoReconnecting })
      const onLoggedOut = () => {
        send({ type: 'logged-out' })
        close()
      }

      manager.emitter.on('qr', onQR)
      manager.emitter.on('connected', onConnected)
      manager.emitter.on('status', onStatus)
      manager.emitter.on('logged-out', onLoggedOut)

      const cleanup = () => {
        clearInterval(keepAlive)
        manager.emitter.off('qr', onQR)
        manager.emitter.off('connected', onConnected)
        manager.emitter.off('status', onStatus)
        manager.emitter.off('logged-out', onLoggedOut)
      }

      req.signal.addEventListener('abort', close)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
