import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User } from '@/lib/models/User'
import { comparePassword, signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const { email, password } = await req.json()
    if (!email || !password) {
      return Response.json({ error: 'All fields are required' }, { status: 400 })
    }
    const user = await User.findOne({ email })
    if (!user) {
      return Response.json({ error: 'Invalid credentials' }, { status: 401 })
    }
    const valid = await comparePassword(password, user.password)
    if (!valid) {
      return Response.json({ error: 'Invalid credentials' }, { status: 401 })
    }
    const token = signToken({ id: String(user._id), email: user.email })
    return Response.json({
      token,
      user: { id: String(user._id), name: user.name, email: user.email, phone: user.phone },
    })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
