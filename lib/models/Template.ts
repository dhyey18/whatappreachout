import mongoose, { Schema } from 'mongoose'

export interface ITemplate {
  _id: string
  userId: string
  name: string
  content: string
  variables: string[]
  category: string
  createdAt: Date
  updatedAt: Date
}

const TemplateSchema = new Schema<ITemplate>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
    variables: [String],
    category: { type: String, default: 'general' },
  },
  { timestamps: true }
)

export const Template = mongoose.models.Template || mongoose.model<ITemplate>('Template', TemplateSchema)
