import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const manager = getWAManager()
  return Response.json({
    status: manager.status,
    phone: manager.phoneNumber,
    hasQR: !!manager.qrDataURL,
    // Include QR data URL so the poll loop can display it even when SSE is stale/buffered
    qrDataURL: manager.qrDataURL,
    isAutoReconnecting: manager.isAutoReconnecting,
  })
}
