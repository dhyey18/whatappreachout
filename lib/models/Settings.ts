import mongoose, { Schema } from 'mongoose'
import type { TemplateOverrides } from '@/lib/message-templates'

export interface ISettings {
  userId: string
  senderName: string
  senderPhone: string
  websitePrice: string
  /** Per-industry message overrides — only edited variants are stored. */
  templates: TemplateOverrides
  createdAt: Date
  updatedAt: Date
}

const SettingsSchema = new Schema<ISettings>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    senderName: { type: String, default: 'Dhyey' },
    senderPhone: { type: String, default: '+91 94291 84788' },
    websitePrice: { type: String, default: '₹8,000' },
    // Free-form { industry: { variant: text } } map.
    templates: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
)

export const Settings =
  mongoose.models.Settings || mongoose.model<ISettings>('Settings', SettingsSchema)
