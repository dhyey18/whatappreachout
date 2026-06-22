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

    // Fast path: in-memory state is always authoritative for the running instance.
    if (manager.status === 'connected') {
      return Response.json({
        status: 'connected',
        phone: manager.phoneNumber,
        hasQR: false,
        qrDataURL: null,
        isAutoReconnecting: false,
        pairingCode: null,
      })
    }

    // Read MongoDB to fill in data this instance hasn't received in-memory yet.
    // On Vercel (multi-instance), another instance may hold the active socket.
    // On Railway (single instance), DB is the source of pairing codes and QR URLs
    // that were written asynchronously by background Baileys event handlers.
    let qrDataURL = manager.qrDataURL
    let finalStatus = manager.status
    let finalPhone = manager.phoneNumber
    let finalIsAutoReconnecting = manager.isAutoReconnecting
    let pairingCode: string | null = null

    try {
      await connectDB()
      const { WASession } = await import('@/lib/models/WASession')
      const session = await WASession.findOne(
        { userId: auth.id },
        { qrDataURL: 1, status: 1, phoneNumber: 1, isAutoReconnecting: 1, pairingCode: 1 },
      ).lean()

      if (session) {
        pairingCode = (session.pairingCode as string | null) ?? null

        if (session.status === 'connected') {
          // DB says connected but this instance is not — another instance holds the socket.
          // Report as 'connecting' with auto-reconnect so the UI waits rather than resetting.
          finalStatus = 'connecting'
          finalPhone = (session.phoneNumber as string | null) ?? null
          finalIsAutoReconnecting = true
          qrDataURL = null
        } else if (session.status === 'connecting') {
          finalStatus = 'connecting'
          finalIsAutoReconnecting = (session.isAutoReconnecting as boolean | undefined) ?? false
          if (!qrDataURL && session.qrDataURL) {
            qrDataURL = session.qrDataURL as string
          }
        } else if (manager.status === 'disconnected' && !qrDataURL && session.qrDataURL) {
          // DB has a QR URL that the in-memory manager hasn't seen yet (async write lag)
          qrDataURL = session.qrDataURL as string
          finalStatus = 'connecting'
          if (session.isAutoReconnecting !== undefined) {
            finalIsAutoReconnecting = session.isAutoReconnecting as boolean
          }
        }
      }
    } catch {
      // MongoDB unavailable — fall through with in-memory state
    }

    return Response.json({
      status: finalStatus,
      phone: finalPhone,
      hasQR: !!qrDataURL,
      qrDataURL,
      isAutoReconnecting: finalIsAutoReconnecting,
      pairingCode,
    })
  } catch (err) {
    console.error('[whatsapp/status] error:', err)
    return Response.json({
      status: 'disconnected',
      phone: null,
      hasQR: false,
      qrDataURL: null,
      isAutoReconnecting: false,
      pairingCode: null,
    })
  }
}
