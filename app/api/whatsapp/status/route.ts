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

    // Fast path: this instance has an active socket — in-memory is authoritative.
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

    // Slower path: read MongoDB to fill in cross-instance gaps.
    // This is the primary delivery mechanism on Vercel Hobby because SSE is
    // limited to 10 s — all QR codes, pairing codes, and status changes flow
    // through this 3 s poll.
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
        // Pairing code — always return it if present (regardless of status)
        pairingCode = (session.pairingCode as string | null) ?? null

        if (session.status === 'connected') {
          // Another instance has the live socket
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
        } else if (!qrDataURL && session.qrDataURL) {
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
