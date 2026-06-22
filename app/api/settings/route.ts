import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Settings } from '@/lib/models/Settings'
import { getUserSettings, sanitizeField, sanitizeTemplates } from '@/lib/settings'
import { DEFAULT_TEMPLATE_CONFIG } from '@/lib/message-templates'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { config, templates } = await getUserSettings(auth.id)
    return Response.json({ ...config, templates })
  } catch (e: unknown) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const auth = await getAuthUser(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json()
    const update = {
      senderName: sanitizeField(body.senderName, DEFAULT_TEMPLATE_CONFIG.senderName),
      senderPhone: sanitizeField(body.senderPhone, DEFAULT_TEMPLATE_CONFIG.senderPhone),
      websitePrice: sanitizeField(body.websitePrice, DEFAULT_TEMPLATE_CONFIG.websitePrice),
      templates: sanitizeTemplates(body.templates),
    }
    await connectDB()
    await Settings.findOneAndUpdate(
      { userId: auth.id },
      { $set: update },
      { upsert: true, new: true }
    )
    return Response.json({ ...update })
  } catch (e: unknown) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
