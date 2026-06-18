import mongoose, { Schema } from 'mongoose'

export interface IUser {
  _id: string
  name: string
  email: string
  password: string
  avatar?: string
  phone?: string
  createdAt: Date
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    avatar: String,
    phone: String,
  },
  { timestamps: true }
)

export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema)
