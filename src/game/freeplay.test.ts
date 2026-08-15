import { describe, expect, it } from 'vitest'
import rawPool from '../../functions/data/pairs.json' with { type: 'json' }
import { entryQuery } from '../freeplay-url'
import { difficultyOf, parFor, type PuzzlePool } from './daily'
import { holes } from './pool'
import { CODES, distance, isSea, links, shortestPath, without } from './graph'
import {
  EMPTY_DRAFT,
  assign,
  buildPuzzle,
  deriveFairway,
  draftOf,
  isEmptyDraft,
  previewOf,
  randomRecipe,
  recipeOfDraft,
  recipeOfPuzzle,
  type Draft,
  type Recipe,
} from './freeplay'
import { FAIRWAY_LIMIT, newGame, place } from './rules'

const POOL = rawPool as unknown as PuzzlePool

/** The puzzle, or a failure with the error attached so it reads in the report. */
function built(recipe: Parameters<typeof buildPuzzle>[0]) {
  const result = buildPuzzle(recipe)
  if ('error' in result) throw new Error(`expected a puzzle, got: ${result.error}`)
  return result.puzzle
}

function failure(recipe: Parameters<typeof buildPuzzle>[0]): string {
  const result = buildPuzzle(recipe)
  if ('puzzle' in result) throw new Error('expected a refusal, got a puzzle')
  return result.error
}

/** A predictable stand-in for Math.random, so a "random" test can be repeated. */
function sequence(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648
    return value / 2147483648
  }
}

describe('buildPuzzle', () => {
  it('works out the route the same way the pool does', () => {
    const puzzle = built({ start: 'FRA', end: 'POL' })
    expect(puzzle.best).toBe(distance('FRA', 'POL')! - 1)
    expect(puzzle.start).toBe('FRA')
    expect(puzzle.end).toBe('POL')
  })

  it('measures the route around the closures, not through them', () => {
    const puzzle = built({ start: 'FRA', end: 'POL', closed: ['DEU'] })
    expect(puzzle.closed).toEqual(['DEU'])
    expect(puzzle.best).toBe(distance('FRA', 'POL', without(['DEU']))! - 1)
    expect(puzzle.best).toBeGreaterThan(built({ start: 'FRA', end: 'POL' }).best)
  })

  it('gives par the same shot in hand the daily would', () => {
    for (const recipe of [
      { start: 'FRA', end: 'POL' },
      { start: 'PRT', end: 'CHN' },
      { start: 'NGA', end: 'KOR' },
      { start: 'FRA', end: 'POL', closed: ['DEU'] },
    ]) {
      const puzzle = built(recipe)
      expect(puzzle.par).toBe(parFor(puzzle.best, difficultyOf(puzzle.best)))
      expect(puzzle.par).toBeGreaterThan(puzzle.best)
    }
  })

  it('marks the puzzle free, which is what keeps it out of the record', () => {
    expect(built({ start: 'FRA', end: 'POL' }).free).toBe(true)
  })

  it('builds something actually playable', () => {
    const puzzle = built({ start: 'FRA', end: 'POL', closed: ['DEU'] })
    const won = ['CHE', 'AUT', 'CZE'].reduce((s, c) => place(s, c).state, newGame(puzzle))
    expect(won.status).toBe('won')
    expect(won.placed).toHaveLength(puzzle.best)
  })

  it('crosses water when the route has to', () => {
    const puzzle = built({ start: 'CHN', end: 'JPN' })
    // Two countries and one crossing: the crossing costs the extra shot, so the
    // route length is three even though only two countries are placed.
    expect(puzzle.best).toBe(3)
    const won = ['PRK', 'KOR'].reduce((s, c) => place(s, c).state, newGame(puzzle))
    expect(won.status).toBe('won')
  })

  describe('refusals', () => {
    it('will not pair a country with itself', () => {
      expect(failure({ start: 'FRA', end: 'FRA' })).toMatch(/two different/)
    })

    it('will not take a country it does not know', () => {
      expect(failure({ start: 'XXX', end: 'POL' })).toMatch(/not a country/)
      expect(failure({ start: 'FRA', end: 'POL', closed: ['XXX'] })).toMatch(/not one we know/)
    })

    it('will not close one of the endpoints', () => {
      expect(failure({ start: 'FRA', end: 'POL', closed: ['FRA'] })).toMatch(/cannot also be/)
    })

    it('will not use a country nothing reaches', () => {
      // Fiji, New Zealand, the Solomons and Vanuatu have neither a land border
      // nor a crossing, and autocomplete will happily offer them.
      for (const stranded of ['FJI', 'NZL', 'SLB', 'VUT']) {
        expect(failure({ start: stranded, end: 'FRA' }), stranded).toMatch(/no route/)
      }
    })

    it('will not accept closures that leave no way through', () => {
      // Lesotho touches only South Africa.
      expect(failure({ start: 'LSO', end: 'NGA', closed: ['ZAF'] })).toMatch(/no way through/)
    })

    it('will not pair two neighbours, which leaves nothing to place', () => {
      expect(failure({ start: 'FRA', end: 'DEU' })).toMatch(/already touch/)
    })
  })
})

describe('assign', () => {
  const EMPTY: Draft = EMPTY_DRAFT
  const ROUND: Draft = { ...EMPTY_DRAFT, start: 'FRA', end: 'POL' }

  it('fills the field it is given', () => {
    expect(assign(EMPTY, 'start', 'FRA')).toEqual({
      ...EMPTY_DRAFT,
      start: 'FRA',
      end: null,
      closed: [],
    })
    expect(assign(EMPTY, 'end', 'POL')).toEqual({
      ...EMPTY_DRAFT,
      start: null,
      end: 'POL',
      closed: [],
    })
    expect(assign(EMPTY, 'closed', 'DEU')).toEqual({
      ...EMPTY_DRAFT,
      start: null,
      end: null,
      closed: ['DEU'],
    })
  })

  it('clears a field when the country already in it is picked again', () => {
    // The only way to empty a field from the globe: there is no shape to tap
    // that means "nothing".
    expect(assign(ROUND, 'start', 'FRA').start).toBeNull()
    expect(assign(ROUND, 'end', 'POL').end).toBeNull()
  })

  it('toggles a closure off', () => {
    const shut = assign(ROUND, 'closed', 'DEU')
    expect(assign(shut, 'closed', 'DEU').closed).toEqual([])
  })

  it('keeps closures in the order they were shut', () => {
    const both = assign(assign(ROUND, 'closed', 'DEU'), 'closed', 'CZE')
    expect(both.closed).toEqual(['DEU', 'CZE'])
  })

  it('takes a closed country away from the closures to make it an endpoint', () => {
    // `buildPuzzle` refuses a country that is both, and the player asked for
    // the endpoint, not for an error.
    const shut = assign(ROUND, 'closed', 'DEU')
    expect(assign(shut, 'end', 'DEU')).toEqual({
      ...EMPTY_DRAFT,
      start: 'FRA',
      end: 'DEU',
      closed: [],
    })
  })

  it('refuses to close an endpoint', () => {
    expect(assign(ROUND, 'closed', 'FRA')).toBe(ROUND)
    expect(assign(ROUND, 'closed', 'POL')).toBe(ROUND)
  })

  it('empties the other end rather than start and finish in one place', () => {
    expect(assign(ROUND, 'start', 'POL')).toEqual({
      ...EMPTY_DRAFT,
      start: 'POL',
      end: null,
      closed: [],
    })
    expect(assign(ROUND, 'end', 'FRA')).toEqual({
      ...EMPTY_DRAFT,
      start: null,
      end: 'FRA',
      closed: [],
    })
  })

  it('never builds a draft only the pick made impossible', () => {
    // The three ways a single pick could contradict the draft it lands in, run
    // against the module that would have to report them.
    const shut = assign(ROUND, 'closed', 'DEU')
    for (const [slot, code] of [
      ['start', 'POL'],
      ['end', 'FRA'],
      ['start', 'DEU'],
      ['end', 'DEU'],
    ] as const) {
      const next = assign(shut, slot, code)
      expect(next.start === null || next.start !== next.end, `${slot} ${code}`).toBe(true)
      for (const one of next.closed) {
        expect(one === next.start || one === next.end, `${slot} ${code}`).toBe(false)
      }
    }
  })
})

describe('isEmptyDraft', () => {
  it('is what a fresh draft is', () => {
    expect(isEmptyDraft(EMPTY_DRAFT)).toBe(true)
  })

  it('is false once any one field has something in it', () => {
    // Each on its own, because the button this answers for is disabled unless
    // *something* is there to take away, and a barrier alone is something.
    const filledOne: Partial<Draft>[] = [
      { start: 'FRA' },
      { end: 'POL' },
      { closed: ['DEU'] },
      { rough: ['ITA'] },
      { required: ['GRC'] },
      { fairway: ['DEU'] },
    ]
    for (const filled of filledOne) {
      const draft: Draft = { ...EMPTY_DRAFT, ...filled }
      expect(isEmptyDraft(draft), JSON.stringify(filled)).toBe(false)
    }
  })

  it('is true again after everything is taken back off', () => {
    const round = assign(assign(EMPTY_DRAFT, 'start', 'FRA'), 'closed', 'DEU')
    expect(isEmptyDraft(round)).toBe(false)
    expect(isEmptyDraft(assign(assign(round, 'start', 'FRA'), 'closed', 'DEU'))).toBe(true)
  })
})

describe('a painted fairway', () => {
  const painted: Draft = { ...EMPTY_DRAFT, start: 'FRA', end: 'POL', fairway: ['DEU'] }

  it('derives one band out, and shuts everything further', () => {
    const { rough, closed } = deriveFairway('FRA', 'POL', ['DEU'])
    const course = new Set(['FRA', 'POL', 'DEU'])
    // A partition: every country is course, band or shut, and nothing twice.
    expect(rough.length + closed.length + course.size).toBe(CODES.length)
    for (const code of rough) {
      expect(course.has(code), `${code} is both course and band`).toBe(false)
      expect(
        links(code).some((other) => course.has(other)),
        `${code} is in the band without touching the course`,
      ).toBe(true)
    }
    for (const code of closed) {
      expect(
        links(code).some((other) => course.has(other)),
        `${code} touches the course but was shut`,
      ).toBe(false)
    }
    // Canonical order, because the share invariant is deep equality over the
    // rebuilt puzzle and every closed list a fairway produces is sorted.
    expect(rough).toEqual([...rough].sort())
    expect(closed).toEqual([...closed].sort())
  })

  it('compiles to the derived course, and builds a playable round', () => {
    const recipe = recipeOfDraft(painted)!
    expect(recipe).toEqual({
      start: 'FRA',
      end: 'POL',
      ...deriveFairway('FRA', 'POL', ['DEU']),
      required: [],
    })
    const puzzle = built(recipe)
    expect(puzzle.best).toBe(1)
  })

  it('retires the hand-picked hazards the moment the first corridor country goes down', () => {
    // Not merged and not silently ignored: once there is a fairway the closed
    // and rough lists are derived from it, and a chip that no longer means
    // anything is worse than one that visibly went.
    const hand = assign(
      assign({ ...EMPTY_DRAFT, start: 'FRA', end: 'POL' }, 'closed', 'DEU'),
      'rough',
      'CZE',
    )
    const course = assign(hand, 'fairway', 'AUT')
    expect(course.closed).toEqual([])
    expect(course.rough).toEqual([])
    expect(course.fairway).toEqual(['AUT'])
  })

  it('keeps a corridor country out of every other set', () => {
    const draft = assign(assign(painted, 'fairway', 'CZE'), 'required', 'CZE')
    expect(draft.fairway).toEqual(['DEU'])
    expect(draft.required).toEqual(['CZE'])
  })

  it('refuses a corridor that never reaches the far end, legibly', () => {
    // A course painted nowhere near the route: the band around the two ends
    // cannot bridge the gap, so the derived closures cut every route — and the
    // builder says so in the closure's own words rather than throwing.
    const recipe = recipeOfDraft({ ...EMPTY_DRAFT, start: 'FRA', end: 'CHN', fairway: ['PRT'] })!
    expect(failure(recipe)).toBe('Those closures leave no way through.')
  })

  it('holds the waypoint open, so a course with a dogleg is buildable at all', () => {
    // The combination the panel offers and the classifier keeps a pill for: a
    // waypoint is an ask on top of the course, not part of its shape. The carve
    // used to swallow it — every country off the corridor became band or shut,
    // and the rules refuse a waypoint in either — so *every* fairway-with-a-via
    // draft came back an error, whichever country was chosen.
    const draft: Draft = { ...painted, required: ['HUN'] }
    const recipe = recipeOfDraft(draft)!
    expect(recipe.closed).not.toContain('HUN')
    expect(recipe.rough).not.toContain('HUN')
    expect(built(recipe).required).toEqual(['HUN'])
  })

  it('bands the waypoint like any other course country', () => {
    // Held open is not held apart: the ground around it becomes rough the same
    // way the ground around the corridor does, so a via off to one side is
    // reachable through its own band rather than marooned in the shut world.
    const { rough, closed } = deriveFairway('FRA', 'POL', ['DEU'], ['ESP'])
    expect(rough).toContain('PRT')
    expect(closed).not.toContain('PRT')
    expect(rough).not.toContain('ESP')
    expect(closed).not.toContain('ESP')
  })

  it('refuses a pick aimed at the derived fields rather than dropping it', () => {
    // The panel takes both fields away while a corridor is down, but the mark
    // can still be sitting on one — App advances it to `closed` after the
    // second endpoint. Kept, the pick would land in a list `recipeOfDraft`
    // discards: a tap with no chip and no reason.
    expect(assign(painted, 'closed', 'ITA')).toBe(painted)
    expect(assign(painted, 'rough', 'ITA')).toBe(painted)
    // The two fields that are still the player's while a course is painted.
    expect(assign(painted, 'required', 'ITA').required).toEqual(['ITA'])
    expect(assign(painted, 'fairway', 'ITA').fairway).toEqual(['DEU', 'ITA'])
  })
})

describe('draftOf', () => {
  /**
   * The invariant that matters when a round is reopened in the builder: what
   * comes back describes the *same round*. Whether the corridor is recovered or
   * the lists are kept as they are, `recipeOfDraft` has to name what arrived —
   * a draft that compiled to an easier puzzle would be the builder quietly
   * handing over a different one, with the panel's own verdict agreeing.
   */
  function reopens(recipe: Recipe) {
    const draft = draftOf(recipe)
    expect(recipeOfDraft(draft), `${recipe.start}->${recipe.end}`).toEqual({
      start: recipe.start,
      end: recipe.end,
      closed: recipe.closed ?? [],
      rough: recipe.rough ?? [],
      required: recipe.required ?? [],
    })
    return draft
  }

  it('brings a painted course back as the corridor that painted it', () => {
    // The one chip the player put down, rather than the ~145 it compiled to.
    // A wall of anonymous chips is not an editable round: removing any single
    // one breaks the carve, and nothing in the panel says which one matters.
    const painted: Draft = { ...EMPTY_DRAFT, start: 'FRA', end: 'POL', fairway: ['DEU'] }
    const draft = reopens(recipeOfDraft(painted)!)
    expect(draft.fairway).toEqual(['DEU'])
    expect(draft.closed).toEqual([])
    expect(draft.rough).toEqual([])
  })

  it('keeps the waypoint while recovering the corridor around it', () => {
    const painted: Draft = {
      ...EMPTY_DRAFT,
      start: 'FRA',
      end: 'POL',
      fairway: ['DEU'],
      required: ['HUN'],
    }
    const draft = reopens(recipeOfDraft(painted)!)
    expect(draft.fairway).toEqual(['DEU'])
    expect(draft.required).toEqual(['HUN'])
  })

  it('leaves an ordinary round exactly as it arrived', () => {
    const draft = reopens({ start: 'FRA', end: 'TUR', closed: ['ITA'], rough: ['AUT'] })
    expect(draft.fairway).toEqual([])
    expect(draft.closed).toEqual(['ITA'])
  })

  it('reopens every committed course as itself, corridor recovered or not', () => {
    // A generated course has been through the shortcut repair — band countries
    // the cheaper route rode are shut instead — so no corridor derives it, and
    // it comes back as its lists. That is the honest answer rather than a near
    // miss: the builder derives without the repair, deliberately, so a
    // recovered corridor here would recompile to a *rougher and easier* round
    // than the one that was shared.
    const courses = [...holes(POOL)].filter((filed) => filed.combo === 'fairway')
    expect(courses.length).toBeGreaterThan(0)
    for (const filed of courses.filter((_, at) => at % 97 === 0)) {
      reopens({
        start: filed.hole.start,
        end: filed.hole.end,
        closed: filed.hole.closed ?? [],
        rough: filed.hole.rough ?? [],
      })
    }
  })
})

describe('previewOf', () => {
  it('leaves a draft with no corridor exactly as it is', () => {
    const hand: Draft = { ...EMPTY_DRAFT, start: 'FRA', end: 'POL', closed: ['DEU'] }
    expect(previewOf(hand)).toBe(hand)
  })

  it('draws the carve from the first corridor tap, before either end is chosen', () => {
    // The corridor gets no colour of its own — open ground among the grey is
    // the whole statement — so until the grey is there, painting a country and
    // un-painting it look exactly like doing nothing at all.
    const shown = previewOf({ ...EMPTY_DRAFT, fairway: ['DEU'] })
    expect(shown.closed.length).toBeGreaterThan(FAIRWAY_LIMIT)
    expect(shown.rough).toContain('POL')
    expect(shown.fairway).toEqual(['DEU'])
  })

  it('shows what the round will play as, through the one derivation', () => {
    const draft: Draft = { ...EMPTY_DRAFT, start: 'FRA', end: 'POL', fairway: ['DEU'] }
    const recipe = recipeOfDraft(draft)!
    const shown = previewOf(draft)
    expect(shown.closed).toEqual(recipe.closed)
    expect(shown.rough).toEqual(recipe.rough)
  })
})

describe('recipeOfPuzzle', () => {
  /**
   * The property the share card needed and did not have: a built round names
   * the same link as the recipe it was built from. Written against every
   * barrier and every combination of them, because what went wrong was a
   * hand-copied field list that named three of the five — so a test naming one
   * barrier would have gone on passing.
   */
  it('names the same link as the recipe the round was built from', () => {
    const recipes: Recipe[] = [
      { start: 'FRA', end: 'TUR' },
      { start: 'FRA', end: 'TUR', closed: ['DEU'] },
      { start: 'FRA', end: 'TUR', rough: ['DEU', 'CHE'] },
      { start: 'FRA', end: 'TUR', required: ['SVK'] },
      { start: 'FRA', end: 'TUR', closed: ['DEU'], rough: ['ITA', 'AUT'] },
      { start: 'FRA', end: 'TUR', closed: ['DEU'], required: ['SVK'] },
      { start: 'FRA', end: 'TUR', rough: ['DEU', 'CHE'], required: ['SVK'] },
      { start: 'FRA', end: 'TUR', closed: ['ITA'], rough: ['DEU', 'CHE'], required: ['SVK'] },
    ]
    for (const recipe of recipes) {
      const puzzle = built(recipe)
      expect(entryQuery(recipeOfPuzzle(puzzle)), JSON.stringify(recipe)).toBe(entryQuery(recipe))
    }
  })

  it('keeps a round with no barriers on the short form', () => {
    // A `Puzzle` omits an empty barrier rather than carrying `[]`, and this is
    // what that discipline buys: passing all five fields through cannot push a
    // plain round onto the tagged form and lengthen every link ever shared.
    expect(entryQuery(recipeOfPuzzle(built({ start: 'SRB', end: 'LTU' })))).toBe('?g=h1o')
  })
})

describe('one waypoint, and only one', () => {
  const ROUND: Draft = { ...EMPTY_DRAFT, start: 'FRA', end: 'POL' }

  it('replaces the waypoint rather than collecting them', () => {
    // Closures and rough accumulate; this cannot. Left to accumulate, a second
    // tap on the globe would build a draft that can only come back as an error,
    // which is a builder arguing with itself.
    const first = assign(ROUND, 'required', 'HUN')
    expect(first.required).toEqual(['HUN'])
    expect(assign(first, 'required', 'AUT').required).toEqual(['AUT'])
  })

  it('still clears on a second tap of the same country', () => {
    const picked = assign(ROUND, 'required', 'HUN')
    expect(assign(picked, 'required', 'HUN').required).toEqual([])
  })

  it('refuses to build a round sent through two countries', () => {
    const result = buildPuzzle({ start: 'FRA', end: 'POL', required: ['HUN', 'ITA'] })
    expect('error' in result && result.error).toMatch(/only be sent through one country/)
  })

  it('refuses a waypoint with only one way in and out', () => {
    // Portugal holds a single link, so the way in is also the only way out.
    const result = buildPuzzle({ start: 'FRA', end: 'POL', required: ['PRT'] })
    expect('error' in result && result.error).toMatch(/without doubling back/)
  })

  it('prices a waypoint as the route through it, not the board that reaches it', () => {
    // France to Poland is Germany alone. Sent through Hungary it is France,
    // Germany, Austria, Hungary, Slovakia, Poland — four countries, not one.
    const result = buildPuzzle({ start: 'FRA', end: 'POL', required: ['HUN'] })
    if ('error' in result) throw new Error(result.error)
    expect(result.puzzle.best).toBe(4)
  })
})

describe('randomRecipe', () => {
  it('always builds into a playable puzzle', () => {
    const random = sequence(7)
    for (let round = 0; round < 60; round++) {
      const recipe = randomRecipe({ random })
      const result = buildPuzzle(recipe)
      expect('puzzle' in result, `${recipe.start}->${recipe.end}`).toBe(true)
    }
  })

  it('stays inside the range the daily is drawn from', () => {
    const random = sequence(11)
    for (let round = 0; round < 40; round++) {
      const puzzle = built(randomRecipe({ random }))
      expect(puzzle.best).toBeGreaterThanOrEqual(3)
      expect(puzzle.best).toBeLessThanOrEqual(10)
    }
  })

  it('repeats exactly, given the same source of randomness', () => {
    expect(randomRecipe({ random: sequence(3) })).toEqual(randomRecipe({ random: sequence(3) }))
  })

  it('gives a route that really crosses water when asked', () => {
    const random = sequence(5)
    for (let round = 0; round < 30; round++) {
      const { start, end } = randomRecipe({ crossing: true, random })
      const route = shortestPath(start, end)!
      const legs = route.slice(1).filter((code, index) => isSea(route[index], code))
      expect(legs.length, `${start}->${end}`).toBeGreaterThan(0)
    }
  })
})

describe('free play and the daily agree', () => {
  it('reaches the same route length and par as the pool, for real puzzles', () => {
    // If these ever diverge, one of them is lying about what a perfect round
    // scores — and the pool is what the daily's par is built from.
    // Sampled across every combination, so the rough and the waypoints are
    // covered too: `buildPuzzle` reaches `best` through `steiner` and the pool
    // reaches it through the build script's own table, and those are two
    // different pieces of code arriving at the same number.
    const sample = [...holes(POOL)].filter((_, index) => index % 397 === 0)
    for (const { combo, hole } of sample) {
      const { start, end, best, closed, rough, required } = hole
      const puzzle = built({ start, end, closed, rough, required })
      expect(puzzle.best, `${combo} ${start}->${end}`).toBe(best)
      expect(puzzle.par, `${combo} ${start}->${end}`).toBe(parFor(best, difficultyOf(best)))
    }
  })

  it('knows every country the graph does', () => {
    // Autocomplete offers all of them, so every one has to either build or
    // refuse legibly rather than throwing.
    for (const code of CODES) {
      expect(() => buildPuzzle({ start: code, end: 'FRA' }), code).not.toThrow()
    }
  })
})
