import mongoose, { Schema } from 'mongoose'

export interface IContact {
  _id: string
  userId: string
  name: string
  phone: string
  email?: string
  company?: string
  tags: string[]
  status: 'active' | 'inactive' | 'blocked'
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const ContactSchema = new Schema<IContact>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: String,
    company: String,
    tags: [String],
    status: { type: String, enum: ['active', 'inactive', 'blocked'], default: 'active' },
    notes: String,
  },
  { timestamps: true }
)

ContactSchema.index({ userId: 1, phone: 1 }, { unique: true })

export const Contact = mongoose.models.Contact || mongoose.model<IContact>('Contact', ContactSchema)
