import type { RawBusiness, LeadRow } from '../types.js'

function titleCase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function isAllOneCase(input: string): boolean {
  const trimmed = input.trim()
  return trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase()
}

export function normalizeLead(raw: RawBusiness, country: string, state: string): LeadRow {
  const businessName = isAllOneCase(raw.name) ? titleCase(raw.name) : raw.name.trim()

  return {
    businessName,
    country,
    state,
    city: raw.city ?? 'not found',
    phone: raw.phone ?? 'not found',
    email: raw.email ?? 'not found',
    socialLink: raw.facebook ?? raw.instagram ?? 'not found',
    websiteStatus: 'none',
    dateFound: new Date().toISOString().slice(0, 10),
  }
}
