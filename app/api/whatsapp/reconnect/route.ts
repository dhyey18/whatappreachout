import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

export async function POST(req: NextRequest) {
  const auth = await getAuthUser(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const manager = getWAManager()
  // Reset status so connect() isn't a no-op
  if (manager.status !== 'connecting') {
    manager.status = 'disconnected'
  }
  manager.connect().catch(() => {})
  return Response.json({ status: manager.status, isAutoReconnecting: manager.isAutoReconnecting })
}
