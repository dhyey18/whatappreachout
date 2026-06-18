import mongoose, { Schema } from 'mongoose'

export interface ILead {
  _id: string
  userId: string
  name: string
  phone: string
  rawPhone: string
  website?: string
  address?: string
  rating?: number
  reviews?: number
  industry: string
  types: string[]
  city: string
  sourceFile: string
  stage: 0 | 1 | 2
  status: 'pending' | 'stage1_sent' | 'stage2_sent' | 'replied' | 'converted' | 'not_whatsapp' | 'failed' | 'skipped'
  lastContactedAt?: Date
  notes?: string
  placeId?: string
  thumbnail?: string
  createdAt: Date
  updatedAt: Date
}

const LeadSchema = new Schema<ILead>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    rawPhone: { type: String },
    website: String,
    address: String,
    rating: Number,
    reviews: Number,
    industry: { type: String, default: 'generic' },
    types: [String],
    city: { type: String, default: 'ahmedabad' },
    sourceFile: { type: String, index: true },
    stage: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'stage1_sent', 'stage2_sent', 'replied', 'converted', 'not_whatsapp', 'failed', 'skipped'],
      default: 'pending',
    },
    lastContactedAt: Date,
    notes: String,
    placeId: String,
    thumbnail: String,
  },
  { timestamps: true }
)

LeadSchema.index({ userId: 1, phone: 1 }, { unique: true })
LeadSchema.index({ userId: 1, city: 1, industry: 1 })
LeadSchema.index({ userId: 1, status: 1 })

export const Lead = mongoose.models.Lead || mongoose.model<ILead>('Lead', LeadSchema)
