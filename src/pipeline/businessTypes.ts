export const BUSINESS_TYPE_TAGS: Record<string, string[]> = {
  gyms: [
    'leisure=fitness_centre',
    'sport=fitness',
    'sport=crossfit',
    'sport=martial_arts',
    'sport=yoga',
    'sport=boxing',
  ],
}

export function getTagsForBusinessType(businessType: string): string[] {
  const tags = BUSINESS_TYPE_TAGS[businessType]
  if (!tags) {
    throw new Error(`Unknown business type: ${businessType}. Known types: ${Object.keys(BUSINESS_TYPE_TAGS).join(', ')}`)
  }
  return tags
}
