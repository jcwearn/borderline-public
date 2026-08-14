import { describe, expect, it } from 'vitest'
import { SEA_COST, distance, isSea, without } from './graph'
import { scorecard } from './score'
import {
  attemptReveal,
  closedIn,
  crossings,
  detours,
  inPlay,
  isClosed,
  isLegal,
  closuresAreFew,
  isNamed,
  isRequired,
  isRough,
  isWon,
  newGame,
  place,
  roughPlaced,
  sides,
  solutionPath,
  stepsFromBoard,
  validNextMoves,
  type GameState,
  type Puzzle,
} from './rules'

/** Nigeria -> South Korea, the puzzle from the video. Par 9. */
const NGA_KOR: Puzzle = { id: 1, date: '2026-01-01', start: 'NGA', end: 'KOR', best: 9, par: 11 }

/** France -> Poland via Germany. Par 1, so it takes a single move to win. */
const FRA_POL: Puzzle = { id: 2, date: '2026-01-02', start: 'FRA', end: 'POL', best: 1, par: 2 }

/** Play a run of countries, asserting nothing. */
function playAll(puzzle: Puzzle, codes: string[]): GameState {
  return codes.reduce((state, code) => place(state, code).state, newGame(puzzle))
}

describe('newGame', () => {
  it('starts empty and playing', () => {
    const state = newGame(NGA_KOR)
    expect(state.placed).toEqual([])
    expect(state.revealed).toEqual([])
    expect(state.misses).toEqual([])
    expect(state.status).toBe('playing')
  })

  it('refuses a puzzle with no route at all, which should never be generated', () => {
    // Fiji, New Zealand, the Solomons and Vanuatu are the only countries left
    // with neither a land border nor a curated crossing.
    expect(() => newGame({ ...NGA_KOR, start: 'FJI', end: 'FRA' })).toThrow(/unsolvable/)
    expect(() => newGame({ ...NGA_KOR, start: 'NZL', end: 'AUS' })).toThrow(/unsolvable/)
  })

  it('refuses a puzzle naming a country that does not exist', () => {
    expect(() => newGame({ ...NGA_KOR, start: 'ZZZ' })).toThrow(/unknown country/)
  })
})

describe('isLegal', () => {
  const fresh = newGame(NGA_KOR)

  it('accepts a neighbour of the start', () => {
    expect(isLegal(fresh, 'NER')).toBe(true)
    expect(isLegal(fresh, 'CMR')).toBe(true)
  })

  it('accepts a neighbour of the end, so you can build from either side', () => {
    expect(isLegal(fresh, 'PRK')).toBe(true)
  })

  it('rejects a country touching neither end', () => {
    expect(isLegal(fresh, 'FRA')).toBe(false)
    expect(isLegal(fresh, 'CHN')).toBe(false)
  })

  it('rejects the endpoints themselves', () => {
    expect(isLegal(fresh, 'NGA')).toBe(false)
    expect(isLegal(fresh, 'KOR')).toBe(false)
  })

  it('accepts an island reached by a crossing', () => {
    // Japan meets South Korea across the Tsushima Strait, and South Korea is an
    // endpoint, so this is legal from the opening move.
    expect(isLegal(fresh, 'JPN')).toBe(true)
  })

  it('still rejects an island nothing reaches', () => {
    expect(isLegal(fresh, 'FJI')).toBe(false)
  })

  it('rejects a country that is already placed', () => {
    const state = playAll(NGA_KOR, ['NER'])
    expect(isLegal(state, 'NER')).toBe(false)
  })

  it('accepts neighbours of a country the player just placed', () => {
    const state = playAll(NGA_KOR, ['NER'])
    expect(isLegal(state, 'DZA')).toBe(true)
    expect(isLegal(state, 'LBY')).toBe(true)
  })
})

describe('place', () => {
  it('puts a legal country on the board', () => {
    const result = place(newGame(NGA_KOR), 'NER')
    expect(result.placed).toBe(true)
    expect(result.miss).toBe(false)
    expect(result.reveal).toBe(false)
    expect(result.state.placed).toEqual(['NER'])
  })

  it('records an illegal country as a miss and leaves the board alone', () => {
    const result = place(newGame(NGA_KOR), 'FRA')
    expect(result.placed).toBe(false)
    expect(result.miss).toBe(true)
    expect(result.state.placed).toEqual([])
    expect(result.state.misses).toEqual(['FRA'])
    expect(result.reason).toBe('not-adjacent')
  })

  it('never charges a reveal, however the country was named', () => {
    expect(place(newGame(NGA_KOR), 'NER').state.revealed).toEqual([])
    expect(place(newGame(NGA_KOR), 'FRA').state.revealed).toEqual([])
  })

  it('counts repeat misses every time, so guessing blind stays costly', () => {
    let state = newGame(NGA_KOR)
    for (const code of ['FRA', 'FRA', 'FRA']) state = place(state, code).state
    expect(state.misses).toEqual(['FRA', 'FRA', 'FRA'])
  })

  it('explains why a country was refused', () => {
    const state = playAll(NGA_KOR, ['NER'])
    expect(place(state, 'NER').reason).toBe('already-in-play')
    expect(place(state, 'NGA').reason).toBe('already-in-play')
    expect(place(state, 'CHN').reason).toBe('not-adjacent')
    expect(place(state, 'FJI').reason).toBe('unreachable')
  })

  describe('a country already on the board', () => {
    it('is turned away without charging, the way a shut one is', () => {
      const state = playAll(NGA_KOR, ['NER'])
      const outcome = place(state, 'NER')
      expect(outcome.placed).toBe(false)
      expect(outcome.miss).toBe(false)
      expect(outcome.reveal).toBe(false)
      expect(outcome.reason).toBe('already-in-play')
      expect(outcome.state).toBe(state)
    })

    it('covers both endpoints, which were on the board from the first move', () => {
      const state = newGame(NGA_KOR)
      for (const code of ['NGA', 'KOR']) {
        const outcome = place(state, code)
        expect(outcome.miss, code).toBe(false)
        expect(outcome.reason, code).toBe('already-in-play')
        expect(outcome.state.misses, code).toEqual([])
      }
    })

    it('cannot be worn down into a stroke by naming it again', () => {
      let state = playAll(NGA_KOR, ['NER'])
      const before = scorecard(state).score
      for (let again = 0; again < 6; again++) state = place(state, 'NER').state
      for (let again = 0; again < 6; again++) state = place(state, 'NGA').state
      expect(state.misses).toEqual([])
      expect(state.placed).toEqual(['NER'])
      expect(scorecard(state).score).toBe(before)
    })

    it('is free off the globe too, since a named country goes through place', () => {
      const state = playAll(NGA_KOR, ['NER'])
      for (const code of ['NER', 'NGA', 'KOR']) {
        const outcome = attemptReveal(state, code)
        expect(outcome.miss, code).toBe(false)
        expect(outcome.reveal, code).toBe(false)
        expect(outcome.reason, code).toBe('already-in-play')
        expect(outcome.state, code).toBe(state)
      }
    })

    it('does not excuse a name that was bought and never played', () => {
      // The line this stops at. France is named — it cost a reveal and a miss —
      // but it is not on the board, so naming it again is a fresh claim about a
      // board that has grown since, and it still costs.
      const known = attemptReveal(newGame(NGA_KOR), 'FRA').state
      const outcome = place(place(known, 'NER').state, 'FRA')
      expect(outcome.miss).toBe(true)
      expect(outcome.reason).toBe('not-adjacent')
      expect(outcome.state.misses).toEqual(['FRA', 'FRA'])
    })
  })

  it('ignores further placements once the game is won', () => {
    const won = playAll(FRA_POL, ['DEU'])
    expect(won.status).toBe('won')
    const after = place(won, 'BEL')
    expect(after.state.placed).toEqual(['DEU'])
    expect(after.state.misses).toEqual([])
  })
})

describe('winning', () => {
  it('is won the moment the two sides touch', () => {
    const result = place(newGame(FRA_POL), 'DEU')
    expect(result.won).toBe(true)
    expect(result.state.status).toBe('won')
    expect(isWon(result.state)).toBe(true)
  })

  it('is not won while a gap remains', () => {
    const state = playAll(FRA_POL, ['BEL'])
    expect(isWon(state)).toBe(false)
    expect(state.status).toBe('playing')
  })

  it('joins up when a chain from each end finally meets in the middle', () => {
    // Build France -> Belgium -> Netherlands, and Poland -> Czechia, then close
    // the gap with Germany, which touches both sides at once.
    let state = playAll(FRA_POL, ['BEL', 'NLD', 'CZE'])
    expect(isWon(state)).toBe(false)
    state = place(state, 'DEU').state
    expect(isWon(state)).toBe(true)
  })

  it('solves the puzzle from the video at par', () => {
    const route = ['NER', 'DZA', 'MAR', 'ESP', 'FRA', 'DEU', 'POL', 'RUS', 'PRK']
    const state = playAll(NGA_KOR, route)
    expect(state.status).toBe('won')
    expect(state.placed).toHaveLength(NGA_KOR.best)
    expect(solutionPath(state)).toEqual(['NGA', ...route, 'KOR'])
  })
})

describe('solutionPath and detours', () => {
  it('has no path until the game is won', () => {
    expect(solutionPath(newGame(FRA_POL))).toBeNull()
    expect(solutionPath(playAll(FRA_POL, ['BEL']))).toBeNull()
  })

  it('reports the route actually built', () => {
    const state = playAll(FRA_POL, ['DEU'])
    expect(solutionPath(state)).toEqual(['FRA', 'DEU', 'POL'])
    expect(detours(state)).toEqual([])
  })

  it('separates the countries the route uses from the ones it does not', () => {
    const state = playAll(FRA_POL, ['BEL', 'NLD', 'DEU'])
    expect(state.status).toBe('won')
    expect(solutionPath(state)).toEqual(['FRA', 'DEU', 'POL'])
    expect(detours(state)).toEqual(['BEL', 'NLD'])
  })

  it('prefers a shortcut over a longer route when the board holds both', () => {
    // Built directly: in play, Czechia would have ended the game before Germany
    // was ever reached. Both FRA-CHE-AUT-CZE-POL and FRA-DEU-POL exist here.
    const state: GameState = {
      puzzle: FRA_POL,
      placed: ['CHE', 'AUT', 'CZE', 'DEU'],
      revealed: [],
      misses: [],
      status: 'won',
    }
    expect(solutionPath(state)).toEqual(['FRA', 'DEU', 'POL'])
    expect(detours(state)).toEqual(['CHE', 'AUT', 'CZE'])
  })

  it('ends the run the moment any route closes, even a roundabout one', () => {
    const state = playAll(FRA_POL, ['CHE', 'AUT', 'CZE', 'DEU'])
    expect(state.status).toBe('won')
    // Czechia borders Poland, so the run closed there and Germany never landed.
    expect(state.placed).toEqual(['CHE', 'AUT', 'CZE'])
    expect(solutionPath(state)).toEqual(['FRA', 'CHE', 'AUT', 'CZE', 'POL'])
  })
})

describe('sides', () => {
  it('has nothing on either side of an untouched board', () => {
    const { fromStart, fromEnd, floating } = sides(newGame(NGA_KOR))
    expect(fromStart).toEqual([])
    expect(fromEnd).toEqual([])
    expect(floating).toEqual([])
  })

  it('files a country under the endpoint it hangs off', () => {
    const state = playAll(NGA_KOR, ['NER', 'PRK'])
    const { fromStart, fromEnd } = sides(state)
    expect(fromStart).toEqual(['NER'])
    expect(fromEnd).toEqual(['PRK'])
  })

  it('orders each run outward from its endpoint, not by when it was played', () => {
    // Chad borders Nigeria and Algeria does not, so distance puts Chad second
    // even though it was placed last.
    const state = playAll(NGA_KOR, ['NER', 'DZA', 'TCD'])
    expect(state.placed).toEqual(['NER', 'DZA', 'TCD'])
    expect(sides(state).fromStart).toEqual(['NER', 'TCD', 'DZA'])
  })

  it('grows both runs independently', () => {
    const state = playAll(NGA_KOR, ['NER', 'PRK', 'DZA', 'CHN'])
    const { fromStart, fromEnd } = sides(state)
    expect(fromStart).toEqual(['NER', 'DZA'])
    expect(fromEnd).toEqual(['PRK', 'CHN'])
  })

  it('accounts for every placement exactly once', () => {
    const state = playAll(NGA_KOR, ['NER', 'PRK', 'DZA', 'CHN', 'TCD'])
    const { fromStart, fromEnd, floating } = sides(state)
    expect([...fromStart, ...fromEnd, ...floating].sort()).toEqual([...state.placed].sort())
  })

  it('credits a closing country to the start side, not both', () => {
    const state = playAll(FRA_POL, ['DEU'])
    const { fromStart, fromEnd } = sides(state)
    expect(fromStart).toEqual(['DEU'])
    expect(fromEnd).toEqual([])
  })
})

describe('isNamed', () => {
  it('names the two endpoints from the start', () => {
    const fresh = newGame(NGA_KOR)
    expect(isNamed(fresh, 'NGA')).toBe(true)
    expect(isNamed(fresh, 'KOR')).toBe(true)
  })

  it('hides everything else', () => {
    const fresh = newGame(NGA_KOR)
    expect(isNamed(fresh, 'NER')).toBe(false)
    expect(isNamed(fresh, 'FRA')).toBe(false)
  })

  it('names a country once it is placed', () => {
    expect(isNamed(playAll(NGA_KOR, ['NER']), 'NER')).toBe(true)
  })

  it('keeps a bought name even when the country never got placed', () => {
    const result = attemptReveal(newGame(NGA_KOR), 'FRA')
    expect(result.placed).toBe(false)
    expect(isNamed(result.state, 'FRA')).toBe(true)
  })
})

describe('attemptReveal', () => {
  it('unnamed and legal: charges the reveal and plays it', () => {
    const result = attemptReveal(newGame(NGA_KOR), 'NER')
    expect(result.reveal).toBe(true)
    expect(result.placed).toBe(true)
    expect(result.miss).toBe(false)
    expect(result.state.revealed).toEqual(['NER'])
    expect(result.state.placed).toEqual(['NER'])
  })

  it('unnamed and illegal: charges the reveal and takes the miss too', () => {
    const result = attemptReveal(newGame(NGA_KOR), 'FRA')
    expect(result.reveal).toBe(true)
    expect(result.placed).toBe(false)
    expect(result.miss).toBe(true)
    expect(result.state.revealed).toEqual(['FRA'])
    expect(result.state.misses).toEqual(['FRA'])
  })

  it('named and legal: free, because the name was already paid for', () => {
    const known = attemptReveal(newGame(NGA_KOR), 'FRA').state
    // France is now named but still unplaceable. Reach it the long way round,
    // then clicking it again should cost nothing extra.
    const state = ['NER', 'DZA', 'MAR', 'ESP'].reduce((s, c) => place(s, c).state, known)
    const result = attemptReveal(state, 'FRA')
    expect(result.reveal).toBe(false)
    expect(result.placed).toBe(true)
    expect(result.state.revealed).toEqual(['FRA'])
  })

  it('named and illegal: a free miss, never a second charge', () => {
    const known = attemptReveal(newGame(NGA_KOR), 'FRA').state
    const result = attemptReveal(known, 'FRA')
    expect(result.reveal).toBe(false)
    expect(result.miss).toBe(true)
    expect(result.state.revealed).toEqual(['FRA'])
    expect(result.state.misses).toEqual(['FRA', 'FRA'])
  })

  it('never charges for an endpoint, which was named all along', () => {
    const result = attemptReveal(newGame(NGA_KOR), 'NGA')
    expect(result.reveal).toBe(false)
    expect(result.state.revealed).toEqual([])
  })

  it('never charges twice for the same country', () => {
    let state = newGame(NGA_KOR)
    for (let i = 0; i < 3; i++) state = attemptReveal(state, 'FRA').state
    expect(state.revealed).toEqual(['FRA'])
  })

  it('does nothing once the game is won', () => {
    const won = playAll(FRA_POL, ['DEU'])
    const result = attemptReveal(won, 'ESP')
    expect(result.state).toBe(won)
    expect(result.reveal).toBe(false)
  })

  it('ignores a country code that does not exist', () => {
    const fresh = newGame(NGA_KOR)
    const result = attemptReveal(fresh, 'ZZZ')
    expect(result.state).toBe(fresh)
    expect(result.reveal).toBe(false)
  })
})

describe('validNextMoves', () => {
  it('offers the neighbours of both endpoints at the start', () => {
    const moves = validNextMoves(newGame(NGA_KOR))
    expect(moves).toContain('NER') // borders Nigeria
    expect(moves).toContain('PRK') // borders South Korea
    expect(moves).not.toContain('FRA')
  })

  it('never offers something already on the board', () => {
    const state = playAll(NGA_KOR, ['NER'])
    const moves = validNextMoves(state)
    expect(moves).not.toContain('NER')
    expect(moves).not.toContain('NGA')
    expect(moves).not.toContain('KOR')
  })

  it('agrees with isLegal on every country it offers', () => {
    const state = playAll(NGA_KOR, ['NER', 'DZA'])
    for (const move of validNextMoves(state)) {
      expect(isLegal(state, move), move).toBe(true)
    }
  })

  it('grows as the board grows', () => {
    const before = validNextMoves(newGame(NGA_KOR)).length
    const after = validNextMoves(playAll(NGA_KOR, ['NER'])).length
    expect(after).toBeGreaterThan(before)
  })
})

describe('inPlay', () => {
  it('always holds both endpoints', () => {
    expect([...inPlay(newGame(NGA_KOR))].sort()).toEqual(['KOR', 'NGA'])
  })

  it('grows with each placement', () => {
    expect([...inPlay(playAll(NGA_KOR, ['NER']))].sort()).toEqual(['KOR', 'NER', 'NGA'])
  })
})

describe('stepsFromBoard', () => {
  it('is zero for something already on the board', () => {
    expect(stepsFromBoard(newGame(NGA_KOR), 'NGA')).toBe(0)
  })

  it('is one for a country that could be played right now', () => {
    expect(stepsFromBoard(newGame(NGA_KOR), 'NER')).toBe(1)
  })

  it('grows with distance, which is what tells a player they are lost', () => {
    const state = newGame(NGA_KOR)
    expect(stepsFromBoard(state, 'DZA')).toBe(2)
    expect(stepsFromBoard(state, 'FRA')!).toBeGreaterThan(2)
  })

  it('is null for an island nothing reaches', () => {
    expect(stepsFromBoard(newGame(NGA_KOR), 'FJI')).toBeNull()
  })

  it('counts a crossing as the move it is', () => {
    // Japan is one crossing from South Korea, which is on the board already.
    expect(stepsFromBoard(newGame(NGA_KOR), 'JPN')).toBe(SEA_COST)
  })
})

describe('closed borders', () => {
  // France -> Poland is one country through Germany. Shut Germany and the only
  // way round is the long way south: Switzerland, Austria, Czechia.
  const SHUT_DEU: Puzzle = {
    id: 3,
    date: '2026-01-03',
    start: 'FRA',
    end: 'POL',
    best: 3,
    par: 4,
    closed: ['DEU'],
  }

  it('knows which countries are shut', () => {
    const state = newGame(SHUT_DEU)
    expect([...closedIn(SHUT_DEU)]).toEqual(['DEU'])
    expect(isClosed(state, 'DEU')).toBe(true)
    expect(isClosed(state, 'BEL')).toBe(false)
  })

  it('refuses a shut country however well it fits', () => {
    // Germany borders both endpoints, so it would be the whole answer open.
    const state = newGame(SHUT_DEU)
    expect(isLegal(state, 'DEU')).toBe(false)
    const outcome = place(state, 'DEU')
    expect(outcome.placed).toBe(false)
    expect(outcome.miss).toBe(true)
    expect(outcome.reason).toBe('closed')
  })

  it('never offers a shut country as a legal move', () => {
    expect(validNextMoves(newGame(SHUT_DEU))).not.toContain('DEU')
  })

  it('leaves it anonymous, greyed and sunk being enough to route around', () => {
    // This used to be named from the opening move, on the reasoning that a
    // shape you cannot play and cannot identify is a trap. It was also a
    // country's name given away on a board where names are the currency, and
    // the trap it was guarding against — paying twice to find out it was shut —
    // is closed by the refusal below rather than by the name.
    expect(isNamed(newGame(SHUT_DEU), 'DEU')).toBe(false)
  })

  it('charges nothing at all for pressing a country nobody could have played', () => {
    // This used to be a plain miss — no purchase, but still half a stroke every
    // other time. That was wrong in the same way the double charge was: the one
    // shape on the board that says outright it cannot be played is the last
    // thing a player should be billed for touching. Refused, not missed.
    const outcome = attemptReveal(newGame(SHUT_DEU), 'DEU')
    expect(outcome.reveal).toBe(false)
    expect(outcome.state.revealed).toEqual([])
    expect(outcome.miss).toBe(false)
    expect(outcome.reason).toBe('closed')
  })

  it('still lets the puzzle be won the long way round', () => {
    // Belgium and the Netherlands lead nowhere with Germany shut.
    expect(isWon(playAll(SHUT_DEU, ['BEL', 'NLD']))).toBe(false)
    const won = playAll(SHUT_DEU, ['CHE', 'AUT', 'CZE'])
    expect(isWon(won)).toBe(true)
    expect(won.placed).toHaveLength(SHUT_DEU.best)
  })

  it('leaves the winning route free of anything shut', () => {
    const won = playAll(SHUT_DEU, ['CHE', 'AUT', 'CZE'])
    expect(solutionPath(won)).toEqual(['FRA', 'CHE', 'AUT', 'CZE', 'POL'])
    expect(solutionPath(won)!.every((code) => !isClosed(won, code))).toBe(true)
  })

  it('counts distance around the closure rather than through it', () => {
    const state = newGame(SHUT_DEU)
    expect(stepsFromBoard(state, 'DEU')).toBeNull()
  })

  it('refuses a puzzle that shuts one of its own endpoints', () => {
    expect(() => newGame({ ...SHUT_DEU, closed: ['FRA'] })).toThrow(/endpoint/)
  })

  it('refuses a puzzle that shuts a country off the map', () => {
    expect(() => newGame({ ...SHUT_DEU, closed: ['XXX'] })).toThrow(/do not know/)
  })

  it('refuses a puzzle whose closures cut every route', () => {
    // Lesotho touches only South Africa, so shutting it strands the puzzle.
    expect(() =>
      newGame({
        id: 4,
        date: '2026-01-04',
        start: 'LSO',
        end: 'NGA',
        best: 3,
        par: 4,
        closed: ['ZAF'],
      }),
    ).toThrow(/cut every route/)
  })

  it('plays exactly as before when nothing is shut', () => {
    const state = newGame(FRA_POL)
    expect(closedIn(FRA_POL).size).toBe(0)
    expect(isLegal(state, 'DEU')).toBe(true)
    expect(place(state, 'DEU').won).toBe(true)
  })
})

describe('sea crossings', () => {
  // China to Japan: two countries by land, then the Tsushima Strait.
  const CHN_JPN: Puzzle = { id: 5, date: '2026-01-05', start: 'CHN', end: 'JPN', best: 3, par: 4 }
  // Mexico to Jamaica is two crossings and a single country between them.
  const MEX_JAM: Puzzle = { id: 6, date: '2026-01-06', start: 'MEX', end: 'JAM', best: 3, par: 4 }

  it('lets a country be placed across water', () => {
    const state = playAll(CHN_JPN, ['PRK'])
    expect(isLegal(state, 'KOR')).toBe(true)
    expect(playAll(CHN_JPN, ['PRK', 'KOR']).status).toBe('won')
  })

  it('offers a crossing as a legal move', () => {
    expect(validNextMoves(newGame(MEX_JAM))).toContain('CUB')
  })

  it('counts a crossing only once both its ends are on the board', () => {
    expect(crossings(newGame(CHN_JPN))).toBe(0)
    expect(crossings(playAll(CHN_JPN, ['PRK']))).toBe(0)
    // Korea placed, and Japan is the far endpoint: the strait is now in play.
    expect(crossings(playAll(CHN_JPN, ['PRK', 'KOR']))).toBe(1)
  })

  it('charges the closing crossing, which is never a placement', () => {
    // Japan is the endpoint, so nobody ever places it. Counting from the board
    // rather than from the placements is what catches this.
    const won = playAll(CHN_JPN, ['PRK', 'KOR'])
    expect(won.placed).not.toContain('JPN')
    expect(crossings(won)).toBe(1)
  })

  it('counts both crossings when the route uses two', () => {
    const won = playAll(MEX_JAM, ['CUB'])
    expect(won.status).toBe('won')
    expect(crossings(won)).toBe(2)
  })

  it('knows which links are water and which are land', () => {
    expect(isSea('KOR', 'JPN')).toBe(true)
    expect(isSea('JPN', 'KOR')).toBe(true)
    expect(isSea('FRA', 'DEU')).toBe(false)
  })

  it('still refuses an island no crossing reaches', () => {
    expect(isLegal(newGame(MEX_JAM), 'FJI')).toBe(false)
  })
})

describe('the rough', () => {
  const ALPS = ['CHE', 'AUT', 'ITA', 'SVN']
  const puzzle: Puzzle = {
    id: 9,
    date: '2026-01-09',
    start: 'FRA',
    end: 'HUN',
    best: 4,
    par: 5,
    rough: ALPS,
  }

  it('is playable, unlike a closure — that is the whole mechanic', () => {
    const state = newGame(puzzle)
    expect(isLegal(state, 'CHE')).toBe(true)
    expect(validNextMoves(state)).toContain('CHE')
  })

  it('stays anonymous until it is placed or bought', () => {
    // The same call as a closure now, and always was the stricter one: rough is
    // ground you may cross, so its name is a name a player would otherwise have
    // to buy. The marking carries the cost and the name stays for sale.
    const state = newGame(puzzle)
    expect(isNamed(state, 'CHE')).toBe(false)
    expect(isRough(state, 'CHE')).toBe(true)
  })

  it('refuses to roughen an endpoint', () => {
    // Not taste: the premium is charged on arriving, so a rough endpoint makes
    // the hole cost different amounts measured from either end — and the daily
    // runs half its pairs backwards on a coin.
    expect(() => newGame({ ...puzzle, rough: ['FRA'] })).toThrow(
      /roughens one of its own endpoints/,
    )
    expect(() => newGame({ ...puzzle, rough: ['HUN'] })).toThrow(
      /roughens one of its own endpoints/,
    )
  })

  it('refuses a country that is both shut and rough', () => {
    expect(() => newGame({ ...puzzle, closed: ['CHE'], rough: ['CHE'] })).toThrow(
      /shuts and roughens/,
    )
  })

  it('refuses a country it has never heard of', () => {
    expect(() => newGame({ ...puzzle, rough: ['XXX'] })).toThrow(
      /roughens a country we do not know/,
    )
  })

  it('counts only the rough the player actually placed', () => {
    let state = newGame(puzzle)
    expect(roughPlaced(state)).toBe(0)
    state = place(state, 'DEU').state
    expect(roughPlaced(state)).toBe(0)
    state = place(state, 'CHE').state
    expect(roughPlaced(state)).toBe(1)
  })

  it('cannot make a round unwinnable', () => {
    // A premium is finite, so it changes what a route costs and never whether
    // one exists. This is why `isWon` is deliberately never given the rough.
    let state = newGame(puzzle)
    for (const code of ['CHE', 'AUT']) state = place(state, code).state
    expect(isWon(state)).toBe(true)
  })

  it('leaves a genuine choice between going through and going round', () => {
    // A rough region where one line is strictly better is not a tradeoff, it is
    // a toll. Both lines have to be worse than the open route and close to each
    // other, or the mechanic is decoration.
    const open = distance('FRA', 'HUN')!
    const priced = distance('FRA', 'HUN', undefined, new Set(ALPS))!
    const around = distance('FRA', 'HUN', without(ALPS))!
    expect(priced).toBeGreaterThan(open)
    expect(around).toBeGreaterThan(open)
    expect(Math.abs(around - priced)).toBeLessThanOrEqual(1)
  })
})

describe('out of bounds', () => {
  /** The Maghreb, which is four countries and so past the naming limit. */
  const MAGHREB = ['MAR', 'DZA', 'TUN', 'LBY']
  const ruledOff: Puzzle = {
    id: 11,
    date: '2026-01-11',
    start: 'FRA',
    end: 'EGY',
    best: 8,
    par: 10,
    closed: MAGHREB,
  }

  it('is the same rule as a closure, at the size of a place', () => {
    const state = newGame(ruledOff)
    for (const code of MAGHREB) {
      expect(isClosed(state, code), code).toBe(true)
      expect(isLegal(state, code), code).toBe(false)
    }
    expect(validNextMoves(state)).not.toContain('DZA')
  })

  it('tells a border or two apart from a place, without naming either', () => {
    // The threshold survives the naming it used to decide, because it still
    // decides which mechanic the player is being shown: two grey shapes are
    // borders that happen to be shut, and four together are a region.
    for (const closed of [['DEU'], ['DEU', 'CZE']]) {
      const state = newGame({ ...ruledOff, start: 'FRA', end: 'POL', best: 3, par: 4, closed })
      expect(closuresAreFew(state.puzzle), closed.join(',')).toBe(true)
      expect(isNamed(state, closed[0]), closed.join(',')).toBe(false)
    }

    const state = newGame(ruledOff)
    expect(closuresAreFew(state.puzzle)).toBe(false)
    for (const code of MAGHREB) expect(isNamed(state, code), code).toBe(false)
  })

  it('refuses a shut country on the globe rather than charging for it', () => {
    // Pressing a shape is how a player asks about it, and a shut country has
    // already answered. Charging a miss for touching one punishes them for
    // reading the board — and it is how a shut region could quietly cost
    // strokes, since two refusals used to make a stroke.
    const state = newGame(ruledOff)
    const outcome = attemptReveal(state, 'DZA')
    expect(outcome.reveal).toBe(false)
    expect(outcome.placed).toBe(false)
    expect(outcome.miss).toBe(false)
    expect(outcome.reason).toBe('closed')
    expect(outcome.state).toBe(state)
  })

  it('still charges for typing one, which is a claim rather than a question', () => {
    const state = newGame(ruledOff)
    const outcome = place(state, 'DZA')
    expect(outcome.miss).toBe(true)
    expect(outcome.reason).toBe('closed')
  })

  it('never sells the name of a country it has shut', () => {
    const state = newGame(ruledOff)
    expect(attemptReveal(state, 'DZA').state.revealed).toEqual([])
  })

  it('cannot be worn down into a stroke by pressing', () => {
    // The behaviour the bug actually produced: enough presses on a shape that
    // cannot be played and the scorecard moves.
    let state = newGame(ruledOff)
    for (let press = 0; press < 6; press++) state = attemptReveal(state, 'DZA').state
    expect(state.misses).toEqual([])
    expect(scorecard(state).score).toBe(0)
  })

  it('still refuses a closure that leaves no way through', () => {
    expect(() => newGame({ ...ruledOff, start: 'LSO', end: 'NGA', closed: ['ZAF'] })).toThrow(
      /cut every route/,
    )
  })

  it('leaves the endpoints out of it, however many are shut', () => {
    expect(() => newGame({ ...ruledOff, closed: [...MAGHREB, 'FRA'] })).toThrow(
      /closes one of its own endpoints/,
    )
  })
})

describe('the dogleg', () => {
  /**
   * Hungary touches neither France nor Poland, which matters: a waypoint that
   * already borders an endpoint is reached before the player moves and places
   * itself on the opening frame.
   */
  const dogleg: Puzzle = {
    id: 12,
    date: '2026-01-12',
    start: 'FRA',
    end: 'POL',
    best: 4,
    par: 5,
    required: ['HUN'],
  }

  it('does not name the waypoint, which is the whole of the hole', () => {
    // The reverse of a lone closure, and deliberately so. A shut country you
    // cannot see is a trap, because you cannot reason about what you are routing
    // around. A waypoint you *can* see and cannot name is the puzzle.
    const state = newGame(dogleg)
    expect(isRequired(state, 'HUN')).toBe(true)
    expect(isNamed(state, 'HUN')).toBe(false)
  })

  it('sells the waypoint like any other name', () => {
    const state = newGame(dogleg)
    const bought = attemptReveal(state, 'HUN')
    expect(bought.reveal).toBe(true)
    expect(bought.state.revealed).toEqual(['HUN'])
    expect(isNamed(bought.state, 'HUN')).toBe(true)
  })

  it('is not won until the waypoint is on the board', () => {
    // France and Poland meet through Germany, which would ordinarily be the
    // whole round. Not today.
    let state = newGame(dogleg)
    state = place(state, 'DEU').state
    expect(distance('FRA', 'POL', inPlay(state))).not.toBeNull()
    expect(isWon(state)).toBe(false)
  })

  /**
   * The board this change exists to stop winning, and the shape the live game
   * showed: the waypoint reached down a dead-end arm while the route runs past
   * it. Germany joins France to Poland; Austria and Hungary hang off the side.
   */
  it('is not won by a board that only reaches the waypoint', () => {
    let state = newGame(dogleg)
    for (const code of ['DEU', 'AUT', 'HUN']) state = place(state, code).state
    expect(inPlay(state).has('HUN')).toBe(true)
    expect(distance('FRA', 'POL', inPlay(state))).not.toBeNull()
    // Both halves of the old condition hold, and it is still not a round.
    expect(isWon(state)).toBe(false)
    expect(state.status).toBe('playing')
  })

  it('is won by going in one border and out another', () => {
    // Slovakia is the way out of Hungary towards Poland. With it the arm
    // becomes a bend, and the same four countries that were not a round are.
    let state = newGame(dogleg)
    for (const code of ['DEU', 'AUT', 'HUN']) state = place(state, code).state
    const outcome = place(state, 'SVK')
    expect(outcome.won).toBe(true)
    expect(outcome.state.status).toBe('won')
    expect(solutionPath(outcome.state)).toEqual(['FRA', 'DEU', 'AUT', 'HUN', 'SVK', 'POL'])
    expect(scorecard(outcome.state).countries).toBe(4)
    expect(scorecard(outcome.state).score).toBe(dogleg.best)
  })

  /**
   * The reason `solutionPath` asks through the waypoint rather than taking the
   * plain cheapest line across the board. Hungary borders Ukraine, and Ukraine
   * borders Poland, so this board holds a shorter route that misses the bend
   * entirely — and drawing that one would put the waypoint under "didn't need".
   */
  it('draws the route that goes through, not the shorter one that skips it', () => {
    let state = newGame(dogleg)
    for (const code of ['DEU', 'AUT', 'HUN', 'SVK']) state = place(state, code).state
    expect(state.status).toBe('won')
    expect(solutionPath(state)).toContain('HUN')
    expect(detours(state)).toEqual([])
  })

  it('refuses a waypoint that no route can pass through', () => {
    // Portugal holds a single link, so the way in is the only way out. Nineteen
    // countries are like this and none of them can ever be a waypoint.
    expect(() => newGame({ ...dogleg, required: ['PRT'] })).toThrow(/no route can pass through/)
  })

  it('refuses more than one country to pass through', () => {
    expect(() => newGame({ ...dogleg, required: ['HUN', 'ITA'] })).toThrow(
      /more than one country to pass through/,
    )
  })

  it('refuses a waypoint that is an endpoint, shut, or rough', () => {
    expect(() => newGame({ ...dogleg, required: ['FRA'] })).toThrow(/requires one of its own/)
    expect(() => newGame({ ...dogleg, closed: ['HUN'], required: ['HUN'] })).toThrow(
      /shuts and requires/,
    )
    // The route leaves the waypoint rather than arriving at it, so a premium
    // charged on arrival would never be charged at all.
    expect(() => newGame({ ...dogleg, rough: ['HUN'], required: ['HUN'] })).toThrow(
      /roughens and requires/,
    )
  })

  it('refuses a waypoint it has never heard of', () => {
    expect(() => newGame({ ...dogleg, required: ['XXX'] })).toThrow(/requires a country we do not/)
  })

  it('leaves a round with no waypoint winning exactly as it did', () => {
    let state = newGame({ ...dogleg, required: undefined, best: 1, par: 2 })
    state = place(state, 'DEU').state
    expect(state.status).toBe('won')
  })
})
