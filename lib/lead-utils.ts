import path from 'path'
import fs from 'fs'

export const LEADS_DIR = path.join(process.cwd(), 'leads')

// Default dialing code per city. Extend this as new cities/countries are added.
const CITY_COUNTRY_CODE: Record<string, string> = {
  ahmedabad: '91',
  surat: '91',
  vadodara: '91',
  houston: '1',
  london: '44',
}
const DEFAULT_COUNTRY_CODE = '91'

export function countryCodeForCity(city?: string): string {
  return (city && CITY_COUNTRY_CODE[city.toLowerCase()]) || DEFAULT_COUNTRY_CODE
}

/**
 * Normalise a raw phone number to digits-only with a country code, inferring the
 * country from the lead's city. A bare 10-digit number is assumed to belong to
 * the city's country (e.g. Houston → +1, Indian cities → +91); numbers that
 * already carry a country code are left intact.
 */
export function normalizePhone(raw: string, city?: string): string {
  const num = String(raw).replace(/[\s\-+().]/g, '')
  const cc = countryCodeForCity(city)

  if (cc === '1') {
    // US / Canada
    if (num.length === 10) return '1' + num
    if (num.length === 11 && num.startsWith('1')) return num
    return num
  }

  if (cc === '44') {
    // UK: numbers carry a trunk '0' nationally that drops when going intl.
    if (num.startsWith('44')) return num            // already international (+44…)
    if (num.startsWith('0')) return '44' + num.slice(1) // strip trunk 0 → +44
    return '44' + num                                // bare national number
  }

  // India (default)
  if (num.length === 10) return '91' + num
  if (num.startsWith('0')) return '91' + num.slice(1)
  return num
}

export function isSocialUrl(url?: string): boolean {
  return !!url && /facebook\.com|fb\.com|fb\.me|instagram\.com/i.test(url)
}

export function detectIndustry(types: string[]): string {
  const t = types.join(' ').toLowerCase()
  if (/dental|dentist/.test(t)) return 'dental'
  if (/nursing.?home|surgical|maternity.?hosp/.test(t)) return 'hospital'
  if (/patholog|diagnostic|radiol|blood.?test/.test(t)) return 'diagnostic'
  if (/clinic|doctor|physician|medical|health|physiotherapy|ayurved/.test(t)) return 'clinic'
  if (/restaurant|cafe|food|dhaba|bakery/.test(t)) return 'restaurant'
  if (/real.?estate|property|builder|developer|apartment/.test(t)) return 'realestate'
  if (/marriage.?hall|banquet|wedding.?venue|party.?hall/.test(t)) return 'wedding_venue'
  if (/gym|fitness|yoga|pilates|sports/.test(t)) return 'fitness'
  if (/school|college|coaching|tutor|education|institute/.test(t)) return 'education'
  if (/interior|architect|renovation|decor/.test(t)) return 'interior'
  if (/cloth|apparel|fashion|boutique|saree|garment/.test(t)) return 'clothing'
  if (/jewel|gold|silver|diamond/.test(t)) return 'jewellery'
  if (/manufact|factory|industri|engineer|fabricat/.test(t)) return 'manufacturing'
  if (/packer|mover|courier|transport|cargo|logistics/.test(t)) return 'logistics'
  if (/print|flex.?print|digital.?print|visiting.?card/.test(t)) return 'printing'
  if (/insurance|mutual.?fund|financial.?advis|loan.?agent/.test(t)) return 'financial'
  if (/immigr|visa/.test(t)) return 'immigration'
  if (/tour|travel.?agenc|holiday/.test(t)) return 'travel'
  if (/photo|studio|videograph|cinemat/.test(t)) return 'photography'
  if (/chartered.?account|ca firm|tax.?consult|audit|gst.?consult/.test(t)) return 'ca'
  if (/advocate|lawyer|law.?firm|legal/.test(t)) return 'legal'
  if (/event|wedding.?plan|decorator|caterer/.test(t)) return 'events'
  if (/beauty|parlour|salon|spa|nail|makeup/.test(t)) return 'beauty'
  if (/mobile.?repair|laptop.?repair|computer.?repair|electronic/.test(t)) return 'electronics'
  if (/auto|car|vehicle|garage|mechanic|bike|motorcycle|tyre/.test(t)) return 'automobile'
  if (/hotel|lodge|guest.?house|hostel|resort|stay/.test(t)) return 'hotel'
  if (/pharmac|chemist|drug.?store|medicine/.test(t)) return 'pharmacy'
  return 'generic'
}

export interface LeadFile {
  path: string
  relativePath: string
  city: string
  industry: string
  filename: string
  total?: number
  withPhone?: number
}

export function discoverLeadFiles(): LeadFile[] {
  const files: LeadFile[] = []

  function scanDir(dir: string, city: string) {
    if (!fs.existsSync(dir)) return
    for (const f of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, f)
      if (fs.statSync(fullPath).isDirectory()) {
        scanDir(fullPath, f.toLowerCase())
      } else if (f.endsWith('_leads.json')) {
        const industry = f.replace('_leads.json', '')
        files.push({
          path: fullPath,
          relativePath: fullPath.replace(process.cwd() + '/', ''),
          city,
          industry,
          filename: f,
        })
      }
    }
  }

  scanDir(LEADS_DIR, 'ahmedabad')
  return files.sort((a, b) => `${a.city}${a.industry}`.localeCompare(`${b.city}${b.industry}`))
}

export interface RawLead {
  title?: string
  name?: string
  phone?: string
  website?: string
  address?: string
  rating?: number
  reviews?: number
  type?: string
  types?: string[]
  type_id?: string
  type_ids?: string[]
  place_id?: string
  thumbnail?: string
  serpapi_thumbnail?: string
}

export function parseLeadFile(filePath: string): RawLead[] {
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw) as RawLead[]
}
