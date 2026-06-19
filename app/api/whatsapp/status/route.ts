import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const manager = getWAManager(auth.id)
    return Response.json({
      status: manager.status,
      phone: manager.phoneNumber,
      hasQR: !!manager.qrDataURL,
      qrDataURL: manager.qrDataURL,
      isAutoReconnecting: manager.isAutoReconnecting,
    })
  } catch (err) {
    console.error('[whatsapp/status] getWAManager failed:', err)
    // Return a safe default so the frontend doesn't crash on a cold-start error
    return Response.json({
      status: 'disconnected',
      phone: null,
      hasQR: false,
      qrDataURL: null,
      isAutoReconnecting: false,
    })
  }
}
