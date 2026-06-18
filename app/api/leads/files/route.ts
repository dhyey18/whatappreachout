import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { discoverLeadFiles, parseLeadFile } from '@/lib/lead-utils'
import connectDB from '@/lib/mongodb'
import { Lead } from '@/lib/models/Lead'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const files = discoverLeadFiles()

  const enriched = await Promise.all(
    files.map(async (f) => {
      let rawData: { phone?: string }[] = []
      try { rawData = parseLeadFile(f.path) } catch { rawData = [] }
      const withPhone = rawData.filter((l) => l.phone).length
      const imported = await Lead.countDocuments({ userId: auth.id, sourceFile: f.relativePath })
      return { ...f, total: rawData.length, withPhone, imported }
    })
  )

  return Response.json({ files: enriched })
}
