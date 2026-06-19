import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

export async function POST(req: NextRequest) {
  const auth = await getAuthUser(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const manager = getWAManager()
    await manager.disconnect()
    return Response.json({ success: true })
  } catch (err) {
    console.error('[whatsapp/disconnect] error:', err)
    return Response.json({ error: 'Disconnect failed' }, { status: 500 })
  }
}
