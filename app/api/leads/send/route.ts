import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead } from '@/lib/models/Lead'
import { Message } from '@/lib/models/Message'
import { getWAManager } from '@/lib/whatsapp-manager'
import { buildOutreachMessage } from '@/lib/message-templates'
import { isSocialUrl } from '@/lib/lead-utils'
import type { TemplateConfig } from '@/lib/message-templates'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const manager = getWAManager()
    if (manager.status !== 'connected') {
      return Response.json({ error: 'WhatsApp not connected. Please scan the QR code first.' }, { status: 400 })
    }

    const body = await req.json()
    const { leadId, stage, customMessage, templateConfig } = body as {
      leadId: string
      stage?: number
      customMessage?: string
      templateConfig?: Partial<TemplateConfig>
    }

    if (!leadId) return Response.json({ error: 'leadId required' }, { status: 400 })

    await connectDB()
    const lead = await Lead.findOne({ _id: leadId, userId: auth.id })
    if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })

    const stageNum = (stage || 1) as 1 | 2
    const socialOnly = isSocialUrl(lead.website)
    const hasWebsite = !!lead.website && !socialOnly

    const message = customMessage?.trim()
      ? customMessage.trim()
      : buildOutreachMessage(lead.name, lead.industry, hasWebsite, socialOnly, lead.city, stageNum, templateConfig)

    await manager.sendMessage(lead.phone, message)

    const newStatus = stageNum === 1 ? 'stage1_sent' : 'stage2_sent'
    await Lead.updateOne(
      { _id: leadId },
      { status: newStatus, stage: stageNum, lastContactedAt: new Date() }
    )

    await Message.create({
      userId: auth.id,
      contactId: leadId,
      phone: lead.phone,
      content: message,
      status: 'sent',
      direction: 'outbound',
      sentAt: new Date(),
    })

    return Response.json({ success: true, message })
  } catch (e: unknown) {
    const msg = (e as Error).message || 'Failed to send'
    const status = msg.includes('not connected') || msg.includes('connection') ? 400 : 500
    return Response.json({ error: msg }, { status })
  }
}
