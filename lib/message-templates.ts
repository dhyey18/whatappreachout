export interface TemplateConfig {
  senderName: string
  senderPhone: string
  websitePrice: string
}

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  senderName: 'Dhyey',
  senderPhone: '+91 94291 84788',
  websitePrice: '₹8,000',
}

type MsgFn = (name: string, hasWebsite: boolean, socialOnly: boolean, city: string, cfg: TemplateConfig) => string
type Stage2Fn = (name: string, cfg: TemplateConfig) => string

const stage1: Record<string, MsgFn> = {
  dental: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nLooked at *${name}*'s website — it's up but honestly doesn't seem like it's pulling patients from Google.\n\nSmall changes usually make a big difference for local clinics. Happy to take a proper look if you want.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only an Instagram page came up.\n\nMost patients use Google when they're looking for a dentist, not social media. A proper website gets you into those results. I build them for ${cfg.websitePrice}, usually up in a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nWas looking up dental clinics in ${city} and noticed *${name}* doesn't show up on Google at all.\n\nPatients searching online right now are just going to whoever comes up first. I build websites for dental clinics — ${cfg.websitePrice} one-time, ready in about a week.\n\nWorth a chat?\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  clinic: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nChecked *${name}*'s website — it's there, but doesn't seem to be showing up in local Google searches the way it should.\n\nA few tweaks usually sort this out. Happy to take a look if you're interested.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* — only a social media page showed up on Google.\n\nPatients searching for a clinic on Google need an actual website to find and contact you directly. I build them for ${cfg.websitePrice}, live in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nLooked up *${name}* in ${city} — no website came up.\n\nPeople searching for a doctor online in ${city} are just calling whoever shows up on Google first. I build clinic websites — ${cfg.websitePrice}, done in about a week.\n\nInterested?\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  restaurant: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nHad a look at *${name}*'s website — it's live but I don't think it's doing much for online orders or walk-ins from search.\n\nA few changes can really help with this. Let me know if you want me to take a closer look.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* — only Facebook came up, no website.\n\nPeople searching for a restaurant in ${city} online usually want to see a menu or place an order. Hard to do that on a Facebook page. I build restaurant websites for ${cfg.websitePrice}, ready in a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nLooked up *${name}* in ${city} — no website, just a Google Maps listing.\n\nPeople searching for somewhere to eat right now can't really find you online. I build restaurant websites — ${cfg.websitePrice}, up in about a week.\n\nWorth it?\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  realestate: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nChecked *${name}*'s website — it's there, but I don't think it's generating buyer inquiries on its own.\n\nFixing a few things usually starts bringing in leads without having to share commission with anyone. Happy to look into it.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — just a social media page came up.\n\nBuyers searching for a property agent in ${city} on Google won't find you there. A proper website puts you in front of them directly — no OTA cut. I build them for ${cfg.websitePrice}, live in a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nWas looking up property agents in ${city} and *${name}* doesn't come up on Google.\n\nBuyers searching online are going to whoever shows up first. A website gets you there — and every inquiry comes straight to you, no commission to anyone. I build them for ${cfg.websitePrice}, ready in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  fitness: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nLooked at *${name}*'s website — it's live but I don't think it's pulling in new members from Google search.\n\nUsually a few changes make a real difference for gyms and studios. Happy to take a look if you want.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only Instagram came up.\n\nPeople searching for a gym in ${city} use Google, not just Instagram. A proper website gets you in those results. I build them for ${cfg.websitePrice}, up in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nLooked up gyms and fitness studios in ${city} — *${name}* doesn't show up on Google.\n\nPeople searching for a place to work out are signing up wherever comes up first. I build websites for gyms and studios — ${cfg.websitePrice}, done in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  education: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nHad a look at *${name}*'s website — it's up, but I don't think parents searching on Google are finding it easily.\n\nA few things usually fix this for coaching institutes. Happy to check properly if you're interested.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only a social media page came up.\n\nParents looking for coaching classes in ${city} search on Google, not Instagram. A website gets you on that list. I build them for ${cfg.websitePrice}, live in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nWas searching for coaching institutes in ${city} — *${name}* doesn't show up on Google.\n\nParents looking for classes are enrolling wherever comes up first. I build websites for coaching institutes — ${cfg.websitePrice}, ready in about a week.\n\nInterested?\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  interior: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nChecked *${name}*'s website — the portfolio looks good, but it's not showing up well when people search for interior designers in ${city} on Google.\n\nHappy to look at what's holding it back if you want.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — just Instagram came up, no website.\n\nClients searching for an interior designer in ${city} on Google won't find your work there. A proper website puts your portfolio in front of them. I build them for ${cfg.websitePrice}, live in a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nWas looking up interior designers in ${city} — *${name}* doesn't come up on Google.\n\nClients searching online are reaching out to whoever shows up. A website puts your work in front of them directly. I build them for ${cfg.websitePrice}, ready in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  clothing: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nLooked at *${name}*'s website — it's there, but I don't think it's driving many sales from Google search.\n\nA few changes usually help a lot with this for clothing stores. Let me know if you want me to check.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only a social media page came up.\n\nPeople searching for clothing stores in ${city} online can't browse or order from a Facebook page easily. A proper website fixes that. I build them for ${cfg.websitePrice}, up in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nLooked up clothing stores in ${city} — *${name}* doesn't come up on Google.\n\nPeople searching to buy clothes online in ${city} right now are going to whoever shows up. I build clothing store websites — ${cfg.websitePrice}, done in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  jewellery: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nHad a look at *${name}*'s website — it's up, but I don't think buyers searching on Google are finding it.\n\nHappy to check what's going on and see if it's an easy fix.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* — only Facebook came up on Google.\n\nPeople searching for jewellery in ${city} online want to see the collection before visiting. A website makes that easy. I build them for ${cfg.websitePrice}, ready in a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nWas looking up jewellery shops in ${city} — *${name}* doesn't come up on Google at all.\n\nBuyers searching online are walking into whoever they find first. A website puts your shop on that list. I build them for ${cfg.websitePrice}, ready in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  manufacturing: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nLooked at *${name}*'s website — it's live but not really showing up when buyers search on Google.\n\nFor B2B this can mean missing a lot of inbound orders. Happy to look at it if you want.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only a social media page came up.\n\nB2B buyers searching for manufacturers in ${city} won't find you there. A proper website gets you in front of them. I build them for ${cfg.websitePrice}, live in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nLooked up *${name}* in ${city} — no website came up on Google.\n\nBuyers searching for manufacturers online are going to whoever shows up. A website gets you in front of them — I build them for ${cfg.websitePrice}, done in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  immigration: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nChecked *${name}*'s website — it's there, but I don't think it's pulling in client inquiries from Google search.\n\nA few things usually fix this for immigration consultancies. Happy to take a look.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only a social media page came up.\n\nPeople searching for an immigration consultant in ${city} use Google, not social media. A website gets you in front of them. I build them for ${cfg.websitePrice}, live in a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nWas looking up immigration consultants in ${city} — *${name}* doesn't show up on Google.\n\nPeople searching for visa help are contacting whoever comes up first. I build websites for consultancies — ${cfg.websitePrice}, ready in about a week.\n\nInterested?\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  photography: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nHad a look at *${name}*'s website — the work looks great, but Google isn't really surfacing it for people searching locally.\n\nHappy to look at what's going on if you want.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only Instagram came up.\n\nClients searching for a photographer in ${city} on Google can't find your portfolio there. A proper website puts it in front of them. I build them for ${cfg.websitePrice}, up in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nWas looking up photographers in ${city} — *${name}* doesn't come up on Google.\n\nClients searching for photography right now are booking whoever they find first. I build websites for photographers — ${cfg.websitePrice}, done in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  ca: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nLooked at *${name}*'s website — it's up, but doesn't seem to be showing in local Google results for CA and tax services.\n\nUsually a straightforward fix. Happy to check if you're interested.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only a social media page came up.\n\nBusinesses searching for a CA in ${city} on Google won't find you there. A proper website gets you in front of them. I build them for ${cfg.websitePrice}, ready in a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nWas looking up CA firms in ${city} — *${name}* doesn't come up on Google.\n\nBusinesses looking for tax and accounting help are going to whoever they find first. A website gets you on that list. I build them for ${cfg.websitePrice}, done in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  events: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nChecked *${name}*'s website — it's live, but I don't think clients searching for event planners in ${city} are finding it.\n\nA few things usually help with this. Happy to take a look.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only Facebook came up.\n\nClients planning an event in ${city} search on Google first. A proper website shows them your work and gets you the inquiry. I build them for ${cfg.websitePrice}, up in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nWas looking up event planners in ${city} — *${name}* doesn't show up on Google.\n\nClients planning events are reaching out to whoever they find first. A website puts you in front of them. I build them for ${cfg.websitePrice}, ready in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  automobile: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nLooked at *${name}*'s website — it's there, but I don't think it's bringing in bookings from Google search.\n\nA few changes usually make a real difference for service centres. Happy to check if you want.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only a social media page came up.\n\nPeople searching for a car service centre in ${city} on Google won't find you there. A website puts you on that list. I build them for ${cfg.websitePrice}, live in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nWas looking up car service centres in ${city} — *${name}* doesn't come up on Google.\n\nPeople searching for a mechanic or service centre online are going to whoever shows up. I build websites for auto businesses — ${cfg.websitePrice}, done in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  hotel: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nHad a look at *${name}*'s website — it's live, but guests are probably still finding you through OTAs and you're paying commission every time.\n\nA proper direct booking setup on your own site fixes that. Happy to look into it.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only a Facebook page came up.\n\nGuests looking for a hotel in ${city} can't book directly with you — they go to MakeMyTrip or OYO instead and you lose a cut on every booking. A proper website sorts that out. I build them for ${cfg.websitePrice}, up in a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nLooked up hotels in ${city} — *${name}* doesn't come up on Google directly.\n\nGuests searching online end up booking through OTAs and you pay commission on every stay. A website lets them book directly with you. I build them for ${cfg.websitePrice}, ready in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  pharmacy: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nChecked *${name}*'s website — it's there, but I don't think it's pulling orders from Google.\n\nA few changes usually help a lot with this. Happy to take a proper look.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only a social media page came up.\n\nPeople ordering medicines online in ${city} use apps like PharmEasy and you pay commission every time. A proper website lets them order directly from you. I build them for ${cfg.websitePrice}, up in a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nLooked up *${name}* in ${city} — no website came up.\n\nPeople ordering medicines online go to PharmEasy or 1mg by default — and you pay commission on every order. A website lets them order straight from you. I build them for ${cfg.websitePrice}, ready in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
  generic: (name, hasWebsite, socialOnly, city, cfg) => {
    if (hasWebsite) return `Hi —\n\nLooked at *${name}*'s website — it's up, but I don't think it's bringing in inquiries from Google.\n\nUsually a few straightforward changes help a lot. Happy to take a look if you want.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    if (socialOnly) return `Hi —\n\nSearched for *${name}* on Google — only social media came up.\n\nCustomers searching on Google can't find you there. A proper website puts you in front of them. I build them for ${cfg.websitePrice}, live in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
    return `Hi —\n\nLooked up *${name}* in ${city} — no website came up on Google.\n\nCustomers searching online right now are going to whoever shows up. I build local business websites — ${cfg.websitePrice}, done in about a week.\n\n${cfg.senderName}\n${cfg.senderPhone}`
  },
}

const stage2: Record<string, Stage2Fn> = {
  dental: (name, cfg) => `Hi *${name}* —\n\nQuick question, genuinely curious — are most of your new patients coming through referrals, or are some finding you through Google?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  clinic: (name, cfg) => `Hi *${name}* —\n\nOut of curiosity — right now, how are most new patients finding your clinic? Referrals, walk-ins, or online?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  restaurant: (name, cfg) => `Hi *${name}* —\n\nQuick question — are you currently getting online orders or mostly walk-in customers?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  realestate: (name, cfg) => `Hi *${name}* —\n\nGenuine question — are most of your buyer inquiries coming through referrals, or also from Google and social media?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  fitness: (name, cfg) => `Hi *${name}* —\n\nQuick question — are new members mostly finding you through word of mouth, or also through Google and Instagram?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  education: (name, cfg) => `Hi *${name}* —\n\nGenuine question — are most student inquiries coming through referrals, or are some parents finding you on Google?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  interior: (name, cfg) => `Hi *${name}* —\n\nQuick question — are most of your project leads coming through referrals, or are clients also finding you online?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  clothing: (name, cfg) => `Hi *${name}* —\n\nQuick question — are most of your customers walk-ins, or are some ordering through WhatsApp or Instagram?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  jewellery: (name, cfg) => `Hi *${name}* —\n\nGenuine question — are most customers coming to your shop directly, or are some also reaching out through WhatsApp or Instagram?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  manufacturing: (name, cfg) => `Hi *${name}* —\n\nQuick question — are most of your B2B inquiries coming through existing contacts and referrals, or also from online?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  immigration: (name, cfg) => `Hi *${name}* —\n\nGenuine question — are most of your clients coming through referrals, or are some finding you through Google?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  photography: (name, cfg) => `Hi *${name}* —\n\nQuick question — are most of your bookings coming through referrals, or are some clients also finding you through Google or Instagram?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  ca: (name, cfg) => `Hi *${name}* —\n\nGenuine question — are most of your new clients coming through referrals, or are some finding you through Google?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  events: (name, cfg) => `Hi *${name}* —\n\nQuick question — are most event enquiries coming through referrals, or are some clients also finding you online?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  automobile: (name, cfg) => `Hi *${name}* —\n\nQuick question — are most customers coming through word of mouth, or are some also finding you through Google?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  hotel: (name, cfg) => `Hi *${name}* —\n\nGenuine question — are most of your bookings coming through OTAs like MakeMyTrip, or do you also get direct bookings?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  pharmacy: (name, cfg) => `Hi *${name}* —\n\nQuick question — are most of your customers walk-ins, or are some also ordering through WhatsApp?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
  generic: (name, cfg) => `Hi *${name}* —\n\nQuick question — are most of your customers coming through referrals and word of mouth, or also through Google?\n\n— ${cfg.senderName} (${cfg.senderPhone})`,
}

// ─── Editable template system ────────────────────────────────────────────────
//
// The copy above is the source of the *defaults*. To make it editable we expose
// each message as a plain string with {placeholders}, derived from the functions
// above by rendering them with sentinel values (so we never have to transcribe
// the copy twice and the defaults can never drift from what actually sends).

/** Placeholders users can drop into any template. */
export const PLACEHOLDERS = ['name', 'city', 'senderName', 'senderPhone', 'websitePrice'] as const
export type Placeholder = (typeof PLACEHOLDERS)[number]

/** The four message variants every industry has. */
export type VariantKey = 's1None' | 's1Website' | 's1Social' | 's2'

export const VARIANTS: { key: VariantKey; label: string; hint: string }[] = [
  { key: 's1None', label: 'Stage 1 · No website', hint: 'First message to a lead with no website at all' },
  { key: 's1Website', label: 'Stage 1 · Has website', hint: 'First message to a lead that already has a website' },
  { key: 's1Social', label: 'Stage 1 · Social only', hint: 'First message to a lead found only on social media' },
  { key: 's2', label: 'Stage 2 · Follow-up', hint: 'Follow-up message for a contacted lead' },
]

export type TemplateSet = Record<VariantKey, string>
/** Per-industry partial overrides, e.g. { dental: { s1None: "..." } }. */
export type TemplateOverrides = Record<string, Partial<TemplateSet>>

/** Industries that have bespoke default copy (everything else uses `generic`). */
export const TEMPLATE_INDUSTRIES = Object.keys(stage1).sort()

const SENTINEL_CFG: TemplateConfig = {
  senderName: '{senderName}',
  senderPhone: '{senderPhone}',
  websitePrice: '{websitePrice}',
}

/**
 * Build the default {placeholder} strings for an industry by invoking the
 * existing copy functions with sentinel values. The functions only ever
 * interpolate their arguments, so the result is the template verbatim.
 */
export function getDefaultTemplateSet(industry: string): TemplateSet {
  const s1 = stage1[industry] || stage1.generic
  const s2fn = stage2[industry] || stage2.generic
  return {
    s1Website: s1('{name}', true, false, '{city}', SENTINEL_CFG),
    s1Social: s1('{name}', false, true, '{city}', SENTINEL_CFG),
    s1None: s1('{name}', false, false, '{city}', SENTINEL_CFG),
    s2: s2fn('{name}', SENTINEL_CFG),
  }
}

const PLACEHOLDER_RE = /\{(name|city|senderName|senderPhone|websitePrice)\}/g

/** Substitute {placeholders} in a template with concrete values. */
export function renderTemplate(template: string, vars: Record<Placeholder, string>): string {
  return template.replace(PLACEHOLDER_RE, (_, key: Placeholder) => vars[key] ?? '')
}

function variantFor(hasWebsite: boolean, socialOnly: boolean, stageNum: 1 | 2): VariantKey {
  if (stageNum === 2) return 's2'
  if (hasWebsite) return 's1Website'
  if (socialOnly) return 's1Social'
  return 's1None'
}

export function buildOutreachMessage(
  name: string,
  industry: string,
  hasWebsite: boolean,
  socialOnly: boolean,
  city: string,
  stageNum: 1 | 2,
  config?: Partial<TemplateConfig>,
  templates?: TemplateOverrides
): string {
  const cfg: TemplateConfig = { ...DEFAULT_TEMPLATE_CONFIG, ...config }
  const cityLabel = city.charAt(0).toUpperCase() + city.slice(1)
  const variant = variantFor(hasWebsite, socialOnly, stageNum)

  // A non-empty user override wins; otherwise fall back to the default copy.
  const override = templates?.[industry]?.[variant]
  const template = override && override.trim()
    ? override
    : getDefaultTemplateSet(industry)[variant]

  return renderTemplate(template, {
    name,
    city: cityLabel,
    senderName: cfg.senderName,
    senderPhone: cfg.senderPhone,
    websitePrice: cfg.websitePrice,
  })
}
