import { describe, expect, it } from 'vitest'
import { isGated } from './privacy-region'

describe('isGated', () => {
  it('gates the EEA, the UK and Switzerland', () => {
    for (const country of ['DE', 'FR', 'IE', 'MT', 'IS', 'LI', 'NO', 'GB', 'CH']) {
      expect(isGated(country, '0')).toBe(true)
    }
  })

  it('does not need Cloudflare’s flag to gate an EU country', () => {
    // The flag is documented as the string "1" and arrives from the local
    // runtime as boolean false. A gate resting on that alone is one type change
    // away from measuring all of Europe.
    expect(isGated('DE', false)).toBe(true)
    expect(isGated('FR', undefined)).toBe(true)
  })

  it('still takes the flag’s word for a country it has not heard of', () => {
    // Whatever shape it arrives in. This is what covers a member state joining
    // after this list was written.
    expect(isGated('XX', '1')).toBe(true)
    expect(isGated('XX', true)).toBe(true)
    expect(isGated('XX', 1)).toBe(true)
  })

  it('measures everybody else', () => {
    expect(isGated('US', '0')).toBe(false)
    expect(isGated('CA', '0')).toBe(false)
    expect(isGated('JP', undefined)).toBe(false)
    expect(isGated('AU', null)).toBe(false)
  })

  it('gates a country it cannot work out', () => {
    // Fail closed: an uncounted player costs a data point, a measured one who
    // should not have been costs the thing the gate is for.
    expect(isGated(undefined, undefined)).toBe(true)
    expect(isGated(null, null)).toBe(true)
    expect(isGated('', '0')).toBe(true)
  })

  it('does not care how the country is cased', () => {
    expect(isGated('gb', '0')).toBe(true)
  })
})
