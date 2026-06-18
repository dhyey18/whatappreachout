import { NextRequest } from 'next/server'
import connectDB from '@/lib/mongodb'
import { Campaign } from '@/lib/models/Campaign'
import { Contact } from '@/lib/models/Contact'
import { Message } from '@/lib/models/Message'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    await connectDB()

    const [totalContacts, totalCampaigns, campaigns, messages] = await Promise.all([
      Contact.countDocuments({ userId: auth.id }),
      Campaign.countDocuments({ userId: auth.id }),
      Campaign.find({ userId: auth.id }).sort({ createdAt: -1 }).limit(20),
      Message.find({ userId: auth.id }).sort({ createdAt: -1 }).limit(50),
    ])

    const totalSent = campaigns.reduce((s, c) => s + c.stats.sent, 0)
    const totalDelivered = campaigns.reduce((s, c) => s + c.stats.delivered, 0)
    const totalReplied = campaigns.reduce((s, c) => s + c.stats.replied, 0)
    const totalFailed = campaigns.reduce((s, c) => s + c.stats.failed, 0)

    const now = new Date()
    const monthlyData = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      const month = d.toLocaleString('default', { month: 'short' })
      const monthCampaigns = campaigns.filter((c) => {
        const cd = new Date(c.createdAt)
        return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear()
      })
      return {
        month,
        sent: monthCampaigns.reduce((s, c) => s + c.stats.sent, 0),
        delivered: monthCampaigns.reduce((s, c) => s + c.stats.delivered, 0),
        replied: monthCampaigns.reduce((s, c) => s + c.stats.replied, 0),
      }
    })

    return Response.json({
      overview: { totalContacts, totalCampaigns, totalSent, totalDelivered, totalReplied, totalFailed },
      monthlyData,
      recentCampaigns: campaigns.slice(0, 5),
      recentMessages: messages.slice(0, 20),
    })
  } catch {
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
