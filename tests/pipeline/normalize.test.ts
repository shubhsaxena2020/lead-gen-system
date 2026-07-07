import { describe, it, expect } from 'vitest'
import { normalizeLead } from '../../src/pipeline/normalize.js'
import type { RawBusiness } from '../../src/types.js'

describe('normalizeLead', () => {
  it('fills in all fields when present', () => {
    const raw: RawBusiness = {
      name: '  iron fist gym  ',
      street: '123 Main St',
      city: 'Austin',
      phone: '512-555-0100',
      email: 'info@ironfist.example',
      facebook: 'https://facebook.com/ironfistgym',
      instagram: null,
      hasWebsite: false,
    }

    const result = normalizeLead(raw, 'United States', 'Texas')

    expect(result).toEqual({
      businessName: 'Iron Fist Gym',
      country: 'United States',
      state: 'Texas',
      city: 'Austin',
      phone: '512-555-0100',
      email: 'info@ironfist.example',
      socialLink: 'https://facebook.com/ironfistgym',
      websiteStatus: 'none',
      dateFound: expect.any(String),
    })
  })

  it('uses "not found" for missing email, phone, and social link', () => {
    const raw: RawBusiness = {
      name: 'Small Town Gym',
      street: null,
      city: null,
      phone: null,
      email: null,
      facebook: null,
      instagram: null,
      hasWebsite: false,
    }

    const result = normalizeLead(raw, 'United States', 'Ohio')

    expect(result.phone).toBe('not found')
    expect(result.email).toBe('not found')
    expect(result.socialLink).toBe('not found')
    expect(result.city).toBe('not found')
  })

  it('prefers facebook over instagram when both are present', () => {
    const raw: RawBusiness = {
      name: 'Test Gym',
      street: null,
      city: null,
      phone: null,
      email: null,
      facebook: 'https://facebook.com/testgym',
      instagram: 'https://instagram.com/testgym',
      hasWebsite: false,
    }

    const result = normalizeLead(raw, 'United States', 'Ohio')
    expect(result.socialLink).toBe('https://facebook.com/testgym')
  })

  it('title-cases business names that are all lowercase or all uppercase', () => {
    const raw: RawBusiness = {
      name: 'IRON FIST GYM',
      street: null, city: null, phone: null, email: null, facebook: null, instagram: null, hasWebsite: false,
    }
    expect(normalizeLead(raw, 'US', 'Texas').businessName).toBe('Iron Fist Gym')
  })
})
