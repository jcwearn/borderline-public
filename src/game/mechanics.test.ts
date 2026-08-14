/**
 * Which barrier a round is taken to be showing, and what it is called.
 *
 * The line worth defending is between a closure and a region out of bounds:
 * they are the same field in the payload, and where the pool draws it is not
 * where the player sees it.
 */
import { describe, expect, it } from 'vitest'
import rawPool from '../../functions/data/pairs.json' with { type: 'json' }
import { MECHANICS, barriersIn } from './mechanics'
import { COMBOS, type PuzzlePool, holes } from './pool'
import { FAIRWAY_LIMIT, LONE_CLOSURE_LIMIT, type Puzzle } from './rules'
import { CODES, type CountryCode } from './graph'
import { regionNamed } from './regions'

const POOL = rawPool as unknown as PuzzlePool

/** A puzzle carrying nothing but the barriers a case is about. */
function puzzleOf(barriers: Partial<Puzzle>): Puzzle {
  return { id: 1, date: '2026-08-12', start: 'FRA', end: 'TUR', best: 3, par: 4, ...barriers }
}

/** Enough distinct countries to shut, in a round that never has to be playable. */
const SHUTTABLE: CountryCode[] = ['ITA', 'DEU', 'AUT', 'CHE', 'SVN', 'HRV']

/** One country past the fairway line, none of it an endpoint. */
const MOST_OF_THE_WORLD: CountryCode[] = CODES.filter(
  (code) => code !== 'FRA' && code !== 'TUR',
).slice(0, FAIRWAY_LIMIT + 1)

/**
 * The band beside it. A course is a corridor *between* rough and out of bounds,
 * which is what every line of the mechanic's copy says, so a carve is the two
 * fields together and not the closure alone.
 */
const A_BAND: CountryCode[] = CODES.filter(
  (code) => code !== 'FRA' && code !== 'TUR' && !MOST_OF_THE_WORLD.includes(code),
).slice(0, 2)

const A_COURSE = { closed: MOST_OF_THE_WORLD, rough: A_BAND }

const mechanicsOf = (barriers: Partial<Puzzle>) =>
  barriersIn(puzzleOf(barriers)).map((barrier) => barrier.mechanic)

describe('barriersIn', () => {
  it('says nothing about a hole that carries nothing', () => {
    expect(mechanicsOf({})).toEqual([])
    // The shape a decoded link produces, which is not the same shape as the
    // one the pool produces: present and empty rather than absent.
    expect(mechanicsOf({ closed: [], rough: [], required: [] })).toEqual([])
  })

  it('calls a closure a closure for as long as it reads as a border or two', () => {
    // Derived rather than written out, so retuning the limit moves the test
    // with it instead of leaving two literals to disagree.
    const few = SHUTTABLE.slice(0, LONE_CLOSURE_LIMIT)
    expect(few.length, 'the limit is more than one').toBeGreaterThan(1)
    expect(mechanicsOf({ closed: few.slice(0, 1) }), 'one shut').toEqual(['closed'])
    expect(mechanicsOf({ closed: few }), 'the limit exactly').toEqual(['closed'])
    expect(
      mechanicsOf({ closed: SHUTTABLE.slice(0, LONE_CLOSURE_LIMIT + 1) }),
      'one past the limit',
    ).toEqual(['bounds'])
  })

  it('never calls a round both at once', () => {
    for (let shut = 0; shut <= SHUTTABLE.length; shut++) {
      const mechanics = mechanicsOf({ closed: SHUTTABLE.slice(0, shut) })
      const both = mechanics.includes('closed') && mechanics.includes('bounds')
      expect(both, `${shut} shut`).toBe(false)
      expect(mechanics.length, `${shut} shut`).toBe(shut === 0 ? 0 : 1)
    }
  })

  it('explains a two-country region as the closure the player is looking at', () => {
    // Two of the curated regions are exactly `LONE_CLOSURE_LIMIT` countries,
    // so the build files these under `bounds` while the player sees two shut
    // borders and nothing that reads as a place. Thousands of committed holes
    // turn on it, and the test the shape of this invites — every `Combo` maps
    // to the mechanics its name claims — would pass only by explaining a
    // mechanic the round is not showing.
    const highlands = regionNamed('The Anatolian and Iranian highlands')!
    const iberia = regionNamed('The Iberian Peninsula')!
    expect(highlands.countries.length).toBe(LONE_CLOSURE_LIMIT)
    expect(mechanicsOf({ closed: highlands.countries })).toEqual(['closed'])
    expect(mechanicsOf({ closed: iberia.countries })).toEqual(['closed'])

    const shut = [...holes(POOL)].filter(
      (filed) =>
        filed.combo.startsWith('bounds') &&
        barriersIn(puzzleOf({ closed: filed.hole.closed as CountryCode[] })).some(
          (barrier) => barrier.mechanic === 'closed',
        ),
    )
    expect(shut.length, 'holes filed under bounds that read as shut borders').toBeGreaterThan(0)
  })

  it('calls a round a fairway once the closure is most of the world', () => {
    // Derived from the limit like the closure cases above, so retuning it
    // moves the test. At the line exactly it is still a region ruled off; one
    // past and what remains is a course.
    expect(MOST_OF_THE_WORLD.length).toBe(FAIRWAY_LIMIT + 1)
    expect(
      mechanicsOf({ closed: MOST_OF_THE_WORLD.slice(0, FAIRWAY_LIMIT), rough: A_BAND }),
    ).toEqual(['rough', 'bounds'])
    expect(mechanicsOf(A_COURSE)).toEqual(['fairway'])
  })

  it('will not call a bandless closure a course, however wide it is', () => {
    // Every line of the fairway's copy — the pill, the modal, the rules card's
    // fourth step — says the corridor runs between rough and out of bounds. On
    // a round with nothing in the rough that is not merely tonally off, it is
    // false, and it would be saying so while standing down the count that is
    // true. Only a hand-built round reaches this: the generator derives a band
    // and the build refuses a course without one.
    expect(mechanicsOf({ closed: MOST_OF_THE_WORLD })).toEqual(['bounds'])
    expect(mechanicsOf({ closed: MOST_OF_THE_WORLD, rough: [] })).toEqual(['bounds'])
    // And the count a course stands down is the one the player then reads.
    expect(barriersIn(puzzleOf({ closed: MOST_OF_THE_WORLD }))[0].label).toBe(
      `${MOST_OF_THE_WORLD.length} countries`,
    )
  })

  it('stands the rough down on a fairway day, and the dogleg not', () => {
    // "112 countries are out of bounds today" and "14 countries are rough
    // today" are both true of a fairway day and both the wrong thing to say —
    // one pill speaks for the course. A waypoint is an ask on top of the
    // course, not part of its shape, so it still reads out.
    expect(mechanicsOf({ closed: MOST_OF_THE_WORLD, rough: ['AUT', 'CHE'] })).toEqual(['fairway'])
    expect(mechanicsOf({ closed: MOST_OF_THE_WORLD, rough: ['AUT'], required: ['GRC'] })).toEqual([
      'fairway',
      'dogleg',
    ])
  })

  it('reads every committed fairway hole as a fairway and nothing else', () => {
    const fairways = [...holes(POOL)].filter((filed) => filed.combo === 'fairway')
    expect(fairways.length).toBeGreaterThan(0)
    for (const filed of fairways.filter((_, at) => at % 97 === 0)) {
      expect(
        mechanicsOf({
          closed: filed.hole.closed as CountryCode[],
          rough: filed.hole.rough as CountryCode[],
        }),
        `${filed.hole.start}->${filed.hole.end}`,
      ).toEqual(['fairway'])
    }
  })

  it('reports a doubled hole in MECHANICS order, whatever order the fields were written in', () => {
    expect(mechanicsOf({ closed: ['ITA'], rough: ['AUT'] })).toEqual(['rough', 'closed'])
    expect(mechanicsOf({ closed: ['ITA'], required: ['GRC'] })).toEqual(['dogleg', 'closed'])
    expect(mechanicsOf({ rough: ['AUT'], required: ['GRC'] })).toEqual(['dogleg', 'rough'])
    expect(mechanicsOf({ closed: SHUTTABLE, required: ['GRC'] })).toEqual(['dogleg', 'bounds'])
    // The same round with the keys the other way up. The order is the one
    // `MECHANICS` declares and never the object's.
    expect(mechanicsOf({ required: ['GRC'], closed: ['ITA'] })).toEqual(['dogleg', 'closed'])
  })

  it('has a copy slot for every barrier the pool can build, and no others', () => {
    const built = [...new Set(COMBOS.flatMap((c) => (c === 'open' ? [] : c.split('+'))))]
    expect(built.sort()).toEqual([...MECHANICS].sort())
  })
})

describe('what a barrier is called', () => {
  const barrierOf = (barriers: Partial<Puzzle>, mechanic: string) =>
    barriersIn(puzzleOf(barriers)).find((barrier) => barrier.mechanic === mechanic)
  const labelOf = (barriers: Partial<Puzzle>, mechanic: string) =>
    barrierOf(barriers, mechanic)?.label
  const pluralOf = (barriers: Partial<Puzzle>, mechanic: string) =>
    barrierOf(barriers, mechanic)?.plural

  it('counts a closure rather than naming it', () => {
    // The banner used to read "Chad and Libya closed today", which was a
    // country's name for nothing on a board where names are the currency. The
    // shapes are greyed and sunk; that is what the player gets.
    expect(labelOf({ closed: ['TCD'] }, 'closed')).toBe('1 country')
    expect(labelOf({ closed: ['TCD', 'LBY'] }, 'closed')).toBe('2 countries')
  })

  it('names a closure that is a whole place, small as the place is', () => {
    // The one shape of closure that can be a region at all: two of the twelve
    // are exactly two countries, which is the most a closure ever shuts. Still
    // explained as a closure — that is `CARRIES` — but a place has a name, and
    // naming it is not naming what is in it.
    const iberia = regionNamed('The Iberian Peninsula')!
    expect(labelOf({ closed: iberia.countries }, 'closed')).toBe('The Iberian Peninsula')
    expect(pluralOf({ closed: iberia.countries }, 'closed')).toBe(false)
  })

  it('names a region ruled off as the place it is', () => {
    const maghreb = regionNamed('The Maghreb')!
    expect(labelOf({ closed: maghreb.countries }, 'bounds')).toBe('The Maghreb')
  })

  it('counts a set that is only nearly a region rather than calling it one', () => {
    // `regionOf` is exact on purpose: naming a near-miss would be a lie about
    // which countries the round actually shut, and the banner reads it.
    const maghreb = regionNamed('The Maghreb')!
    expect(labelOf({ closed: [...maghreb.countries, 'EGY'] }, 'bounds')).toBe('5 countries')
  })

  it('names the rough as a region, and counts it otherwise', () => {
    const carpathians = regionNamed('The Carpathians')!
    expect(labelOf({ rough: carpathians.countries }, 'rough')).toBe('The Carpathians')
    // Not "Austria". Rough ground is ground you may cross, so its name is
    // exactly what a player would otherwise have to buy.
    expect(labelOf({ rough: ['AUT'] }, 'rough')).toBe('1 country')
    expect(labelOf({ rough: ['ITA', 'AUT'] }, 'rough')).toBe('2 countries')
  })

  it('names a region of any size, down to the two-country ones', () => {
    // No floor on this, and it was worth stating: a two-country region is the
    // closest a place name comes to being a list of its members, and it is
    // still a place. `regionOf`'s exactness is the only bar.
    for (const name of ['The Iberian Peninsula', 'The Anatolian and Iranian highlands']) {
      const region = regionNamed(name)!
      expect(region.countries.length, name).toBe(2)
      expect(labelOf({ rough: region.countries }, 'rough'), name).toBe(name)
    }
  })

  it('agrees with the verb the banner is about to put after it', () => {
    // The sentences are JSX and no test here can run them, so the agreement is
    // decided in this module and read from it in four places.
    const maghreb = regionNamed('The Maghreb')!
    const carpathians = regionNamed('The Carpathians')!
    expect(pluralOf({ rough: ['AUT'] }, 'rough'), '1 country is').toBe(false)
    expect(pluralOf({ rough: ['ITA', 'AUT'] }, 'rough'), '2 countries are').toBe(true)
    expect(pluralOf({ closed: ['TCD'] }, 'closed'), '1 country is').toBe(false)
    expect(pluralOf({ closed: ['TCD', 'LBY'] }, 'closed'), '2 countries are').toBe(true)
    expect(pluralOf({ closed: maghreb.countries }, 'bounds'), 'The Maghreb is').toBe(false)
    expect(pluralOf({ closed: [...maghreb.countries, 'EGY'] }, 'bounds'), '5 countries are').toBe(
      true,
    )
    // One place, plural verb. The banner read "The Carpathians is rough today"
    // for as long as there was a banner, because the agreement did not exist to
    // be got wrong.
    expect(pluralOf({ rough: carpathians.countries }, 'rough'), 'The Carpathians are').toBe(true)
  })

  it('never names the fairway', () => {
    // The course is on the globe, drawn. A count of the shut world is the
    // tonal failure the mechanic exists to avoid, and there is no name that
    // is not a list of most of the planet.
    expect(labelOf(A_COURSE, 'fairway')).toBeNull()
    expect(pluralOf(A_COURSE, 'fairway')).toBe(false)
  })

  it('never names the dogleg', () => {
    // Null by design and not by absence: the globe marks the waypoint and
    // raises it, so the player is told where. Naming it is the hole. Not even
    // counted — there is only ever one, and saying so says nothing.
    expect(labelOf({ required: ['GRC'] }, 'dogleg')).toBeNull()
    expect(pluralOf({ required: ['GRC'] }, 'dogleg')).toBe(false)
  })
})
