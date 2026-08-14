import { afterEach, describe, expect, it, vi } from 'vitest'
import { entryMode, guessProps, resultProps, roundProps, setRecord, track } from './analytics'
import { EMPTY_STATS } from './storage'
import { apply } from './game/actions'
import { newGame, place, type GameState, type Puzzle } from './game/rules'

const DAILY: Puzzle = { id: 142, date: '2026-05-22', start: 'FRA', end: 'POL', best: 1, par: 2 }
const FREE: Puzzle = { ...DAILY, id: 0, free: true, closed: ['CHE'] }

function played(puzzle: Puzzle, codes: string[]): GameState {
  return codes.reduce((state, code) => place(state, code).state, newGame(puzzle))
}

// These run with no VITE_POSTHOG_KEY, which is the state every build except
// production is in — so this is also the assertion that `npm test`, the layout
// suite and `npm run dev` send nothing anywhere.
describe('with no key configured', () => {
  it('tracks nothing, and throws nothing', () => {
    expect(() => track('round_started', { mode: 'daily' })).not.toThrow()
    expect(() => setRecord(EMPTY_STATS)).not.toThrow()
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.doUnmock('posthog-js')
})

/**
 * A key, a browser and a library that has not arrived yet — the state the first
 * seconds of every real session are in. What is being tested is the queue: the
 * game reports a round starting long before an idle moment turns up to load
 * PostHog in, and losing those events would lose the opening of every round.
 */
async function withKey(search = '', measured: boolean | 'unreachable' = true) {
  const captured: Array<[string, unknown]> = []
  const posthog = {
    init: vi.fn(),
    register: vi.fn(),
    capture: vi.fn((event: string, props: unknown) => void captured.push([event, props])),
    setPersonProperties: vi.fn(),
  }

  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test')
  vi.doMock('posthog-js', () => ({ default: posthog }))
  // The load waits for an idle browser, and there is no browser here at all.
  let idle: (() => void) | null = null
  vi.stubGlobal('requestIdleCallback', (load: () => void) => void (idle = load))
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  vi.stubGlobal('location', { search })
  // Whether this visitor is measured at all is the edge's answer, not ours.
  let asked = 0
  vi.stubGlobal('fetch', async (url: string) => {
    if (url !== '/api/region') throw new Error(`unexpected fetch: ${url}`)
    asked += 1
    if (measured === 'unreachable') throw new Error('offline')
    return new Response(JSON.stringify({ analytics: measured }), { status: 200 })
  })

  vi.resetModules()
  const analytics = await import('./analytics')
  return { analytics, posthog, captured, arrive: () => idle?.(), asked: () => asked }
}

/** Let every pending promise and timer turn over before asserting a negative. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('with a key configured', () => {
  it('holds what happened before the library landed, then sends it in order', async () => {
    const { analytics, captured, arrive } = await withKey()
    analytics.init()
    analytics.track('round_started', { mode: 'daily' })
    analytics.track('guess', { result: 'placed' })
    expect(captured).toEqual([])

    arrive()
    await vi.waitFor(() => expect(captured).toHaveLength(2))
    expect(captured.map(([event]) => event)).toEqual(['round_started', 'guess'])
  })

  it('goes to our own path, not to a hostname a blocklist knows', async () => {
    const { analytics, posthog, arrive } = await withKey()
    analytics.init()
    arrive()
    await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled())
    expect(posthog.init.mock.calls[0][1]).toMatchObject({
      api_host: '/ingest',
      persistence: 'localStorage',
      respect_dnt: true,
      autocapture: false,
      disable_session_recording: true,
    })
  })

  it('stamps how the player arrived on everything they do', async () => {
    const { analytics, posthog, arrive } = await withKey('?g=M5c')
    analytics.init()
    arrive()
    await vi.waitFor(() => expect(posthog.register).toHaveBeenCalled())
    expect(posthog.register.mock.calls[0][0]).toEqual({ pointer: 'fine', entry_mode: 'free_link' })
  })

  it('loads nothing at all for a visitor the edge says not to measure', async () => {
    // The point is not that their events are dropped later — it is that the
    // library never runs, so nothing is written to their device to begin with.
    const { analytics, posthog, captured, arrive, asked } = await withKey('', false)
    analytics.init()
    analytics.track('round_started', { mode: 'daily' })
    arrive()

    // Wait for the answer to have arrived and been acted on, or this asserts
    // only that nothing has happened yet.
    await vi.waitFor(() => expect(asked()).toBe(1))
    await settle()
    expect(posthog.init).not.toHaveBeenCalled()
    expect(captured).toEqual([])
  })

  it('treats an unanswerable question as a no', async () => {
    const { analytics, posthog, arrive, asked } = await withKey('', 'unreachable')
    analytics.init()
    analytics.track('round_started', { mode: 'daily' })
    arrive()

    await vi.waitFor(() => expect(asked()).toBe(1))
    await settle()
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('sends the record as person properties, so a streak is a person and not an event', async () => {
    const { analytics, posthog, arrive } = await withKey()
    analytics.init()
    analytics.setRecord({ ...EMPTY_STATS, rounds: 9, currentStreak: 3, maxStreak: 7 })
    arrive()
    await vi.waitFor(() => expect(posthog.setPersonProperties).toHaveBeenCalled())
    expect(posthog.setPersonProperties).toHaveBeenCalledWith({
      rounds: 9,
      current_streak: 3,
      max_streak: 7,
    })
  })
})

describe('entryMode', () => {
  it('reads the daily', () => {
    expect(entryMode('')).toBe('daily')
  })

  it('tells a shared round from the builder', () => {
    // Someone acting on a link, which is the only measure of a share that means
    // anything — against someone opening the empty builder themselves.
    expect(entryMode('?free=FRA-TUR')).toBe('free_link')
    expect(entryMode('?g=M5c')).toBe('free_link')
    expect(entryMode('?free')).toBe('free_builder')
  })
})

describe('roundProps', () => {
  it('names the daily by its number', () => {
    expect(roundProps(newGame(DAILY))).toMatchObject({
      mode: 'daily',
      puzzle_id: 142,
      start: 'FRA',
      end: 'POL',
      par: 2,
      best: 1,
      closed_count: 0,
      rough_count: 0,
      required_count: 0,
    })
  })

  it('files a free round under no number at all', () => {
    // Its id is not one anybody else played, so quoting it would put made-up
    // rounds and the daily in the same column.
    expect(roundProps(newGame(FREE))).toMatchObject({
      mode: 'free',
      puzzle_id: null,
      closed_count: 1,
    })
  })

  it('counts every barrier the hole carries, and names none of them', () => {
    // Counts rather than codes: the shape of the hole is what tells a day that
    // plays badly from one that is merely hard, and `start`, `end` and the date
    // already say which countries were involved.
    const props = roundProps(
      newGame({ ...DAILY, best: 3, par: 4, rough: ['ITA', 'AUT'], required: ['GRC'] }),
    )
    expect(props).toMatchObject({ closed_count: 0, rough_count: 2, required_count: 1 })
    expect(JSON.stringify(props)).not.toContain('ITA')
    expect(JSON.stringify(props)).not.toContain('GRC')
  })
})

describe('resultProps', () => {
  it('reports the scorecard the results screen shows', () => {
    const state = played(DAILY, ['DEU'])
    expect(resultProps(state)).toMatchObject({
      mode: 'daily',
      countries: 1,
      score: 1,
      par: 2,
      delta: -1,
      misses: 0,
      reveals: 0,
    })
  })

  it('carries the penalties, not just the counts', () => {
    const missed = apply(newGame(DAILY), 'BRA', 'typed').state
    const twice = apply(missed, 'BRA', 'typed').state
    expect(resultProps(twice)).toMatchObject({ misses: 2, miss_penalty: 1 })
  })
})

describe('guessProps', () => {
  it('describes a placement', () => {
    expect(guessProps(apply(newGame(DAILY), 'DEU', 'typed'), 'typed')).toMatchObject({
      result: 'placed',
      source: 'typed',
      reason: null,
      guess_index: 1,
      placed_count: 1,
      reveal_count: 0,
    })
  })

  it('describes a miss, and why it was one', () => {
    expect(guessProps(apply(newGame(DAILY), 'BRA', 'typed'), 'typed')).toMatchObject({
      result: 'miss',
      reason: 'not-adjacent',
      guess_index: 1,
      placed_count: 0,
    })
  })

  it('separates a refusal from a miss, since a refusal costs nothing', () => {
    // Naming a country already on the board. Filed as `miss` this would read as
    // somebody wrong about the map, which is the one thing it is not.
    // Belgium rather than Germany: Germany joins the two ends and the round is
    // over, and a tap on a finished board is reported as nothing at all.
    const state = played(DAILY, ['BEL'])
    expect(guessProps(apply(state, 'BEL', 'typed'), 'typed')).toMatchObject({
      result: 'refused',
      reason: 'already-in-play',
      placed_count: 1,
    })
    expect(guessProps(apply(state, 'FRA', 'typed'), 'typed')).toMatchObject({
      result: 'refused',
      reason: 'already-in-play',
    })
  })

  it('files a shut country pressed on the globe under the same refusal', () => {
    expect(guessProps(apply(newGame(FREE), 'CHE', 'globe'), 'globe')).toMatchObject({
      result: 'refused',
      reason: 'closed',
      source: 'globe',
      reveal_count: 0,
    })
  })

  it('counts a bought name as the one move it is', () => {
    // The globe reveals and places in a single press. Two events here would put
    // the same move twice into "how far in do people stop?".
    const outcome = apply(newGame(DAILY), 'DEU', 'globe')
    expect(guessProps(outcome, 'globe')).toMatchObject({
      result: 'revealed',
      source: 'globe',
      guess_index: 1,
      placed_count: 1,
      reveal_count: 1,
    })
  })
})
