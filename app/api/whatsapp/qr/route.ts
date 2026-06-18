import { NextRequest } from 'next/server'
import { getAuthUser, verifyToken } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // EventSource cannot send custom headers, so also accept token as query param
  let auth = await getAuthUser(req)
  if (!auth) {
    const token = req.nextUrl.searchParams.get('token')
    if (token) auth = verifyToken(token)
  }
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const manager = getWAManager()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
        } catch {}
      }

      // Send current state immediately
      if (manager.status === 'connected') {
        send({ type: 'connected', phone: manager.phoneNumber })
        controller.close()
        return
      }

      if (manager.qrDataURL) {
        send({ type: 'qr', qrDataURL: manager.qrDataURL })
      }

      send({ type: 'status', status: manager.status })

      const onQR = (qrDataURL: string) => send({ type: 'qr', qrDataURL })
      const onConnected = (phone: string) => {
        send({ type: 'connected', phone })
        cleanup()
        controller.close()
      }
      const onStatus = (status: string) => send({ type: 'status', status })
      const onLoggedOut = () => {
        send({ type: 'logged-out' })
        cleanup()
        controller.close()
      }

      manager.emitter.on('qr', onQR)
      manager.emitter.on('connected', onConnected)
      manager.emitter.on('status', onStatus)
      manager.emitter.on('logged-out', onLoggedOut)

      const cleanup = () => {
        manager.emitter.off('qr', onQR)
        manager.emitter.off('connected', onConnected)
        manager.emitter.off('status', onStatus)
        manager.emitter.off('logged-out', onLoggedOut)
      }

      req.signal.addEventListener('abort', cleanup)

      // Start connecting if idle
      if (manager.status === 'disconnected') {
        manager.connect()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
