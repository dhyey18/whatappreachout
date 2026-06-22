import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

// Waits for the full Noise Protocol handshake + pairing code request (~3-15 s).
// Requires maxDuration > 15 to work on serverless platforms.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { phone } = await req.json()
    if (!phone) return Response.json({ error: 'phone is required' }, { status: 400 })

    const manager = getWAManager(auth.id)

    if (manager.status === 'connected') {
      return Response.json({ error: 'Already connected. Disconnect first.' }, { status: 400 })
    }

    const code = await manager.getPairingCode(phone)
    return Response.json({ code })
  } catch (e: unknown) {
    const msg = (e as Error).message || 'Failed to get pairing code'
    console.error('[whatsapp/pair] error:', msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}
