import { getTagsForBusinessType } from './businessTypes.js'
import type { RawBusiness } from '../types.js'

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'

function buildQuery(tags: string[], stateName: string): string {
  const tagClauses = tags
    .map((tag) => {
      const [key, value] = tag.split('=')
      return `node["${key}"="${value}"](area.searchArea);`
    })
    .join('\n  ')

  return `
[out:json][timeout:60];
area["name"="${stateName}"]->.searchArea;
(
  ${tagClauses}
);
out tags;
`.trim()
}

export async function searchBusinesses(businessType: string, stateName: string): Promise<RawBusiness[]> {
  const tags = getTagsForBusinessType(businessType)
  const query = buildQuery(tags, stateName)

  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  if (!response.ok) {
    throw new Error(`Overpass request failed with status ${response.status}`)
  }

  const data = (await response.json()) as { elements: Array<{ tags?: Record<string, string> }> }

  return data.elements
    .filter((el) => el.tags?.name)
    .map((el) => {
      const tags = el.tags!
      return {
        name: tags.name,
        street: tags['addr:street'] ?? null,
        city: tags['addr:city'] ?? null,
        phone: tags.phone ?? tags['contact:phone'] ?? null,
        email: tags.email ?? tags['contact:email'] ?? null,
        facebook: tags['contact:facebook'] ?? null,
        instagram: tags['contact:instagram'] ?? null,
        hasWebsite: Boolean(tags.website ?? tags['contact:website']),
      }
    })
}
