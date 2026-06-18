import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { Template } from '@/lib/models/Template'
import { getAuthUser } from '@/lib/auth'
import { parseTemplateVariables } from '@/lib/utils'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    await connectDB()
    const body = await req.json()
    if (body.content) {
      body.variables = parseTemplateVariables(body.content)
    }
    const template = await Template.findOneAndUpdate({ _id: id, userId: auth.id }, body, { new: true })
    if (!template) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ template })
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
    await Template.findOneAndDelete({ _id: id, userId: auth.id })
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
