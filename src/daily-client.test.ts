import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDailyPuzzle } from './daily-client'
import { distance } from './game/graph'

/**
 * A pair that really is three countries apart on the committed map, so a test
 * about a broken payload is never quietly a test about a broken pair.
 */
const START = 'SRB'
const END = 'LTU'
const BEST = distance(START, END)! - 1

const GOOD = { id: 1, date: '2026-08-10', start: START, end: END, best: BEST, par: BEST + 1 }

/** The last URL fetched, so the cache-key stamp can be checked. */
let asked: string | undefined

function serve(body: unknown, status = 200): void {
  asked = undefined
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      asked = url
      return Promise.resolve(new Response(JSON.stringify(body), { status }))
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchDailyPuzzle', () => {
  it('returns a well-formed puzzle', async () => {
    serve(GOOD)
    await expect(fetchDailyPuzzle()).resolves.toEqual(GOOD)
  })

  it('asks under the build it was shipped in, so a stale cache cannot answer', async () => {
    serve(GOOD)
    await fetchDailyPuzzle()
    expect(asked).toMatch(/^\/api\/daily\?v=.+/)
  })

  it('says which date it is on, since the server cannot know the zone', async () => {
    serve(GOOD)
    await fetchDailyPuzzle()
    expect(asked).toMatch(/[?&]d=\d{4}-\d{2}-\d{2}$/)
  })

  it('rejects a payload with no shortest route', async () => {
    // Exactly what an older deployment's cached response looked like: the
    // puzzle carried `par` alone, before `best` was part of it.
    serve({ id: GOOD.id, date: GOOD.date, start: START, end: END, par: BEST + 1 })
    await expect(fetchDailyPuzzle()).rejects.toThrow(/shortest route makes no sense/)
  })

  it('rejects a shortest route the map disagrees with', async () => {
    serve({ ...GOOD, best: BEST + 1, par: BEST + 2 })
    await expect(fetchDailyPuzzle()).rejects.toThrow(/does not match the map/)
  })

  it('rejects a par a good round could not beat', async () => {
    serve({ ...GOOD, par: BEST - 1 })
    await expect(fetchDailyPuzzle()).rejects.toThrow(/par is below the shortest route/)
  })

  it('rejects endpoints that are not on the map', async () => {
    serve({ ...GOOD, end: 'ZZZ' })
    await expect(fetchDailyPuzzle()).rejects.toThrow(/ZZZ is not a country we know/)
  })

  it('passes the complaint from the server through', async () => {
    serve({ error: 'PUZZLE_SALT is not configured' }, 500)
    await expect(fetchDailyPuzzle()).rejects.toThrow(/PUZZLE_SALT is not configured/)
  })
})
