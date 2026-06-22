import connectDB from './mongodb'
import { Settings } from './models/Settings'
import {
  DEFAULT_TEMPLATE_CONFIG,
  VARIANTS,
  type TemplateConfig,
  type TemplateOverrides,
  type VariantKey,
} from './message-templates'

const VALID_VARIANTS = new Set<string>(VARIANTS.map((v) => v.key))
const MAX_TEMPLATE_LEN = 2000
const MAX_FIELD_LEN = 120

/** Load a user's sender config + template overrides, falling back to defaults. */
export async function getUserSettings(
  userId: string
): Promise<{ config: TemplateConfig; templates: TemplateOverrides }> {
  await connectDB()
  const doc = await Settings.findOne({ userId }).lean<{
    senderName?: string
    senderPhone?: string
    websitePrice?: string
    templates?: TemplateOverrides
  }>()
  if (!doc) return { config: { ...DEFAULT_TEMPLATE_CONFIG }, templates: {} }
  return {
    config: {
      senderName: doc.senderName ?? DEFAULT_TEMPLATE_CONFIG.senderName,
      senderPhone: doc.senderPhone ?? DEFAULT_TEMPLATE_CONFIG.senderPhone,
      websitePrice: doc.websitePrice ?? DEFAULT_TEMPLATE_CONFIG.websitePrice,
    },
    templates: (doc.templates as TemplateOverrides) ?? {},
  }
}

/** Trim + length-cap a free-text sender field. */
export function sanitizeField(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, MAX_FIELD_LEN)
}

/**
 * Sanitize an incoming template-overrides object: keep only known variant keys,
 * string values, and cap length. Empty strings are dropped (→ use the default).
 */
export function sanitizeTemplates(input: unknown): TemplateOverrides {
  if (!input || typeof input !== 'object') return {}
  const out: TemplateOverrides = {}
  for (const [industry, variants] of Object.entries(input as Record<string, unknown>)) {
    if (!variants || typeof variants !== 'object') continue
    const cleaned: Partial<Record<VariantKey, string>> = {}
    for (const [variant, text] of Object.entries(variants as Record<string, unknown>)) {
      if (!VALID_VARIANTS.has(variant)) continue
      if (typeof text !== 'string') continue
      const trimmed = text.trim()
      if (!trimmed) continue
      cleaned[variant as VariantKey] = trimmed.slice(0, MAX_TEMPLATE_LEN)
    }
    if (Object.keys(cleaned).length) out[industry] = cleaned
  }
  return out
}
