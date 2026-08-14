import { describe, expect, it } from 'vitest'
import { attemptReveal, newGame, place, type GameState, type Puzzle } from './rules'
import { ROUGH_COST, distance, routeVia, shortestPath, without } from './graph'
import { buildPuzzle, type Recipe } from './freeplay'
import {
  MISS_DIVISOR,
  REVEAL_COST,
  formatDelta,
  histogram,
  rowFor,
  scorecard,
  shareGrid,
  term,
  verdict,
} from './score'

// One shot in hand: the shortest route is a single country, par is two.
const FRA_POL: Puzzle = { id: 2, date: '2026-01-02', start: 'FRA', end: 'POL', best: 1, par: 2 }

function stateWith(partial: Partial<GameState>): GameState {
  return { ...newGame(FRA_POL), ...partial }
}

describe('scorecard', () => {
  it('is zero on an untouched board', () => {
    const card = scorecard(newGame(FRA_POL))
    expect(card.score).toBe(0)
    expect(card.delta).toBe(-2)
  })

  it('counts one per country placed', () => {
    const state = ['BEL', 'NLD'].reduce((s, c) => place(s, c).state, newGame(FRA_POL))
    expect(scorecard(state).countries).toBe(2)
    expect(scorecard(state).score).toBe(2)
  })

  it('goes under par on a perfect solve, which is the point of the allowance', () => {
    const card = scorecard(place(newGame(FRA_POL), 'DEU').state)
    expect(card.score).toBe(1)
    expect(card.delta).toBe(-1)
    expect(card.waste).toBe(0)
    expect(formatDelta(card.delta)).toBe('-1')
  })

  it('separates beating par from wasting nothing', () => {
    // One miss is free, so this round wasted nothing and still beat par — the
    // two questions the old single `delta` could not tell apart.
    const card = scorecard(stateWith({ placed: ['DEU'], misses: ['ESP'] }))
    expect(card.waste).toBe(0)
    expect(card.delta).toBe(-1)
    expect(card.misses).toBe(1)
  })

  it('charges one per two misses, rounding down', () => {
    for (const [misses, penalty] of [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 2],
      [5, 2],
      [7, 3],
    ]) {
      const card = scorecard(stateWith({ misses: Array(misses).fill('ESP') }))
      expect(card.missPenalty, `${misses} misses`).toBe(penalty)
    }
  })

  it('leaves a single miss free, so a first wrong guess costs nothing', () => {
    expect(scorecard(stateWith({ misses: ['ESP'] })).score).toBe(0)
  })

  it('charges the full cost per reveal', () => {
    const card = scorecard(stateWith({ revealed: ['DEU', 'ESP', 'ITA'] }))
    expect(card.revealPenalty).toBe(3 * REVEAL_COST)
  })

  it('adds up countries, misses and reveals', () => {
    const card = scorecard(
      stateWith({
        placed: ['DEU'],
        revealed: ['ESP', 'ITA'],
        misses: ['GBR', 'PRT', 'MAR'],
      }),
    )
    expect(card.countries).toBe(1)
    expect(card.revealPenalty).toBe(2)
    expect(card.missPenalty).toBe(1)
    expect(card.score).toBe(4)
    expect(card.delta).toBe(2)
    expect(card.waste).toBe(3)
    expect(formatDelta(card.delta)).toBe('+2')
  })

  it('charges a failed reveal twice — once for the name, once for the miss', () => {
    // Two failed reveals: 2 reveals and 2 misses, so 2 + 1.
    let state = newGame(FRA_POL)
    for (const code of ['MAR', 'DZA']) state = attemptReveal(state, code).state
    const card = scorecard(state)
    expect(card.reveals).toBe(2)
    expect(card.misses).toBe(2)
    expect(card.score).toBe(3)
  })

  it('charges a successful reveal once for the name and once for the country', () => {
    const state = attemptReveal(newGame(FRA_POL), 'DEU').state
    const card = scorecard(state)
    expect(card.countries).toBe(1)
    expect(card.reveals).toBe(1)
    expect(card.misses).toBe(0)
    expect(card.score).toBe(2)
    // Buying the one country you needed spends the whole allowance: level par,
    // where typing it would have been a birdie.
    expect(card.delta).toBe(0)
  })

  it('exposes its tuning knobs, since both are expected to move', () => {
    expect(MISS_DIVISOR).toBe(2)
    expect(REVEAL_COST).toBe(1)
  })

  it('scores a round the same however often the board is read back to it', () => {
    // Naming what is already on the board — a placed country, or either end —
    // used to be a miss, so two of them quietly cost a stroke.
    const clean = newGame(FRA_POL)
    let noisy = clean
    for (const code of ['FRA', 'POL', 'FRA', 'POL']) noisy = place(noisy, code).state
    expect(scorecard(noisy)).toEqual(scorecard(clean))

    const played = place(clean, 'DEU').state
    let again = played
    for (const code of ['DEU', 'FRA', 'DEU']) again = place(again, code).state
    expect(scorecard(again)).toEqual(scorecard(played))
  })

  // The two ways to play the identical perfect route. Buying every name costs
  // exactly twice the shortest route, which is easy to hit by accident and reads
  // as a scoring bug — hence the hold-to-buy gesture and the one-time notice.
  describe('the same route, played two ways', () => {
    // A hard day: two shots in hand, so a flawless round is an eagle.
    const LTU_BEN = { id: 1, date: '2026-08-09', start: 'LTU', end: 'BEN', best: 7, par: 9 }
    const ROUTE = ['POL', 'DEU', 'FRA', 'ESP', 'MAR', 'DZA', 'NER']

    it('scores an eagle when every country is typed from memory', () => {
      const state = ROUTE.reduce((s, c) => place(s, c).state, newGame(LTU_BEN))
      const card = scorecard(state)
      expect(state.status).toBe('won')
      expect(card.countries).toBe(7)
      expect(card.reveals).toBe(0)
      expect(card.score).toBe(7)
      expect(card.delta).toBe(-2)
      expect(card.waste).toBe(0)
      expect(term(card.delta)).toBe('Eagle')
    })

    it('scores twice the route when every country is bought off the globe', () => {
      const state = ROUTE.reduce((s, c) => attemptReveal(s, c).state, newGame(LTU_BEN))
      const card = scorecard(state)
      expect(state.status).toBe('won')
      expect(card.countries).toBe(7)
      expect(card.reveals).toBe(7)
      expect(card.misses).toBe(0)
      expect(card.score).toBe(14)
      expect(card.delta).toBe(5)
    })

    it('charges only for the names actually bought, on a mixed round', () => {
      let state = newGame(LTU_BEN)
      for (const [index, code] of ROUTE.entries()) {
        state = (index < 2 ? attemptReveal(state, code) : place(state, code)).state
      }
      const card = scorecard(state)
      expect(card.reveals).toBe(2)
      expect(card.score).toBe(9)
      expect(card.delta).toBe(0)
    })
  })
})

describe('verdict', () => {
  // Real countries, since scoring now looks a placement up to see whether it
  // arrived by sea. None of these has a crossing, so they only ever cost one.
  const FILLER = ['DEU', 'BEL', 'NLD', 'CHE', 'AUT', 'CZE', 'ITA', 'ESP']
  const card = (over: number, misses = 0) =>
    scorecard(
      stateWith({
        placed: FILLER.slice(0, 1 + over),
        misses: Array(misses).fill('ESP'),
      }),
    )

  it('names par even when the round beat it', () => {
    // The old copy hid par on a perfect round — exactly when you want to see it.
    expect(verdict(card(0))).toContain('Par is 2.')
  })

  it('names par when the round missed it', () => {
    expect(verdict(card(3))).toContain('Par is 2.')
  })

  it('calls a clean round that wasted nothing perfect', () => {
    expect(verdict(card(0))).toContain('nothing wasted')
    expect(verdict(card(0))).toContain('Birdie')
  })

  it('does not claim nothing was wasted when a miss was', () => {
    // One miss carries no penalty, so this round wasted nothing on the score and
    // still has a miss on the card beneath it. Saying "nothing wasted" would
    // contradict it.
    const withMiss = card(0, 1)
    expect(withMiss.waste).toBe(0)
    expect(withMiss.misses).toBe(1)
    expect(verdict(withMiss)).not.toContain('nothing wasted')
    expect(verdict(withMiss)).toContain('miss was free')
  })

  it('never calls a round perfect once something was wasted', () => {
    // The invariant the old copy got wrong: with an allowance, a round can now
    // be level par and still have wasted a shot getting there.
    const level = card(1)
    expect(level.delta).toBe(0)
    expect(level.waste).toBe(1)
    expect(verdict(level)).not.toContain('nothing wasted')
    expect(verdict(level)).not.toContain('miss was free')
  })

  it('always names par, whatever the round', () => {
    for (const over of [0, 1, 5]) {
      for (const misses of [0, 1, 4]) {
        expect(verdict(card(over, misses))).toContain('Par is 2.')
      }
    }
  })
})

describe('term', () => {
  it('uses the names golfers use', () => {
    expect(term(-2)).toBe('Eagle')
    expect(term(-1)).toBe('Birdie')
    expect(term(0)).toBe('Level par')
    expect(term(1)).toBe('Bogey')
    expect(term(2)).toBe('Double bogey')
  })

  it('stops naming rounds past the point anyone would', () => {
    expect(term(4)).toBe('')
    expect(term(11)).toBe('')
  })
})

describe('histogram', () => {
  it('has a fixed set of rows, so the shape does not move as you play', () => {
    expect(histogram({}).map((r) => r.label)).toEqual([
      '-2',
      '-1',
      'E',
      '+1',
      '+2',
      '+3',
      '+4',
      '5+',
    ])
    expect(histogram({ '0': 9, '3': 2 }).map((r) => r.label)).toEqual(
      histogram({}).map((r) => r.label),
    )
  })

  it('gives the sub-par rounds rows of their own', () => {
    const rows = histogram({ '-2': 3, '-1': 2 })
    expect(rows[0].count).toBe(3)
    expect(rows[1].count).toBe(2)
  })

  it('counts each round against its own delta', () => {
    const rows = histogram({ '0': 4, '2': 1 })
    expect(rows[2].count).toBe(4)
    expect(rows[4].count).toBe(1)
    expect(rows[3].count).toBe(0)
  })

  it('gathers everything past the last row into the tail', () => {
    const rows = histogram({ '5': 1, '9': 2, '14': 3 })
    expect(rows.at(-1)).toMatchObject({ label: '5+', count: 6, delta: null })
  })

  it('loses no rounds, however they are spread', () => {
    const distribution = { '-2': 1, '-1': 2, '0': 3, '4': 1, '5': 2, '20': 4 }
    const total = histogram(distribution).reduce((n, row) => n + row.count, 0)
    expect(total).toBe(13)
  })

  it('survives corrupt keys rather than rendering NaN bars', () => {
    const rows = histogram({ nonsense: 3, '1': 2 })
    expect(rows[3].count).toBe(2)
    expect(rows.every((row) => Number.isFinite(row.count))).toBe(true)
  })

  it('folds a round below the floor into the best row rather than dropping it', () => {
    // Only reachable by raising an allowance or by corrupt data, but losing a
    // round silently is worse than putting it in the nearest row.
    expect(histogram({ '-9': 1 })[0].count).toBe(1)
  })
})

describe('rowFor', () => {
  it('puts a round in its own row', () => {
    expect(rowFor(-2)).toBe(0)
    expect(rowFor(-1)).toBe(1)
    expect(rowFor(0)).toBe(2)
    expect(rowFor(4)).toBe(6)
  })

  it('puts anything past the last row in the tail', () => {
    expect(rowFor(5)).toBe(7)
    expect(rowFor(30)).toBe(7)
  })

  it('puts anything below the floor in the first row', () => {
    expect(rowFor(-9)).toBe(0)
  })

  it('lands inside the rows the histogram actually draws', () => {
    for (const delta of [-9, -2, 0, 3, 6, 40]) {
      expect(histogram({})[rowFor(delta)]).toBeDefined()
    }
  })
})

describe('formatDelta', () => {
  it('uses golf notation', () => {
    expect(formatDelta(0)).toBe('E')
    expect(formatDelta(1)).toBe('+1')
    expect(formatDelta(12)).toBe('+12')
  })

  it('writes a round that beat par as a negative', () => {
    expect(formatDelta(-1)).toBe('-1')
    expect(formatDelta(-2)).toBe('-2')
  })
})

describe('shareGrid', () => {
  it('is empty while the game is unfinished', () => {
    expect(shareGrid(newGame(FRA_POL))).toBe('')
  })

  it('is one green square per country on the route', () => {
    expect(shareGrid(place(newGame(FRA_POL), 'DEU').state)).toBe('🟩')
  })

  it('adds a yellow square for each country the route did not need', () => {
    const state = ['BEL', 'NLD', 'DEU'].reduce((s, c) => place(s, c).state, newGame(FRA_POL))
    expect(shareGrid(state)).toBe('🟩🟨🟨')
  })

  it('never leaks which countries were used', () => {
    const state = ['BEL', 'NLD', 'DEU'].reduce((s, c) => place(s, c).state, newGame(FRA_POL))
    expect(shareGrid(state)).toMatch(/^[🟩🟨]*$/u)
  })

  it('has one square per country the player placed', () => {
    const state = ['BEL', 'NLD', 'DEU'].reduce((s, c) => place(s, c).state, newGame(FRA_POL))
    expect([...shareGrid(state)]).toHaveLength(state.placed.length)
  })
})

describe('what a crossing costs', () => {
  const CHN_JPN = { id: 5, date: '2026-01-05', start: 'CHN', end: 'JPN', best: 3, par: 4 }
  const MEX_JAM = { id: 6, date: '2026-01-06', start: 'MEX', end: 'JAM', best: 3, par: 4 }
  const run = (puzzle: Puzzle, codes: string[]) =>
    scorecard(codes.reduce((state, code) => place(state, code).state, newGame(puzzle)))

  it('adds a shot for the water on top of the country', () => {
    const card = run(CHN_JPN, ['PRK', 'KOR'])
    expect(card.countries).toBe(2)
    expect(card.crossings).toBe(1)
    expect(card.crossingPenalty).toBe(1)
    expect(card.score).toBe(3)
  })

  it('makes a flawless crossing round score exactly the shortest route', () => {
    // The identity the pool is built on: score is the route's cost minus one,
    // so a perfect round lands on `best` whether or not it went by sea.
    expect(run(CHN_JPN, ['PRK', 'KOR']).score).toBe(CHN_JPN.best)
    expect(run(MEX_JAM, ['CUB']).score).toBe(MEX_JAM.best)
  })

  it('charges twice when the route crosses water twice', () => {
    const card = run(MEX_JAM, ['CUB'])
    expect(card.countries).toBe(1)
    expect(card.crossings).toBe(2)
    expect(card.score).toBe(3)
    expect(card.delta).toBe(-1)
  })

  it('charges nothing extra on a round that never leaves land', () => {
    const card = run(FRA_POL, ['DEU'])
    expect(card.crossings).toBe(0)
    expect(card.crossingPenalty).toBe(0)
  })

  it('marks the water on the share grid, where it happened', () => {
    const won = (puzzle: Puzzle, codes: string[]) =>
      codes.reduce((state, code) => place(state, code).state, newGame(puzzle))
    expect(shareGrid(won(CHN_JPN, ['PRK', 'KOR']))).toBe('🟩🟩🟦')
    expect(shareGrid(won(MEX_JAM, ['CUB']))).toBe('🟦🟩🟦')
  })
})

describe('the rough, and the identity it has to keep', () => {
  /**
   * Play the cheapest line and nothing else — no misses, no reveals, no
   * detours. That is what `best` claims a round can be done in, so the score at
   * the end of it must be exactly `best`.
   *
   * Stated as a number rather than as a comment, because it is the one thing
   * the whole scoring apparatus rests on and every mechanic added since has had
   * to preserve it: countries, then crossings at a premium, now ground at a
   * premium too.
   */
  function playPerfectly(recipe: Recipe): { card: ReturnType<typeof scorecard>; puzzle: Puzzle } {
    const built = buildPuzzle(recipe)
    if ('error' in built) throw new Error(built.error)
    const puzzle = built.puzzle

    const route = shortestPath(
      puzzle.start,
      puzzle.end,
      puzzle.closed?.length ? without(puzzle.closed) : undefined,
      puzzle.rough?.length ? new Set(puzzle.rough) : undefined,
    )!
    let state = newGame(puzzle)
    // Everything but the two ends, in route order.
    for (const code of route.slice(1, -1)) state = place(state, code).state
    return { card: scorecard(state), puzzle }
  }

  const THROUGH_THE_ALPS: Recipe = {
    start: 'FRA',
    end: 'HUN',
    rough: ['CHE', 'AUT', 'ITA', 'SVN'],
  }

  it('scores a flawless rough round at exactly best', () => {
    const { card, puzzle } = playPerfectly(THROUGH_THE_ALPS)
    expect(card.score).toBe(puzzle.best)
    expect(card.waste).toBe(0)
  })

  it('charges one extra for each rough country placed', () => {
    const { card } = playPerfectly(THROUGH_THE_ALPS)
    expect(card.roughPenalty).toBe(card.rough * (ROUGH_COST - 1))
    expect(card.score).toBe(card.countries + card.crossingPenalty + card.roughPenalty)
  })

  it('makes the rough dearer than the same round on open ground', () => {
    const open = playPerfectly({ start: 'FRA', end: 'HUN' })
    const rough = playPerfectly(THROUGH_THE_ALPS)
    expect(rough.puzzle.best).toBeGreaterThan(open.puzzle.best)
  })

  it('charges a rough country that turned out to be a detour', () => {
    // The same bargain the rest of the scoring makes: you pay for what you put
    // on the board, not for what the route ends up using.
    const built = buildPuzzle(THROUGH_THE_ALPS)
    if ('error' in built) throw new Error(built.error)
    let state = newGame(built.puzzle)
    state = place(state, 'ITA').state
    expect(scorecard(state).rough).toBe(1)
    expect(scorecard(state).roughPenalty).toBe(ROUGH_COST - 1)
  })

  it('leaves a round with no rough scoring exactly as it did', () => {
    const card = playPerfectly({ start: 'FRA', end: 'POL' }).card
    expect(card.rough).toBe(0)
    expect(card.roughPenalty).toBe(0)
  })

  it('marks the rough on the share card without naming it', () => {
    const { card } = playPerfectly(THROUGH_THE_ALPS)
    const built = buildPuzzle(THROUGH_THE_ALPS)
    if ('error' in built) throw new Error(built.error)
    const route = shortestPath('FRA', 'HUN', undefined, new Set(THROUGH_THE_ALPS.rough))!
    let state = newGame(built.puzzle)
    for (const code of route.slice(1, -1)) state = place(state, code).state
    const grid = shareGrid(state)
    expect(grid).toContain('🟫')
    expect(card.rough).toBeGreaterThan(0)
  })
})

describe('the dogleg, and the identity it has to keep', () => {
  /**
   * The cheapest board that wins the hole: the route through the waypoint and
   * nothing else. Taken from `routeVia` rather than reconstructed, because the
   * route *is* the board now — which is the change. It used to be a tree, and
   * the board had to be assembled hub by hub from three shortest paths.
   */
  function perfectBoard(start: string, end: string, via: string): string[] {
    return routeVia(start, end, via)!.slice(1, -1)
  }

  /**
   * France to Poland via Afghanistan, which used to be the case that showed
   * what the Steiner tree was for: two shortest paths of 5 and 3 both running
   * through Russia and China, counted once by a tree and twice by a route.
   *
   * It is now the case that shows the opposite. A board cannot count them once,
   * because a route cannot use a country twice — so the floor really is the
   * dearer figure, and the tree was quietly promising a par that no legal board
   * could reach.
   */
  const VIA_AFGHANISTAN: Recipe = { start: 'FRA', end: 'POL', required: ['AFG'] }

  it('scores a flawless dogleg at exactly best', () => {
    const built = buildPuzzle(VIA_AFGHANISTAN)
    if ('error' in built) throw new Error(built.error)
    let state = newGame(built.puzzle)
    for (const code of perfectBoard('FRA', 'POL', 'AFG')) state = place(state, code).state

    expect(state.status).toBe('won')
    expect(scorecard(state).score).toBe(built.puzzle.best)
    expect(scorecard(state).waste).toBe(0)
  })

  it('puts no yellow square under a flawless dogleg, and one purple', () => {
    // Nothing is wasted on a board that is exactly the route, and the waypoint
    // gets the one purple square — where the bend was, never which country.
    const built = buildPuzzle(VIA_AFGHANISTAN)
    if ('error' in built) throw new Error(built.error)
    let state = newGame(built.puzzle)
    for (const code of perfectBoard('FRA', 'POL', 'AFG')) state = place(state, code).state

    const grid = shareGrid(state)
    expect(grid).not.toContain('🟨')
    expect([...grid].filter((square) => square === '🟪')).toHaveLength(1)
  })

  it('costs more than the same pair with nowhere to go via', () => {
    const plain = buildPuzzle({ start: 'FRA', end: 'POL' })
    const dogleg = buildPuzzle(VIA_AFGHANISTAN)
    if ('error' in plain || 'error' in dogleg) throw new Error('unbuildable')
    expect(dogleg.puzzle.best).toBeGreaterThan(plain.puzzle.best)
  })

  it('takes the cheapest route through the waypoint, never less', () => {
    // The inversion. Two shortest legs used to be an over-estimate of the floor
    // and is now a lower bound on it: France and Afghanistan and Poland is
    // exactly the pair where the legs overlap, so the real route costs more.
    const built = buildPuzzle(VIA_AFGHANISTAN)
    if ('error' in built) throw new Error(built.error)
    const bound = distance('FRA', 'AFG')! + distance('AFG', 'POL')! - 1
    expect(built.puzzle.best).toBeGreaterThanOrEqual(bound)
    expect(built.puzzle.best).toBeGreaterThan(bound)
  })

  it('refuses a waypoint no route can pass through', () => {
    const built = buildPuzzle({ start: 'FRA', end: 'POL', required: ['ISL'] })
    expect('error' in built && built.error).toMatch(/without doubling back/)
  })
})
