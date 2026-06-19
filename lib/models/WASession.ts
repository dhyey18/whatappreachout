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
  /**
   * Phone pairing code (XXXX-XXXX). Set asynchronously by the background pairing
   * flow so Vercel Hobby's 10 s function limit doesn't block the pair route.
   */
  pairingCode: string | null
  /**
   * Distributed connect lock: set when an instance starts connecting, cleared
   * on connect/disconnect. Prevents multiple Vercel instances from opening
   * simultaneous WA sessions for the same user.
   */
  connectingAt: Date | null
  connectingInstanceId: string | null
}

const schema = new Schema<IWASession>(
  {
    userId:              { type: String, required: true, unique: true, index: true },
    authData:            { type: String, default: null },
    status:              { type: String, default: 'disconnected' },
    phoneNumber:         { type: String, default: null },
    qrDataURL:           { type: String, default: null },
    isAutoReconnecting:  { type: Boolean, default: false },
    pairingCode:         { type: String, default: null },
    connectingAt:        { type: Date, default: null },
    connectingInstanceId:{ type: String, default: null },
  },
  { timestamps: true },
)

export const WASession: Model<IWASession> =
  mongoose.models.WASession ||
  mongoose.model<IWASession>('WASession', schema)
