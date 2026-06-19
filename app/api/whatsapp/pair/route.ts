import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

// Fire-and-forget: returns immediately so Vercel Hobby's 10 s limit is not hit.
// The pairing code is written to MongoDB and delivered via the status poll.
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

    // Start async — does not block
    manager.startPairingCode(phone)

    return Response.json({ status: 'starting' })
  } catch (e: unknown) {
    return Response.json({ error: (e as Error).message || 'Failed to start pairing' }, { status: 500 })
  }
}
