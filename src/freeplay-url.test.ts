import { describe, expect, it } from 'vitest'
import { entryQuery, readEntry } from './freeplay-url'
import { LINK_CODES } from './link-codes'
import { CODES } from './game/graph'

describe('readEntry', () => {
  it('leaves an ordinary visit on the daily', () => {
    expect(readEntry('')).toEqual({ mode: 'daily' })
    expect(readEntry('?utm_source=somewhere')).toEqual({ mode: 'daily' })
  })

  it('opens the builder when free play is named with no round', () => {
    expect(readEntry('?free')).toEqual({ mode: 'free', recipe: null })
    expect(readEntry('?free=')).toEqual({ mode: 'free', recipe: null })
  })

  it('reads a short round out of the address bar', () => {
    expect(readEntry('?g=h1o')).toEqual({
      mode: 'free',
      recipe: { start: 'SRB', end: 'LTU', closed: [] },
    })
    expect(readEntry('?g=RGEOPIc')).toEqual({
      mode: 'free',
      recipe: { start: 'IND', end: 'MKD', closed: ['BGR', 'GRC', 'SRB'] },
    })
  })

  it('falls back to the builder rather than guessing at a broken code', () => {
    for (const broken of [
      '?g',
      '?g=',
      '?g=Mw', // one byte: an endpoint with nothing to reach
      '?g=!!!!', // not base64 at all
      '?g=____', // decodes, but no country lives at 255
    ]) {
      expect(readEntry(broken), broken).toEqual({ mode: 'free', recipe: null })
    }
  })

  it('reads a round out of the address bar', () => {
    expect(readEntry('?free=SRB-LTU')).toEqual({
      mode: 'free',
      recipe: { start: 'SRB', end: 'LTU', closed: [] },
    })
  })

  it('reads the closed borders too', () => {
    expect(readEntry('?free=FRA-POL&closed=DEU,CZE')).toEqual({
      mode: 'free',
      recipe: { start: 'FRA', end: 'POL', closed: ['DEU', 'CZE'] },
    })
  })

  it('is forgiving about case and stray spaces', () => {
    expect(readEntry('?free=fra-pol&closed=deu, cze')).toEqual({
      mode: 'free',
      recipe: { start: 'FRA', end: 'POL', closed: ['DEU', 'CZE'] },
    })
  })

  it('still reads a round shared before the short form existed', () => {
    // Every free round ever shared is a line of text in someone else's message
    // thread. Nothing writes this form any more; it has to keep working anyway.
    expect(readEntry('?free=IND-MKD&closed=BGR,GRC,SRB')).toEqual(readEntry('?g=RGEOPIc'))
  })

  it('falls back to the builder rather than guessing at a broken round', () => {
    // Whatever this was meant to be, inventing a puzzle from it would be worse
    // than showing the form with nothing filled in.
    for (const broken of ['?free=SRB', '?free=SRB-', '?free=-LTU', '?free=A-B-C']) {
      expect(readEntry(broken), broken).toEqual({ mode: 'free', recipe: null })
    }
  })
})

describe('entryQuery', () => {
  it('round-trips a round through the address bar', () => {
    for (const recipe of [
      { start: 'SRB', end: 'LTU', closed: [] },
      { start: 'FRA', end: 'POL', closed: ['DEU'] },
      { start: 'CHN', end: 'JPN', closed: ['PRK', 'KOR'] },
    ]) {
      expect(readEntry(entryQuery(recipe))).toEqual({ mode: 'free', recipe })
    }
  })

  it('writes the short form', () => {
    expect(entryQuery({ start: 'SRB', end: 'LTU' })).toBe('?g=h1o')
    expect(entryQuery({ start: 'FRA', end: 'POL', closed: ['DEU'] })).toBe('?g=M3gm')
  })

  it('stays short as borders are shut', () => {
    // The point of the whole encoding: the spelled-out form grows by four
    // characters a closure, this one by rather less than two.
    const long = entryQuery({ start: 'IND', end: 'MKD', closed: ['BGR', 'GRC', 'SRB'] })
    expect(long).toBe('?g=RGEOPIc')
    expect(long.length).toBeLessThan('?free=IND-MKD&closed=BGR,GRC,SRB'.length / 2)
  })

  it('asks for the builder when there is no round yet', () => {
    expect(entryQuery(null)).toBe('?free')
  })
})

describe('LINK_CODES', () => {
  it('has a slot for every country in the graph', () => {
    // A country the table has never heard of cannot be shared. The build
    // asserts this too; here so a plain `npm test` says so first.
    expect(CODES.filter((code) => !LINK_CODES.includes(code))).toEqual([])
  })

  it('addresses every country within one byte', () => {
    expect(LINK_CODES.length).toBeLessThanOrEqual(256)
    expect(new Set(LINK_CODES).size).toBe(LINK_CODES.length)
  })

  it('round-trips every country in the graph', () => {
    for (const code of CODES) {
      if (code === 'FRA') continue
      expect(readEntry(entryQuery({ start: 'FRA', end: code })), code).toEqual({
        mode: 'free',
        recipe: { start: 'FRA', end: code, closed: [] },
      })
    }
  })
})

/**
 * Links written before the rough existed, by hand rather than by the encoder.
 *
 * Generating this table from `LINK_CODES` would prove only that the code agrees
 * with itself. These strings are what is actually in the wild — in someone's
 * messages, on someone's card — and the whole design of the v2 sentinel is
 * aimed at them still meaning what they meant.
 */
const ALREADY_SHARED: [string, { start: string; end: string; closed: string[] }][] = [
  // Every one of these is written down somewhere it has already been read:
  // `?g=M5c` in CLAUDE.md, the other three in this module's own header and in
  // the README. If one of them ever decodes to something else, a link that has
  // been published has changed meaning.
  ['M5c', { start: 'FRA', end: 'TUR', closed: [] }],
  ['M3gm', { start: 'FRA', end: 'POL', closed: ['DEU'] }],
  ['h1oOLA', { start: 'SRB', end: 'LTU', closed: ['BGR', 'EGY'] }],
  ['RGEOPIc', { start: 'IND', end: 'MKD', closed: ['BGR', 'GRC', 'SRB'] }],
]

describe('the links people already have', () => {
  it('still name exactly the round they always did', () => {
    for (const [code, expected] of ALREADY_SHARED) {
      expect(readEntry(`?g=${code}`), code).toEqual({ mode: 'free', recipe: expected })
    }
  })

  it('are still what the encoder writes for a round without rough', () => {
    for (const [code, recipe] of ALREADY_SHARED) {
      expect(entryQuery(recipe), code).toBe(`?g=${code}`)
    }
  })
})

describe('the rough in a link', () => {
  const ROUGH = { start: 'FRA', end: 'TUR', rough: ['ITA', 'AUT', 'CHE', 'SVN'] }

  it('round-trips', () => {
    const query = entryQuery(ROUGH)
    expect(readEntry(query)).toEqual({ mode: 'free', recipe: ROUGH })
  })

  it('round-trips alongside closures', () => {
    const both = { start: 'FRA', end: 'TUR', closed: ['DEU', 'CZE'], rough: ['ITA', 'AUT'] }
    expect(readEntry(entryQuery(both))).toEqual({ mode: 'free', recipe: both })
  })

  it('leaves a round without rough on the old short form', () => {
    // The property that keeps every existing link short as well as correct.
    expect(entryQuery({ start: 'FRA', end: 'POL', closed: ['DEU'] })).toBe('?g=M3gm')
  })

  it('carries a waypoint too, and both at once', () => {
    const via = { start: 'FRA', end: 'POL', required: ['ITA'] }
    expect(readEntry(entryQuery(via))).toEqual({ mode: 'free', recipe: via })

    const everything = {
      start: 'FRA',
      end: 'TUR',
      closed: ['DEU'],
      rough: ['ITA', 'AUT'],
      required: ['GRC'],
    }
    expect(readEntry(entryQuery(everything))).toEqual({ mode: 'free', recipe: everything })
  })

  it('refuses a link naming more than one country to pass through', () => {
    // Not truncated to the first, for the reason an unknown section is refused
    // outright: a link describing a round this build cannot set would otherwise
    // quietly hand over a *different* one. The format itself is unchanged — a
    // length-prefixed list, as it has always been — so every link ever shared
    // with a single waypoint still decodes.
    const both = entryQuery({ start: 'FRA', end: 'POL', required: ['ITA', 'AUT'] })
    expect(both.startsWith('?g=')).toBe(true)
    expect(readEntry(both)).toEqual({ mode: 'free', recipe: null })
  })

  it('reads a waypoint spelled out as `via`', () => {
    expect(readEntry('?free=FRA-POL&via=ITA')).toEqual({
      mode: 'free',
      recipe: { start: 'FRA', end: 'POL', closed: [], required: ['ITA'] },
    })
  })

  it('is readable spelled out, for typing by hand', () => {
    expect(readEntry('?free=FRA-TUR&rough=ITA,AUT')).toEqual({
      mode: 'free',
      recipe: { start: 'FRA', end: 'TUR', closed: [], rough: ['ITA', 'AUT'] },
    })
  })

  it('refuses a section it does not understand rather than skipping it', () => {
    // Tag 9 stands in for any future section. Tag 4 was once exactly this — a
    // build from before the fairway refuses a fairway link whole, rather than
    // playing the round minus the part it could not read.
    // A link from a later build describes a round this one cannot play. Playing
    // the part it understands would hand the player a different puzzle under
    // the same link, which is the one failure the format exists to prevent.
    const unknownTag = btoa(String.fromCharCode(0xff, 0, 1, 9, 1, 2))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(readEntry(`?g=${unknownTag}`)).toEqual({ mode: 'free', recipe: null })
  })

  it('refuses a section that runs off the end', () => {
    const truncated = btoa(String.fromCharCode(0xff, 0, 1, 2, 5, 3))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(readEntry(`?g=${truncated}`)).toEqual({ mode: 'free', recipe: null })
  })

  it('refuses a link that fills one field twice', () => {
    // Never written by the encoder, and reachable by hand. The pairing that
    // makes it worth refusing rather than resolving is `closed` against `open`:
    // they are two spellings of one field, inverted, so whichever section came
    // last would decide whether ~130 countries are shut or open — the same
    // link handing over two different rounds depending on the order its
    // sections happen to be in. Refused for the reason an unknown tag is.
    const link = (...bytes: number[]) =>
      btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')

    // [closed: 1 country][open: 1 country] — the conflict this made expressible.
    expect(readEntry(`?g=${link(0xff, 0, 1, 1, 1, 2, 4, 1, 3)}`)).toEqual({
      mode: 'free',
      recipe: null,
    })
    // The same field twice under its own tag, which last-wins used to swallow.
    expect(readEntry(`?g=${link(0xff, 0, 1, 1, 1, 2, 1, 1, 3)}`)).toEqual({
      mode: 'free',
      recipe: null,
    })
    // One of each is still a round, so the refusal is about the repeat alone.
    expect(readEntry(`?g=${link(0xff, 0, 1, 1, 1, 2, 2, 1, 3)}`)).toEqual({
      mode: 'free',
      recipe: {
        start: LINK_CODES[0],
        end: LINK_CODES[1],
        closed: [LINK_CODES[2]],
        rough: [LINK_CODES[3]],
      },
    })
  })
})

describe('a fairway in a link', () => {
  // The shape a fairway day shares: one corridor open, a band of rough, and
  // most of the planet shut. Spelled out as closures that is a ~650-character
  // link; the complement section carries the ~34 open countries instead.
  const fairway = ['BFA', 'BWA', 'CAF', 'CIV', 'COD', 'NER', 'TCD', 'ZAF', 'ZMB']
  const rough = ['AGO', 'BEN', 'CMR', 'COG', 'GHA', 'MLI', 'MOZ', 'NGA', 'TGO', 'ZWE']
  const closed = LINK_CODES.filter(
    (code) => !fairway.includes(code) && !rough.includes(code),
  ).sort()
  const FAIRWAY = { start: 'CIV', end: 'ZAF', closed, rough }

  it('round-trips, and comes back in the order the pool writes', () => {
    expect(closed.length).toBeGreaterThan(100)
    expect(readEntry(entryQuery(FAIRWAY))).toEqual({ mode: 'free', recipe: FAIRWAY })
  })

  it('stays a link rather than a letter', () => {
    // ~131 closures at a byte apiece would be ~180 characters of base64; the
    // open ground is a fraction of that.
    const query = entryQuery(FAIRWAY)
    expect(query.startsWith('?g=')).toBe(true)
    expect(query.length).toBeLessThan(120)
  })

  it('writes the complement even with nothing in the rough', () => {
    const bare = { start: 'CIV', end: 'ZAF', closed }
    const query = entryQuery(bare)
    expect(query.length).toBeLessThan(80)
    expect(readEntry(query)).toEqual({ mode: 'free', recipe: bare })
  })

  it('leaves a closure at half the world on the form it always had', () => {
    // The crossover is at strictly more shut than open. At half exactly the
    // old byte-per-closure form is no longer than the complement would be,
    // and an existing link is worth more than a tied byte count.
    const half = LINK_CODES.filter((code) => code !== 'FRA' && code !== 'TUR').slice(
      0,
      Math.floor(LINK_CODES.length / 2),
    )
    const recipe = { start: 'FRA', end: 'TUR', closed: half }
    expect(readEntry(entryQuery(recipe))).toEqual({ mode: 'free', recipe })
  })

  it('flips to the complement one past half, and comes back sorted', () => {
    const most = LINK_CODES.filter((code) => code !== 'FRA' && code !== 'TUR').slice(
      0,
      Math.floor(LINK_CODES.length / 2) + 1,
    )
    expect(readEntry(entryQuery({ start: 'FRA', end: 'TUR', closed: most }))).toEqual({
      mode: 'free',
      recipe: { start: 'FRA', end: 'TUR', closed: [...most].sort() },
    })
  })
})
