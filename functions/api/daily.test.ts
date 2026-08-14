import { describe, expect, it } from 'vitest'
// No `with { type: 'json' }`, for the reason `./daily.ts` gives: the Cloudflare
// Pages build image bundles *everything* under `functions/` with wrangler 3,
// whose esbuild cannot parse import attributes and fails the build outright.
// That includes the tests — they are never run there, but they are compiled, so
// the rule applies to this file exactly as it does to the handler beside it.
// Local `wrangler pages functions build` runs a much newer wrangler and will
// not reproduce it; `npx wrangler@3 pages functions build` will.
import served from '../data/served.json'
import { utcDate } from '../../src/game/daily'
import { connectable, costVia, distance, without } from '../../src/game/graph'
import { onRequestGet } from './daily'

const SALT = 'test-salt'

function call(url: string, env: Record<string, string | undefined> = { PUZZLE_SALT: SALT }) {
  return onRequestGet({
    request: new Request(`https://borderline.test${url}`),
    env: env as { PUZZLE_SALT?: string; ALLOW_DATE_OVERRIDE?: string },
  })
}

const DEV = { PUZZLE_SALT: SALT, ALLOW_DATE_OVERRIDE: '1' }

describe('GET /api/daily', () => {
  it('serves a puzzle', async () => {
    const response = await call('/api/daily')
    expect(response.status).toBe(200)
    const puzzle = await response.json()
    expect(puzzle).toMatchObject({
      id: expect.any(Number),
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      start: expect.any(String),
      end: expect.any(String),
      best: expect.any(Number),
      par: expect.any(Number),
    })
  })

  it('serves a puzzle that can actually be solved', async () => {
    const puzzle = await (await call('/api/daily')).json()
    expect(connectable(puzzle.start, puzzle.end)).toBe(true)
    // Measured around whatever today has shut, priced through whatever it has
    // roughened, and joining whatever it insists on reaching. Checking the open
    // graph passed for as long as today happened to be an open day and failed
    // the moment it was not — which is the same bug as shipping a par nobody
    // can reach, only discovered by the calendar rather than by a player.
    const within = without(puzzle.closed ?? [])
    const priced = new Set<string>(puzzle.rough ?? [])
    const floor = puzzle.required?.length
      ? costVia(puzzle.start, puzzle.end, puzzle.required[0], within, priced)
      : distance(puzzle.start, puzzle.end, within, priced)
    expect(floor).toBe(puzzle.best + 1)
  })

  it('serves a day that has already gone out exactly as it went out', async () => {
    // Under a salt that is not production's, so the pool would answer
    // differently for every one of these — which is the whole point. This is
    // the check that a pool rebuild cannot move a day somebody is part-way
    // through, and it runs through the handler rather than through `pickPuzzle`
    // so that forgetting to pass the record to it is a failure here too.
    const pinned = served as Record<string, Record<string, unknown>>
    expect(Object.keys(pinned).length).toBeGreaterThan(0)

    for (const [date, puzzle] of Object.entries(pinned)) {
      const body = await (await call(`/api/daily?v=test&date=${date}`, DEV)).json()
      expect(body, date).toMatchObject(puzzle)
      expect(body.date, date).toBe(date)
    }
  })

  it('lets the CDN hold it until the puzzle changes, and no longer', async () => {
    const response = await call('/api/daily')
    const cache = response.headers.get('cache-control')!
    expect(cache).toMatch(/^public, max-age=\d+$/)
    const seconds = Number(cache.match(/max-age=(\d+)/)![1])
    expect(seconds).toBeGreaterThan(0)
    expect(seconds).toBeLessThanOrEqual(86_400)
  })

  it('refuses to run without a salt rather than falling back to a guessable one', async () => {
    const response = await call('/api/daily', {})
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'PUZZLE_SALT is not configured' })
  })

  it('will not reveal another date in production', async () => {
    const response = await call('/api/daily?date=2027-01-01')
    expect(response.status).toBe(403)
  })

  it('plays the date the browser says it is on', async () => {
    // Every real browser sends this, and unlike ?date= it needs no flag — so
    // it is asked for here without the DEV env.
    const today = utcDate()
    const response = await call(`/api/daily?v=test&d=${today}`)
    expect(response.status).toBe(200)
    expect((await response.json()).date).toBe(today)
  })

  it('holds a date the URL names for as long as it likes', async () => {
    const response = await call(`/api/daily?v=test&d=${utcDate()}`)
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
  })

  it('does not let ?d= read the rest of the year the way ?date= would', async () => {
    const response = await call('/api/daily?v=test&d=2027-01-01')
    expect(response.status).toBe(200)
    // Falls back rather than erroring: a wrong clock should cost the right
    // rollover, not the game.
    expect((await response.json()).date).toBe(utcDate())
  })

  it('never caches a refused date, which would poison it for whoever reaches it', async () => {
    // The response body is today's puzzle but the cache key says 2027-01-01.
    // Storing it would hand August's puzzle to everyone who gets there for real.
    const response = await call('/api/daily?v=test&d=2027-01-01')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('ignores a well-shaped date that is not a real one', async () => {
    const response = await call('/api/daily?v=test&d=2026-02-30')
    expect(response.status).toBe(200)
    expect((await response.json()).date).toBe(utcDate())
  })

  it('lets the development override win over the browser, or it overrides nothing', async () => {
    const response = await call(`/api/daily?d=${utcDate()}&date=2026-08-09`, DEV)
    expect((await response.json()).date).toBe('2026-08-09')
  })

  it('allows the override in development', async () => {
    const response = await call('/api/daily?date=2026-08-09', DEV)
    expect(response.status).toBe(200)
    expect((await response.json()).date).toBe('2026-08-09')
  })

  it('rejects a malformed date instead of serving something arbitrary', async () => {
    const response = await call('/api/daily?date=nonsense', DEV)
    expect(response.status).toBe(400)
  })

  it('gives the same answer every time it is asked', async () => {
    const [a, b] = await Promise.all([
      call('/api/daily?date=2026-08-09', DEV).then((r) => r.json()),
      call('/api/daily?date=2026-08-09', DEV).then((r) => r.json()),
    ])
    expect(a).toEqual(b)
  })

  it('ramps difficulty from Monday to Sunday', async () => {
    const week = ['08-10', '08-11', '08-12', '08-13', '08-14', '08-15', '08-16']
    const pars = await Promise.all(
      week.map((day) => call(`/api/daily?date=2026-${day}`, DEV).then((r) => r.json())),
    )
    for (const puzzle of pars.slice(0, 2)) expect(puzzle.best).toBe(3)
    for (const puzzle of pars.slice(2, 5)) expect(puzzle.best).toBeGreaterThanOrEqual(4)
    for (const puzzle of pars.slice(2, 5)) expect(puzzle.best).toBeLessThanOrEqual(6)
    for (const puzzle of pars.slice(5)) expect(puzzle.best).toBeGreaterThanOrEqual(7)
  })

  it('never hands out the puzzle pool, only the one hole', async () => {
    // Pinned dates rather than today's: a barrier field is present only on the
    // days that carry it, so asserting an exact key set against whatever today
    // happens to be would pass now and fail on some future Tuesday.
    const REQUIRED = ['best', 'date', 'end', 'id', 'par', 'start']
    const ALLOWED = new Set([...REQUIRED, 'closed', 'rough', 'required'])
    const shapes = new Set<string>()

    for (let day = 0; day < 60; day++) {
      const date = new Date(Date.UTC(2026, 7, 9 + day)).toISOString().slice(0, 10)
      const body = await (await call(`/api/daily?date=${date}`, DEV)).text()
      const keys = Object.keys(JSON.parse(body))
      for (const key of keys) expect(ALLOWED.has(key), `${date} sent ${key}`).toBe(true)
      expect(keys, date).toEqual(expect.arrayContaining(REQUIRED))
      // The difficulty is the pool's own filing, and naming it would hand over
      // the shape of the thing the salt exists to keep private.
      expect(body, date).not.toContain('easy')
      expect(body, date).not.toContain('dogleg')
      // Room for a fairway day, whose closed list is most of the planet —
      // every country the game has is ~1,200 bytes of codes — and nowhere
      // near room for a bucket, let alone the 2.4 MB pool.
      expect(body.length, date).toBeLessThan(1600)
      for (const field of ['closed', 'rough', 'required']) {
        if (keys.includes(field)) shapes.add(field)
      }
      if (!keys.some((key) => ALLOWED.has(key) && !REQUIRED.includes(key))) shapes.add('open')
    }

    // Every shape has to actually occur, or the loop above proves nothing about
    // the ones it never saw.
    expect([...shapes].sort()).toEqual(['closed', 'open', 'required', 'rough'])
  })
})
