import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'
import connectDB from '@/lib/mongodb'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const manager = getWAManager(auth.id)

    // In-memory state is authoritative when this instance has an active socket.
    // When status is 'connecting' but no QR has arrived yet, another Vercel
    // instance may have already generated the QR — read it from MongoDB so the
    // frontend can display it without waiting for SSE.
    let qrDataURL = manager.qrDataURL

    if (!qrDataURL && manager.status === 'connecting') {
      try {
        await connectDB()
        const { WASession } = await import('@/lib/models/WASession')
        const session = await WASession.findOne(
          { userId: auth.id },
          { qrDataURL: 1, status: 1, phoneNumber: 1, isAutoReconnecting: 1 },
        ).lean()

        if (session) {
          // If another instance reports 'connected', reflect that here too
          if (session.status === 'connected') {
            return Response.json({
              status: 'connected',
              phone: session.phoneNumber ?? null,
              hasQR: false,
              qrDataURL: null,
              isAutoReconnecting: false,
            })
          }
          if (session.qrDataURL) {
            qrDataURL = session.qrDataURL as string
          }
        }
      } catch {
        // DB unavailable — fall through with in-memory state
      }
    }

    return Response.json({
      status: manager.status,
      phone: manager.phoneNumber,
      hasQR: !!qrDataURL,
      qrDataURL,
      isAutoReconnecting: manager.isAutoReconnecting,
    })
  } catch (err) {
    console.error('[whatsapp/status] error:', err)
    return Response.json({
      status: 'disconnected',
      phone: null,
      hasQR: false,
      qrDataURL: null,
      isAutoReconnecting: false,
    })
  }
}
