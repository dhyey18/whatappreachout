import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { Campaign } from '@/lib/models/Campaign'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    await connectDB()
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')

    const query: Record<string, unknown> = { userId: auth.id }
    if (status) query.status = status

    const [campaigns, total] = await Promise.all([
      Campaign.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Campaign.countDocuments(query),
    ])
    return Response.json({ campaigns, total, page, limit, pages: Math.ceil(total / limit) })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    await connectDB()
    const body = await req.json()
    const { name, message, contacts, templateId, scheduledAt } = body
    if (!name || !message) {
      return Response.json({ error: 'Name and message are required' }, { status: 400 })
    }
    const campaign = await Campaign.create({
      userId: auth.id,
      name,
      message,
      contacts: contacts || [],
      templateId,
      scheduledAt,
      stats: {
        total: (contacts || []).length,
        sent: 0,
        delivered: 0,
        failed: 0,
        replied: 0,
      },
    })
    return Response.json({ campaign }, { status: 201 })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
