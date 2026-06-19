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
      })
    }

    // Slower path: in-memory is 'connecting' or 'disconnected'.
    // On Vercel, another instance may hold the active socket or QR — read MongoDB
    // to fill in cross-instance gaps so the frontend gets the right picture.
    let qrDataURL = manager.qrDataURL
    let finalStatus = manager.status
    let finalPhone = manager.phoneNumber
    let finalIsAutoReconnecting = manager.isAutoReconnecting

    try {
      await connectDB()
      const { WASession } = await import('@/lib/models/WASession')
      const session = await WASession.findOne(
        { userId: auth.id },
        { qrDataURL: 1, status: 1, phoneNumber: 1, isAutoReconnecting: 1 },
      ).lean()

      if (session) {
        if (session.status === 'connected') {
          // Another instance has the live socket — we're in the middle of restoring.
          // Show 'connecting' + isAutoReconnecting so the UI shows "Restoring session…"
          // instead of "Not connected". The background reconnect will finish shortly.
          finalStatus = 'connecting'
          finalPhone = (session.phoneNumber as string | null) ?? null
          finalIsAutoReconnecting = true
          qrDataURL = null
        } else if (session.status === 'connecting') {
          // Another instance is reconnecting — mirror its state so we don't flash
          // "Not connected" while the reconnect is underway.
          finalStatus = 'connecting'
          finalIsAutoReconnecting = (session.isAutoReconnecting as boolean | undefined) ?? false
          if (!qrDataURL && session.qrDataURL) {
            qrDataURL = session.qrDataURL as string
          }
        } else if (!qrDataURL && session.qrDataURL) {
          // DB has a QR from a previous attempt on another instance — surface it
          // and show 'connecting' so the user can scan it.
          qrDataURL = session.qrDataURL as string
          finalStatus = 'connecting'
          if (session.isAutoReconnecting !== undefined) {
            finalIsAutoReconnecting = session.isAutoReconnecting as boolean
          }
        }
      }
    } catch {
      // MongoDB unavailable — fall through with in-memory state, don't break the poll
    }

    return Response.json({
      status: finalStatus,
      phone: finalPhone,
      hasQR: !!qrDataURL,
      qrDataURL,
      isAutoReconnecting: finalIsAutoReconnecting,
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
