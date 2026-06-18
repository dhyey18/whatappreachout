import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { parseLeadFile, normalizePhone, detectIndustry, isSocialUrl, LEADS_DIR } from '@/lib/lead-utils'
import connectDB from '@/lib/mongodb'
import { Lead } from '@/lib/models/Lead'
import path from 'path'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthUser(req)
    if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const { relativePath } = await req.json()
    if (!relativePath) return Response.json({ error: 'relativePath required' }, { status: 400 })

    // Security: only allow paths inside leads dir
    const fullPath = path.join(process.cwd(), relativePath)
    if (!fullPath.startsWith(LEADS_DIR)) {
      return Response.json({ error: 'Invalid path' }, { status: 400 })
    }

    const rawLeads = parseLeadFile(fullPath)
    const pathParts = relativePath.replace('leads/', '').split('/')
    const city = pathParts.length > 1 ? pathParts[0].toLowerCase() : 'ahmedabad'

    await connectDB()

    let imported = 0
    let skipped = 0
    let failed = 0

    for (const raw of rawLeads) {
      if (!raw.phone) { skipped++; continue }

      const allTypes = [
        raw.type || '',
        ...(raw.types || []),
        ...(raw.type_ids || []),
      ]
      const industry = detectIndustry(allTypes)
      const phone = normalizePhone(raw.phone)
      const social = isSocialUrl(raw.website)

      try {
        await Lead.updateOne(
          { userId: auth.id, phone },
          {
            $setOnInsert: {
              userId: auth.id,
              name: raw.title || raw.name || 'Unknown',
              phone,
              rawPhone: raw.phone,
              website: social ? undefined : raw.website,
              address: raw.address,
              rating: raw.rating,
              reviews: raw.reviews,
              industry,
              types: allTypes.filter(Boolean),
              city,
              sourceFile: relativePath,
              stage: 0,
              status: 'pending',
              placeId: raw.place_id,
              thumbnail: raw.thumbnail || raw.serpapi_thumbnail,
            },
          },
          { upsert: true }
        )
        imported++
      } catch {
        failed++
      }
    }

    return Response.json({ imported, skipped, failed, total: rawLeads.length })
  } catch (e: unknown) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
