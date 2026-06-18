import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead } from '@/lib/models/Lead'
import { Message } from '@/lib/models/Message'
import { getWAManager } from '@/lib/whatsapp-manager'
import { buildOutreachMessage } from '@/lib/message-templates'
import { isSocialUrl } from '@/lib/lead-utils'
import type { TemplateConfig } from '@/lib/message-templates'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SOCIAL_REGEX = /facebook|instagram|twitter|linkedin|youtube/i

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const manager = getWAManager()
    if (manager.status !== 'connected') {
      return Response.json({ error: 'WhatsApp not connected. Please scan the QR code first.' }, { status: 400 })
    }

    const body = await req.json()
    const {
      city, industry, stage, batchSize = 20, delayMs = 20000,
      websiteType, minRating, templateConfig,
    } = body as {
      city?: string; industry?: string; stage?: number; batchSize?: number; delayMs?: number
      websiteType?: string; minRating?: number; templateConfig?: Partial<TemplateConfig>
    }

    const stageNum = (stage || 1) as 1 | 2

    await connectDB()

    const targetStatus = stageNum === 1 ? 'pending' : 'stage1_sent'
    const query: Record<string, unknown> = { userId: auth.id, status: targetStatus }
    if (city) query.city = city
    if (industry) query.industry = industry
    if (minRating && minRating > 0) query.rating = { $gte: minRating }

    if (websiteType === 'has_website') {
      query.website = { $exists: true, $ne: null, $not: SOCIAL_REGEX }
    } else if (websiteType === 'no_website') {
      query.$or = [{ website: null }, { website: { $exists: false } }, { website: '' }]
    } else if (websiteType === 'social_only') {
      query.website = SOCIAL_REGEX
    }

    const leads = await Lead.find(query).limit(batchSize)
    if (!leads.length) {
      return Response.json({ error: 'No eligible leads found for this batch', sent: 0 })
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch {}
        }

        let sent = 0
        let failed = 0

        for (let i = 0; i < leads.length; i++) {
          const lead = leads[i]
          const socialOnly = isSocialUrl(lead.website)
          const hasWebsite = !!lead.website && !socialOnly
          const message = buildOutreachMessage(
            lead.name, lead.industry, hasWebsite, socialOnly, lead.city, stageNum, templateConfig
          )

          try {
            await manager.sendMessage(lead.phone, message)

            const newStatus = stageNum === 1 ? 'stage1_sent' : 'stage2_sent'
            await Lead.updateOne({ _id: lead._id }, { status: newStatus, stage: stageNum, lastContactedAt: new Date() })
            await Message.create({
              userId: auth.id, contactId: String(lead._id), phone: lead.phone,
              content: message, status: 'sent', direction: 'outbound', sentAt: new Date(),
            })

            sent++
            send({ type: 'progress', sent, failed, total: leads.length, current: lead.name })
          } catch (e: unknown) {
            failed++
            const errMsg = (e as Error).message
            await Lead.updateOne({ _id: lead._id }, { status: 'failed' })
            send({ type: 'progress', sent, failed, total: leads.length, current: lead.name, error: errMsg })

            // Stop batch if connection dropped
            if (errMsg?.includes('connection') || errMsg?.includes('Connection')) {
              send({ type: 'error', message: errMsg })
              controller.close()
              return
            }
          }

          if (i < leads.length - 1) {
            await new Promise((r) => setTimeout(r, delayMs))
          }
        }

        send({ type: 'done', sent, failed, total: leads.length })
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (e: unknown) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
