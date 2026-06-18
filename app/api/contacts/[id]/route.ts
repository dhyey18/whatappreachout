import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { Contact } from '@/lib/models/Contact'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    await connectDB()
    const contact = await Contact.findOne({ _id: id, userId: auth.id })
    if (!contact) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ contact })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    await connectDB()
    const body = await req.json()
    const contact = await Contact.findOneAndUpdate({ _id: id, userId: auth.id }, body, { new: true })
    if (!contact) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ contact })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    await connectDB()
    await Contact.findOneAndDelete({ _id: id, userId: auth.id })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
