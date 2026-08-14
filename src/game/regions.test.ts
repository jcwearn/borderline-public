/**
 * The regions as the browser sees them, and the two questions the builder asks
 * of them: which are worth roughening, and which are worth ruling off.
 */
import { describe, expect, it } from 'vitest'
import { REGIONS, boundsFor, regionIsPlural, regionNamed, regionOf, roughFor } from './regions'
import { GRAPH, distance, without } from './graph'

describe('the regions themselves', () => {
  it('ships every one with a name and some countries', () => {
    expect(REGIONS.length).toBeGreaterThan(0)
    for (const region of REGIONS) {
      expect(region.name.length, region.name).toBeGreaterThan(0)
      expect(region.countries.length, region.name).toBeGreaterThan(1)
      for (const code of region.countries)
        expect(GRAPH[code], `${region.name}: ${code}`).toBeDefined()
    }
  })

  it('finds one by name', () => {
    expect(regionNamed('The Maghreb')?.countries).toContain('DZA')
    expect(regionNamed('Nowhere')).toBeUndefined()
  })

  it('knows which names take a plural verb, and holds each to a real region', () => {
    // The list is written out rather than derived, so the thing that can go
    // wrong is a rename leaving an entry pointing at nothing — and it would go
    // wrong silently, as a banner quietly saying "is" again.
    const plural = REGIONS.filter(regionIsPlural).map((region) => region.name)
    expect(plural.sort()).toEqual([
      'The Alps',
      'The Anatolian and Iranian highlands',
      'The Carpathians',
    ])
    expect(regionIsPlural(regionNamed('The Maghreb')!)).toBe(false)
    // The counter-example to every rule anybody would rather have written: a
    // trailing s on a singular name.
    expect(regionIsPlural(regionNamed('The Caucasus')!)).toBe(false)
  })
})

describe('regionOf', () => {
  it('recognises a set that is exactly a region, in any order', () => {
    const maghreb = regionNamed('The Maghreb')!
    expect(regionOf([...maghreb.countries].reverse())?.name).toBe('The Maghreb')
  })

  it('refuses a set that is only nearly one', () => {
    // Calling a near-miss by the region's name would be a lie about which
    // countries the round actually shut, and the banner reads it.
    const maghreb = regionNamed('The Maghreb')!
    expect(regionOf(maghreb.countries.slice(1))).toBeUndefined()
    expect(regionOf([...maghreb.countries, 'FRA'])).toBeUndefined()
  })

  it('has nothing to say about an empty set or a repeated one', () => {
    expect(regionOf([])).toBeUndefined()
    expect(regionOf(['DZA', 'DZA'])).toBeUndefined()
  })
})

describe('roughFor', () => {
  const options = roughFor('FRA', 'EGY')

  it('only offers regions that change what the route costs', () => {
    const open = distance('FRA', 'EGY')!
    for (const option of options) {
      const priced = distance('FRA', 'EGY', undefined, new Set(option.region.countries))!
      expect(priced, option.region.name).toBeGreaterThan(open)
      expect(option.best, option.region.name).toBe(priced - 1)
    }
  })

  it('never offers a region holding either endpoint', () => {
    // The premium is charged on arrival, so a rough endpoint would make the
    // hole cost different amounts measured from either end.
    for (const option of options) {
      expect(option.region.countries, option.region.name).not.toContain('FRA')
      expect(option.region.countries, option.region.name).not.toContain('EGY')
    }
  })

  it('puts the dearest first', () => {
    const costs = options.map((option) => option.best)
    expect([...costs].sort((a, b) => b - a)).toEqual(costs)
  })

  it('reports whether there is a way round at all', () => {
    for (const option of options) {
      const skirted = distance('FRA', 'EGY', without(option.region.countries))
      expect(option.around, option.region.name).toBe(skirted === null ? null : skirted - 1)
    }
  })
})

describe('boundsFor', () => {
  const options = boundsFor('FRA', 'EGY')

  it('only offers regions whose shutting lengthens the route', () => {
    const open = distance('FRA', 'EGY')!
    for (const option of options) {
      const shut = distance('FRA', 'EGY', without(option.region.countries))!
      expect(shut, option.region.name).toBeGreaterThan(open)
      expect(option.best, option.region.name).toBe(shut - 1)
    }
  })

  it('leaves out any region whose shutting cuts every route', () => {
    // Not a harder puzzle — no puzzle. `newGame` refuses it too, but the
    // builder should never have offered it in the first place.
    for (const option of options) {
      expect(
        distance('FRA', 'EGY', without(option.region.countries)),
        option.region.name,
      ).not.toBeNull()
    }
  })

  it('never offers a region holding either endpoint', () => {
    for (const option of options) {
      expect(option.region.countries, option.region.name).not.toContain('FRA')
      expect(option.region.countries, option.region.name).not.toContain('EGY')
    }
  })

  it('finds nothing at all for a pair nothing can separate', () => {
    // Two neighbours: no region sits between them, so none can lengthen it.
    expect(boundsFor('FRA', 'DEU')).toEqual([])
  })
})
