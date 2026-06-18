import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { Template } from '@/lib/models/Template'
import { getAuthUser } from '@/lib/auth'
import { parseTemplateVariables } from '@/lib/utils'

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    await connectDB()
    const templates = await Template.find({ userId: auth.id }).sort({ createdAt: -1 })
    return Response.json({ templates })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    await connectDB()
    const { name, content, category } = await req.json()
    if (!name || !content) {
      return Response.json({ error: 'Name and content are required' }, { status: 400 })
    }
    const variables = parseTemplateVariables(content)
    const template = await Template.create({
      userId: auth.id,
      name,
      content,
      variables,
      category: category || 'general',
    })
    return Response.json({ template }, { status: 201 })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
