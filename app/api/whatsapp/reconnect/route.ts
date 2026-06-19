import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

export async function POST(req: NextRequest) {
  const auth = await getAuthUser(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const manager = getWAManager()
    // force=true: closes any stale socket and starts fresh even if stuck in 'connecting'
    manager.connect(true).catch(console.error)
    return Response.json({ status: manager.status, isAutoReconnecting: manager.isAutoReconnecting })
  } catch (err) {
    console.error('[whatsapp/reconnect] error:', err)
    return Response.json({ error: 'Failed to start connection' }, { status: 503 })
  }
}
