import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User } from '@/lib/models/User'
import { hashPassword, signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const { name, email, password } = await req.json()
    if (!name || !email || !password) {
      return Response.json({ error: 'All fields are required' }, { status: 400 })
    }
    const existing = await User.findOne({ email })
    if (existing) {
      return Response.json({ error: 'Email already registered' }, { status: 409 })
    }
    const hashed = await hashPassword(password)
    const user = await User.create({ name, email, password: hashed })
    const token = signToken({ id: String(user._id), email: user.email })
    return Response.json({
      token,
      user: { id: String(user._id), name: user.name, email: user.email },
    })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
