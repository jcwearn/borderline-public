import { describe, expect, it } from 'vitest'
import { onRequestGet } from './region'

type Cf = { country?: string; isEUCountry?: string | boolean }

function call(cf?: Cf, headers?: HeadersInit) {
  const request = new Request('https://borderline.test/api/region', { headers }) as Request & {
    cf?: Cf
  }
  if (cf) Object.defineProperty(request, 'cf', { value: cf })
  return onRequestGet({ request })
}

describe('GET /api/region', () => {
  it('lets an American be measured', async () => {
    await expect(call({ country: 'US', isEUCountry: false }).json()).resolves.toEqual({
      analytics: true,
    })
  })

  it('refuses to measure a German', async () => {
    await expect(call({ country: 'DE', isEUCountry: '1' }).json()).resolves.toEqual({
      analytics: false,
    })
  })

  it('is never cached, because the answer is different per country', () => {
    // An edge holding one of these for everybody is the whole failure mode.
    expect(call({ country: 'US' }).headers.get('cache-control')).toBe('no-store')
  })

  it('falls back to the header when cf is not there', async () => {
    await expect(call(undefined, { 'cf-ipcountry': 'GB' }).json()).resolves.toEqual({
      analytics: false,
    })
  })

  it('gates rather than guesses when there is no country at all', async () => {
    await expect(call().json()).resolves.toEqual({ analytics: false })
  })
})
