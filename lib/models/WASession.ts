import mongoose, { Schema, Model } from 'mongoose'

export interface IWASession {
  userId: string
  /** JSON-serialised Record<filename, fileContent> for the entire auth directory */
  authData: string | null
  status: 'disconnected' | 'connecting' | 'connected'
  phoneNumber: string | null
  /** Base64 data-URL of the latest QR code — shared across all Vercel instances */
  qrDataURL: string | null
  isAutoReconnecting: boolean
}

const schema = new Schema<IWASession>(
  {
    userId:            { type: String, required: true, unique: true, index: true },
    authData:          { type: String, default: null },
    status:            { type: String, default: 'disconnected' },
    phoneNumber:       { type: String, default: null },
    qrDataURL:         { type: String, default: null },
    isAutoReconnecting:{ type: Boolean, default: false },
  },
  { timestamps: true },
)

export const WASession: Model<IWASession> =
  mongoose.models.WASession ||
  mongoose.model<IWASession>('WASession', schema)
