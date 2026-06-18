import mongoose, { Schema } from 'mongoose'

export interface ICampaign {
  _id: string
  userId: string
  name: string
  templateId?: string
  message: string
  contacts: string[]
  status: 'draft' | 'scheduled' | 'running' | 'completed' | 'failed' | 'paused'
  scheduledAt?: Date
  startedAt?: Date
  completedAt?: Date
  stats: {
    total: number
    sent: number
    delivered: number
    failed: number
    replied: number
  }
  createdAt: Date
  updatedAt: Date
}

const CampaignSchema = new Schema<ICampaign>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    templateId: String,
    message: { type: String, required: true },
    contacts: [String],
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'running', 'completed', 'failed', 'paused'],
      default: 'draft',
    },
    scheduledAt: Date,
    startedAt: Date,
    completedAt: Date,
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      replied: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
)

export const Campaign = mongoose.models.Campaign || mongoose.model<ICampaign>('Campaign', CampaignSchema)
