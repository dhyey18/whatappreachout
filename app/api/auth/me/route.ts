import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User } from '@/lib/models/User'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    await connectDB()
    const user = await User.findById(auth.id).select('-password')
    if (!user) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({
      user: { id: String(user._id), name: user.name, email: user.email, phone: user.phone, avatar: user.avatar },
    })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    await connectDB()
    const { name, phone, avatar } = await req.json()
    const user = await User.findByIdAndUpdate(auth.id, { name, phone, avatar }, { new: true }).select('-password')
    if (!user) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({
      user: { id: String(user._id), name: user.name, email: user.email, phone: user.phone, avatar: user.avatar },
    })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
