import { describe, expect, it } from 'vitest'
import { CODES, GRAPH } from './graph'
import { MAX_SUGGESTIONS, normalize, resolve, search } from './search'

describe('normalize', () => {
  it('folds case and accents', () => {
    expect(normalize('TÜRKIYE')).toBe('turkiye')
    expect(normalize('Côte d’Ivoire')).toBe('cote divoire')
  })

  it('collapses stray whitespace and punctuation', () => {
    expect(normalize('  South   Korea ')).toBe('south korea')
    expect(normalize("Lao People's")).toBe('lao peoples')
  })

  it('folds hyphens to spaces, because the keypad has no hyphen key', () => {
    expect(normalize('Guinea-Bissau')).toBe('guinea bissau')
    expect(normalize('Timor-Leste')).toBe('timor leste')
  })
})

describe('search', () => {
  it('finds nothing for an empty query', () => {
    expect(search('')).toEqual([])
    expect(search('   ')).toEqual([])
  })

  it('puts an exact name first', () => {
    expect(search('Chad')[0].code).toBe('TCD')
    expect(search('India')[0].code).toBe('IND')
  })

  it('matches without the accents nobody types', () => {
    expect(resolve('turkiye')).toBe('TUR')
    expect(resolve('cote divoire')).toBe('CIV')
  })

  it('knows the names people actually use', () => {
    expect(resolve('UK')).toBe('GBR')
    expect(resolve('USA')).toBe('USA')
    expect(resolve('Holland')).toBe('NLD')
    expect(resolve('UAE')).toBe('ARE')
    expect(resolve('DRC')).toBe('COD')
    expect(resolve('Great Britain')).toBe('GBR')
  })

  it('prefers a country whose common name matches over one whose alias does', () => {
    // "Ireland" is Ireland, even though it appears in Northern-Ireland aliases.
    expect(search('Ireland')[0].code).toBe('IRL')
  })

  it('completes from a prefix', () => {
    expect(
      search('nige')
        .map((m) => m.code)
        .sort(),
    ).toEqual(['NER', 'NGA'])
    expect(search('south k')[0].code).toBe('KOR')
  })

  it('distinguishes the two Koreas and the two Congos', () => {
    expect(resolve('North Korea')).toBe('PRK')
    expect(resolve('South Korea')).toBe('KOR')
    expect(resolve('DR Congo')).toBe('COD')
    expect(resolve('Republic of the Congo')).toBe('COG')
  })

  it('caps the list so the dropdown stays usable', () => {
    expect(search('a').length).toBeLessThanOrEqual(MAX_SUGGESTIONS)
    expect(search('an', 3)).toHaveLength(3)
  })

  it('is stable — the same query always ranks the same way', () => {
    expect(search('gu')).toEqual(search('gu'))
  })

  it('returns nothing for a query that names no country', () => {
    expect(search('qqqq')).toEqual([])
    expect(resolve('Atlantis')).toBeNull()
  })

  it('can reach every country in the graph by its own name', () => {
    for (const code of CODES) {
      expect(resolve(GRAPH[code].name), GRAPH[code].name).toBe(code)
    }
  })

  it('spells the hyphenated two the way they get typed', () => {
    expect(resolve('guinea bissau')).toBe('GNB')
    expect(resolve('timor leste')).toBe('TLS')
  })

  /**
   * What makes a 27-key on-screen keyboard enough. If a future data build lands
   * a common name carrying a digit, a slash or anything else outside A–Z and
   * space, this fails here rather than on somebody's phone.
   */
  it('can reach every country with only A–Z and space', () => {
    for (const code of CODES) {
      const typed = normalize(GRAPH[code].name)
      expect(typed, GRAPH[code].name).toMatch(/^[a-z ]+$/)
      expect(resolve(typed), typed).toBe(code)
    }
  })

  it('only ever suggests countries that are in play', () => {
    for (const query of ['a', 'san', 'mo', 'united', 'is']) {
      for (const match of search(query)) {
        expect(GRAPH[match.code], `${query} -> ${match.code}`).toBeDefined()
      }
    }
  })
})
