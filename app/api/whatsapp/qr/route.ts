import { NextRequest } from 'next/server'
import { getAuthUser, verifyToken } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'
import connectDB from '@/lib/mongodb'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // seconds — Vercel Pro allows up to 300s for streaming

export async function GET(req: NextRequest) {
  // EventSource cannot send custom headers — accept token as query param too
  let auth = await getAuthUser(req)
  if (!auth) {
    const token = req.nextUrl.searchParams.get('token')
    if (token) auth = verifyToken(token)
  }
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = auth.id

  let manager
  try {
    manager = getWAManager(userId)
  } catch (err) {
    console.error('[whatsapp/qr] getWAManager failed:', err)
    return Response.json({ error: 'WhatsApp manager unavailable' }, { status: 503 })
  }
  const encoder = new TextEncoder()

  // If already connected, return a one-shot SSE message so EventSource doesn't error
  if (manager.status === 'connected') {
    const payload = JSON.stringify({ type: 'connected', phone: manager.phoneNumber })
    return new Response(`data: ${payload}\n\n`, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, no-transform',
        Connection: 'keep-alive',
      },
    })
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      // Track last QR sent via DB poll to avoid sending the same QR twice
      let lastDbQR: string | null = manager.qrDataURL

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

      // Keep-alive ping every 8s — prevents proxies / Next.js from buffering the stream
      const keepAlive = setInterval(() => {
        if (closed) { clearInterval(keepAlive); return }
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          closed = true
          clearInterval(keepAlive)
        }
      }, 8_000)

      // ── MongoDB fallback poll ──────────────────────────────────────────────
      // On Vercel, the WA socket may live on a different instance than this SSE
      // stream. The in-memory emitter never fires in that case. Poll MongoDB
      // every 3 s as a cross-instance fallback so the QR always arrives.
      const dbPoll = setInterval(async () => {
        if (closed) { clearInterval(dbPoll); return }
        try {
          await connectDB()
          const { WASession } = await import('@/lib/models/WASession')
          const session = await WASession.findOne(
            { userId },
            { qrDataURL: 1, status: 1, phoneNumber: 1, isAutoReconnecting: 1 },
          ).lean()
          if (!session) return

          if (session.status === 'connected') {
            // Another instance finished connecting — surface it immediately
            send({ type: 'connected', phone: (session.phoneNumber as string | null) ?? null })
            close()
            return
          }

          const dbQR = session.qrDataURL as string | null
          if (dbQR && dbQR !== lastDbQR) {
            // New QR arrived on another instance — deliver it here
            lastDbQR = dbQR
            send({ type: 'qr', qrDataURL: dbQR })
          }

          if (session.status === 'disconnected' && !dbQR) {
            send({ type: 'status', status: 'disconnected', isAutoReconnecting: false })
          }
        } catch {
          // MongoDB unavailable — rely on in-memory emitter only
        }
      }, 3_000)

      const onQR = (qrDataURL: string) => { lastDbQR = qrDataURL; send({ type: 'qr', qrDataURL }) }
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
        clearInterval(dbPoll)
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
