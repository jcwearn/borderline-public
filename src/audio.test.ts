import { afterEach, describe, expect, it, vi } from 'vitest'
import { play, setMuted, soundFor } from './audio'
import { apply } from './game/actions'
import { newGame, type Outcome, type Puzzle } from './game/rules'

const FRA_POL: Puzzle = { id: 1, date: '2026-08-09', start: 'FRA', end: 'POL', best: 1, par: 2 }

afterEach(() => {
  setMuted(false)
  vi.unstubAllGlobals()
})

describe('soundFor', () => {
  it('gives a clean strike to a country named from memory', () => {
    expect(soundFor(apply(newGame(FRA_POL), 'DEU', 'typed'))).toBe('place')
  })

  it('gives the heavier club to a name that was bought', () => {
    expect(soundFor(apply(newGame(FRA_POL), 'DEU', 'globe'))).toBe('reveal')
  })

  it('gives a mishit to a country that would not go', () => {
    expect(soundFor(apply(newGame(FRA_POL), 'MAR', 'typed'))).toBe('miss')
  })

  it('makes a bought miss sound bought, not merely wrong', () => {
    // Both charges landed, so the sound should be the one that cost something.
    const outcome = apply(newGame(FRA_POL), 'MAR', 'globe')
    expect(outcome.reveal).toBe(true)
    expect(outcome.miss).toBe(true)
    expect(soundFor(outcome)).toBe('miss')
  })

  it('stays silent when nothing happened', () => {
    const nothing: Outcome = {
      state: newGame(FRA_POL),
      code: 'DEU',
      reveal: false,
      placed: false,
      miss: false,
      won: false,
    }
    expect(soundFor(nothing)).toBeNull()
  })

  it('never disagrees with what the game did', () => {
    for (const code of ['DEU', 'MAR', 'JPN', 'FRA']) {
      for (const source of ['typed', 'globe'] as const) {
        const outcome = apply(newGame(FRA_POL), code, source)
        const sound = soundFor(outcome)
        if (sound === 'reveal') expect(outcome.reveal).toBe(true)
        if (sound === 'place') expect(outcome.reveal).toBe(false)
        if (sound !== null) expect(outcome.placed || outcome.miss).toBe(true)
      }
    }
  })
})

describe('play', () => {
  it('does nothing at all where there is no audio to play, rather than throwing', () => {
    // Node has no window, which is the same path a locked-down browser takes.
    for (const sound of ['place', 'reveal', 'miss', 'holed'] as const) {
      expect(() => play(sound)).not.toThrow()
    }
  })

  it('makes no sound while muted', () => {
    const createGain = vi.fn()
    vi.stubGlobal('window', { AudioContext: vi.fn(() => ({ createGain })) })
    setMuted(true)
    play('place')
    expect(createGain).not.toHaveBeenCalled()
  })

  it('survives a browser that refuses to build an audio context', () => {
    vi.stubGlobal('window', {
      AudioContext: vi.fn(() => {
        throw new Error('blocked by policy')
      }),
    })
    expect(() => play('holed')).not.toThrow()
  })
})
