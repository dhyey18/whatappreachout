import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead } from '@/lib/models/Lead'

export const dynamic = 'force-dynamic'

const SOCIAL_REGEX = /facebook|instagram|twitter|linkedin|youtube/i

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    await connectDB()

    const { searchParams } = new URL(req.url)
    const city = searchParams.get('city') || ''
    const industry = searchParams.get('industry') || ''
    const status = searchParams.get('status') || ''
    const stage = searchParams.get('stage') || ''
    const search = searchParams.get('search') || ''
    const websiteType = searchParams.get('websiteType') || '' // has_website | no_website | social_only
    const minRating = parseFloat(searchParams.get('minRating') || '0')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '25')

    const query: Record<string, unknown> = { userId: auth.id }
    if (city) query.city = city
    if (industry) query.industry = industry
    if (status) query.status = status
    if (stage !== '') query.stage = parseInt(stage)
    if (minRating > 0) query.rating = { $gte: minRating }

    if (websiteType === 'has_website') {
      query.website = { $exists: true, $ne: null, $not: SOCIAL_REGEX }
    } else if (websiteType === 'no_website') {
      query.$or = [{ website: null }, { website: { $exists: false } }, { website: '' }]
    } else if (websiteType === 'social_only') {
      query.website = SOCIAL_REGEX
    }

    if (search) {
      const searchOr = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ]
      if (query.$or) {
        // Merge with existing $or using $and
        query.$and = [{ $or: query.$or }, { $or: searchOr }]
        delete query.$or
      } else {
        query.$or = searchOr
      }
    }

    const [leads, total] = await Promise.all([
      Lead.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Lead.countDocuments(query),
    ])

    // Aggregated status counts for the current user (ignoring page filters)
    const stats = await Lead.aggregate([
      { $match: { userId: auth.id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    const statusCounts = Object.fromEntries(stats.map((s: { _id: string; count: number }) => [s._id, s.count]))

    return Response.json({ leads, total, page, limit, pages: Math.ceil(total / limit), statusCounts })
  } catch (e: unknown) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
