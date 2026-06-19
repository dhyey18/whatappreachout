import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { Message } from '@/lib/models/Message'
import { Contact } from '@/lib/models/Contact'
import { getAuthUser } from '@/lib/auth'
import { getWAManager } from '@/lib/whatsapp-manager'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const manager = getWAManager(auth.id)
    if (manager.status !== 'connected') {
      return Response.json({ error: 'WhatsApp is not connected. Please scan the QR code first.' }, { status: 400 })
    }

    const { phone, message, contactId } = await req.json()
    if (!phone || !message) {
      return Response.json({ error: 'Phone and message are required' }, { status: 400 })
    }

    await manager.sendMessage(phone, message)

    await connectDB()

    let resolvedContactId = contactId
    if (!resolvedContactId) {
      const contact = await Contact.findOne({ userId: auth.id, phone })
      resolvedContactId = contact ? String(contact._id) : 'unknown'
    }

    await Message.create({
      userId: auth.id,
      contactId: resolvedContactId,
      phone,
      content: message,
      status: 'sent',
      direction: 'outbound',
      sentAt: new Date(),
    })

    return Response.json({ success: true })
  } catch (e: unknown) {
    return Response.json({ error: (e as Error).message || 'Failed to send message' }, { status: 500 })
  }
}
