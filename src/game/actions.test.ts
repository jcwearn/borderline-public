import { describe, expect, it } from 'vitest'
import { apply } from './actions'
import { CODES } from './graph'
import { newGame, type GameState, type Puzzle } from './rules'
import { scorecard } from './score'

const LTU_BEN: Puzzle = { id: 1, date: '2026-08-09', start: 'LTU', end: 'BEN', best: 7, par: 9 }
const ROUTE = ['POL', 'DEU', 'FRA', 'ESP', 'MAR', 'DZA', 'NER']

function run(codes: string[], source: 'typed' | 'globe'): GameState {
  return codes.reduce((state, code) => apply(state, code, source).state, newGame(LTU_BEN))
}

describe('typing', () => {
  it('never buys a name, because the player supplied it', () => {
    // The regression. A perfect typed round is an eagle, not double the route.
    const state = run(ROUTE, 'typed')
    const card = scorecard(state)
    expect(state.status).toBe('won')
    expect(card.reveals).toBe(0)
    expect(card.score).toBe(7)
    expect(card.delta).toBe(-2)
  })

  it('never buys a name for any country in the graph, right or wrong', () => {
    for (const code of CODES) {
      expect(apply(newGame(LTU_BEN), code, 'typed').reveal, code).toBe(false)
    }
  })

  it('costs nothing extra when the guess is wrong', () => {
    const outcome = apply(newGame(LTU_BEN), 'JPN', 'typed')
    expect(outcome.reveal).toBe(false)
    expect(outcome.miss).toBe(true)
    expect(outcome.state.revealed).toEqual([])
  })

  it('is free even for a country whose name was bought earlier', () => {
    const bought = apply(newGame(LTU_BEN), 'FRA', 'globe').state
    expect(bought.revealed).toEqual(['FRA'])
    const typed = apply(bought, 'POL', 'typed')
    expect(typed.reveal).toBe(false)
    expect(typed.state.revealed).toEqual(['FRA'])
  })
})

describe('pointing at the globe', () => {
  it('buys every name on a round played entirely by pointing', () => {
    const card = scorecard(run(ROUTE, 'globe'))
    expect(card.reveals).toBe(7)
    expect(card.score).toBe(14)
  })

  it('is free for a country already named', () => {
    // Poland is placed, so pointing at it again is not a purchase.
    const state = apply(newGame(LTU_BEN), 'POL', 'typed').state
    expect(apply(state, 'POL', 'globe').reveal).toBe(false)
  })

  it('charges once, however many times the same shape is pressed', () => {
    let state = newGame(LTU_BEN)
    for (let i = 0; i < 3; i++) state = apply(state, 'JPN', 'globe').state
    expect(state.revealed).toEqual(['JPN'])
  })
})

describe('direction', () => {
  // You may build forward from the start, backward from the end, or inward from
  // both at once. Nothing about a route costs more for having been laid down in
  // a particular order.
  const BACKWARD = [...ROUTE].reverse()
  const INWARD = ['POL', 'NER', 'DEU', 'DZA', 'FRA', 'MAR', 'ESP']

  it('costs the same built backward from the end', () => {
    const card = scorecard(run(BACKWARD, 'typed'))
    expect(card.score).toBe(7)
    expect(card.delta).toBe(-2)
    expect(card.misses).toBe(0)
  })

  it('costs the same built inward from both ends at once', () => {
    const card = scorecard(run(INWARD, 'typed'))
    expect(card.score).toBe(7)
    expect(card.delta).toBe(-2)
    expect(card.misses).toBe(0)
  })

  it('is never a miss to extend the end side rather than the start side', () => {
    // Niger touches Benin, the far endpoint, and is legal as an opening move.
    const opening = apply(newGame(LTU_BEN), 'NER', 'typed')
    expect(opening.miss).toBe(false)
    expect(opening.placed).toBe(true)
  })

  it('scores every order identically, forward, backward or inward', () => {
    const scores = [ROUTE, BACKWARD, INWARD].map((order) => scorecard(run(order, 'typed')).score)
    expect(new Set(scores)).toEqual(new Set([7]))
  })

  it('reaches the same finished board whichever way it was built', () => {
    for (const order of [BACKWARD, INWARD]) {
      const state = run(order, 'typed')
      expect(state.status).toBe('won')
      expect([...state.placed].sort()).toEqual([...ROUTE].sort())
    }
  })
})

describe('the two sources against each other', () => {
  it('differ only in what they charge, never in what they place', () => {
    const typed = run(ROUTE, 'typed')
    const pointed = run(ROUTE, 'globe')
    expect(typed.placed).toEqual(pointed.placed)
    expect(typed.status).toBe(pointed.status)
    expect(scorecard(pointed).score - scorecard(typed).score).toBe(ROUTE.length)
  })
})
