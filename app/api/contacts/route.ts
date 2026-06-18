import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { Contact } from '@/lib/models/Contact'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    await connectDB()
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') || ''
    const tag = searchParams.get('tag') || ''
    const status = searchParams.get('status') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const query: Record<string, unknown> = { userId: auth.id }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ]
    }
    if (tag) query.tags = tag
    if (status) query.status = status

    const [contacts, total] = await Promise.all([
      Contact.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Contact.countDocuments(query),
    ])
    return Response.json({ contacts, total, page, limit, pages: Math.ceil(total / limit) })
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

    if (Array.isArray(body)) {
      const docs = body.map((c: Record<string, unknown>) => ({ ...c, userId: auth.id }))
      const contacts = await Contact.insertMany(docs, { ordered: false }).catch(() => [])
      return Response.json({ contacts, imported: contacts.length })
    }

    const { name, phone, email, company, tags, notes } = body
    if (!name || !phone) {
      return Response.json({ error: 'Name and phone are required' }, { status: 400 })
    }
    const contact = await Contact.create({
      userId: auth.id,
      name,
      phone,
      email,
      company,
      tags: tags || [],
      notes,
    })
    return Response.json({ contact }, { status: 201 })
  } catch (e: unknown) {
    if ((e as { code?: number }).code === 11000) {
      return Response.json({ error: 'Contact with this phone already exists' }, { status: 409 })
    }
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
