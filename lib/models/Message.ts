import mongoose, { Schema } from 'mongoose'

export interface IMessage {
  _id: string
  userId: string
  campaignId?: string
  contactId: string
  phone: string
  content: string
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed'
  direction: 'outbound' | 'inbound'
  sentAt?: Date
  deliveredAt?: Date
  readAt?: Date
  errorMessage?: string
  createdAt: Date
}

const MessageSchema = new Schema<IMessage>(
  {
    userId: { type: String, required: true, index: true },
    campaignId: { type: String, index: true },
    contactId: { type: String, required: true, index: true },
    phone: { type: String, required: true },
    content: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'read', 'failed'],
      default: 'queued',
    },
    direction: { type: String, enum: ['outbound', 'inbound'], default: 'outbound' },
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    errorMessage: String,
  },
  { timestamps: true }
)

export const Message = mongoose.models.Message || mongoose.model<IMessage>('Message', MessageSchema)
