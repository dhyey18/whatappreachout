import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { Campaign } from '@/lib/models/Campaign'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    await connectDB()
    const campaign = await Campaign.findOne({ _id: id, userId: auth.id })
    if (!campaign) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ campaign })
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
    const campaign = await Campaign.findOneAndUpdate({ _id: id, userId: auth.id }, body, { new: true })
    if (!campaign) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ campaign })
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
    await Campaign.findOneAndDelete({ _id: id, userId: auth.id })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
