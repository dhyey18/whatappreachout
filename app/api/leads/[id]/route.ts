import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead } from '@/lib/models/Lead'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    await connectDB()
    const body = await req.json()
    const lead = await Lead.findOneAndUpdate({ _id: id, userId: auth.id }, body, { new: true })
    if (!lead) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ lead })
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
    await Lead.findOneAndDelete({ _id: id, userId: auth.id })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
