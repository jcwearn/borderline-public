import { describe, expect, it } from 'vitest'
import rawPool from '../../functions/data/pairs.json' with { type: 'json' }
import rawServed from '../../functions/data/served.json' with { type: 'json' }
import { connectable, costVia, distance, without } from './graph'

/**
 * What a served puzzle's shortest route really costs, barriers and all. With a
 * waypoint that is the cheapest route *through* it — in one border and out
 * another — and not merely the cheapest board that reaches it.
 */
function floorOf(puzzle: {
  start: string
  end: string
  closed?: string[]
  rough?: string[]
  required?: string[]
}): number | null {
  const within = puzzle.closed?.length ? without(puzzle.closed) : undefined
  const priced = puzzle.rough?.length ? new Set(puzzle.rough) : undefined
  const via = puzzle.required?.[0]
  return via === undefined
    ? distance(puzzle.start, puzzle.end, within, priced)
    : costVia(puzzle.start, puzzle.end, via, within, priced)
}
import { barriersIn } from './mechanics'
import { SINGLES } from './pool'
import { fairwayRound, newGame, type Puzzle } from './rules'
import {
  ALLOWANCE,
  EPOCH,
  type PuzzlePool,
  type Served,
  difficultyFor,
  isPlausibleToday,
  localDate,
  parFor,
  pickPuzzle,
  puzzleId,
  rotationFor,
  secondsUntilNextUtcDay,
  utcDate,
} from './daily'

const POOL = rawPool as unknown as PuzzlePool
const SERVED = rawServed as unknown as Served
const SALT = 'test-salt-not-the-real-one'

/** What the round presents itself as, which is not always how it was filed. */
const mechanicsOf = (puzzle: Puzzle) => barriersIn(puzzle).map((barrier) => barrier.mechanic)

/** Every UTC date in a range, inclusive. */
function dateRange(from: string, days: number): string[] {
  const start = new Date(`${from}T00:00:00Z`).getTime()
  return Array.from({ length: days }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  )
}

/**
 * The test process's environment. Reached through `globalThis` rather than as a
 * bare global because tsconfig.app.json keeps Node's types out of what is
 * otherwise a browser project, and widening its `types` for one test would be
 * the wrong trade. These tests run under `environment: 'node'`, so it is there.
 */
const nodeEnv = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env

/**
 * Run `fn` as if the machine were in `tz`. Reassigning `TZ` moves Date's local
 * getters, which is the only way to cover a zone other than the one the tests
 * happen to be running in — and CI runs in UTC, where the case that matters
 * here does not exist.
 */
function inZone<T>(tz: string, fn: () => T): T {
  const before = nodeEnv.TZ
  nodeEnv.TZ = tz
  try {
    return fn()
  } finally {
    nodeEnv.TZ = before
  }
}

describe('utcDate', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(utcDate(new Date('2026-08-09T14:23:00Z'))).toBe('2026-08-09')
  })

  it('reads the UTC day whatever zone the machine is in', () => {
    expect(utcDate(new Date('2026-08-09T23:59:59Z'))).toBe('2026-08-09')
    expect(utcDate(new Date('2026-08-10T00:00:00Z'))).toBe('2026-08-10')
    expect(inZone('America/New_York', () => utcDate(new Date('2026-08-10T00:00:00Z')))).toBe(
      '2026-08-10',
    )
  })
})

describe('localDate', () => {
  it('turns over at the local midnight, wherever that is', () => {
    // Built with the local constructor, so this is midnight in whatever zone
    // the test is running in and the assertion holds in all of them.
    const midnight = new Date(2026, 7, 10)
    expect(localDate(midnight)).toBe('2026-08-10')
    expect(localDate(new Date(midnight.getTime() - 1))).toBe('2026-08-09')
    expect(localDate(new Date(2026, 7, 10, 23, 59, 59))).toBe('2026-08-10')
  })

  it('pads, rather than emitting 2026-1-5', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('keeps a player on their own date after UTC has moved on', () => {
    // The bug this exists to prevent: 22:30 on the 10th in New York was being
    // served the 11th's puzzle, because UTC had already turned over.
    const evening = new Date('2026-08-11T02:30:00Z')
    expect(utcDate(evening)).toBe('2026-08-11')
    expect(inZone('America/New_York', () => localDate(evening))).toBe('2026-08-10')
    expect(inZone('Pacific/Kiritimati', () => localDate(evening))).toBe('2026-08-11')
  })
})

describe('isPlausibleToday', () => {
  it('accepts the date the far side of the world is already on', () => {
    // Midday UTC: nobody is still on the 9th, and UTC+14 has reached the 11th.
    const noon = new Date('2026-08-10T12:00:00Z')
    expect(isPlausibleToday('2026-08-09', noon)).toBe(false)
    expect(isPlausibleToday('2026-08-10', noon)).toBe(true)
    expect(isPlausibleToday('2026-08-11', noon)).toBe(true)
  })

  it('accepts the date the near side of the world is still on', () => {
    // Just past UTC midnight: UTC-12 is still on the 9th, and nobody is on the
    // 11th yet.
    const small = new Date('2026-08-10T00:30:00Z')
    expect(isPlausibleToday('2026-08-09', small)).toBe(true)
    expect(isPlausibleToday('2026-08-10', small)).toBe(true)
    expect(isPlausibleToday('2026-08-11', small)).toBe(false)
  })

  it('spans three dates only while the offsets straddle two midnights', () => {
    const straddle = new Date('2026-08-10T10:00:00Z')
    for (const date of ['2026-08-09', '2026-08-10', '2026-08-11']) {
      expect(isPlausibleToday(date, straddle), date).toBe(true)
    }
    expect(isPlausibleToday('2026-08-12', straddle)).toBe(false)
  })

  it('will not read the rest of the year, which is the point of the salt', () => {
    const noon = new Date('2026-08-10T12:00:00Z')
    expect(isPlausibleToday('2027-01-01', noon)).toBe(false)
    expect(isPlausibleToday('2026-09-01', noon)).toBe(false)
  })

  it('refuses a date that is not the date it claims to be', () => {
    // 2026-02-30 parses as the 2nd of March, so without the round-trip check a
    // crafted string names a day the window was meant to exclude.
    const eve = new Date('2026-02-28T12:00:00Z')
    expect(isPlausibleToday('2026-02-30', eve)).toBe(false)
    expect(isPlausibleToday('2026-03-01', eve)).toBe(true)
  })

  it('refuses nonsense rather than throwing, since a wrong clock still plays', () => {
    const noon = new Date('2026-08-10T12:00:00Z')
    for (const bad of ['nonsense', '2026-8-10', '2026-13-45', '']) {
      expect(isPlausibleToday(bad, noon), bad).toBe(false)
    }
  })
})

describe('puzzleId', () => {
  it('numbers the epoch as day 1', () => {
    expect(puzzleId(EPOCH)).toBe(1)
  })

  it('increments by exactly one per day', () => {
    const days = dateRange('2026-02-26', 6) // across a month boundary
    const ids = days.map(puzzleId)
    expect(ids).toEqual([ids[0], ids[0] + 1, ids[0] + 2, ids[0] + 3, ids[0] + 4, ids[0] + 5])
  })

  it('stays whole across a daylight-saving transition, being UTC', () => {
    for (const date of dateRange('2026-03-27', 6)) {
      expect(Number.isInteger(puzzleId(date)), date).toBe(true)
    }
  })

  it('rejects a malformed date', () => {
    expect(() => puzzleId('9 August')).toThrow(/bad date/)
    expect(() => puzzleId('2026-13-45')).toThrow(/bad date/)
    // Well-shaped and still not a date: `new Date` rolls it to the 2nd of March
    // rather than refusing it.
    expect(() => puzzleId('2026-02-30')).toThrow(/bad date/)
  })
})

describe('difficultyFor', () => {
  it('ramps up across the week and peaks at the weekend', () => {
    // 2026-08-10 is a Monday.
    expect(dateRange('2026-08-10', 7).map(difficultyFor)).toEqual([
      'easy', // Mon
      'easy', // Tue
      'medium', // Wed
      'medium', // Thu
      'medium', // Fri
      'hard', // Sat
      'hard', // Sun
    ])
  })

  it('names a bucket the pool actually has', () => {
    for (const date of dateRange('2026-08-10', 30)) {
      expect(Object.keys(POOL[difficultyFor(date)]).length, date).toBeGreaterThan(0)
    }
  })
})

describe('the rotation', () => {
  const DIFFICULTIES = ['easy', 'medium', 'hard'] as const

  it('only ever asks for a hole the pool actually holds', () => {
    // The one check standing between a retuned weight and a day that 500s.
    // Every combination the rotation can name has to be there, in the bucket
    // that will ask for it — and `easy` deliberately names no doubled hole,
    // because the map holds none: easy is exactly `best === 3`, and two
    // barriers that each bite cannot fit underneath it.
    for (const difficulty of DIFFICULTIES) {
      for (const [combo, weight] of rotationFor(difficulty)) {
        expect(weight, `${difficulty} ${combo}`).toBeGreaterThan(0)
        expect(POOL[difficulty][combo]?.length ?? 0, `${difficulty} ${combo}`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps a plain hole a normal thing to be handed', () => {
    // Barriers are the norm, not the whole game. If `open` ever falls out of a
    // rotation entirely, the game stops ever showing anyone what the ordinary
    // shape of a hole is.
    for (const difficulty of DIFFICULTIES) {
      const menu = rotationFor(difficulty)
      const total = menu.reduce((sum, [, weight]) => sum + weight, 0)
      const open = menu.find(([combo]) => combo === 'open')?.[1] ?? 0
      expect(open / total, difficulty).toBeGreaterThan(0.15)
      expect(open / total, difficulty).toBeLessThan(0.5)
    }
  })

  it('offers every mechanic on every difficulty, at least on its own', () => {
    for (const difficulty of DIFFICULTIES) {
      const offered = new Set(rotationFor(difficulty).map(([combo]) => combo))
      for (const combo of SINGLES) {
        expect(offered.has(combo), `${difficulty} never offers ${combo}`).toBe(true)
      }
    }
  })

  it('spreads a year over enough holes not to repeat itself', () => {
    // A weight is not free: a combination drawn often out of a bucket that
    // holds few is a bucket that starts showing the same hole twice a year.
    // `bounds` on easy is the thin one — 86 holes — which is why it is
    // weighted lighter than its siblings rather than evenly.
    const DAYS_A_YEAR: Record<string, number> = { easy: 104, medium: 156, hard: 104 }
    for (const difficulty of DIFFICULTIES) {
      const menu = rotationFor(difficulty)
      const total = menu.reduce((sum, [, weight]) => sum + weight, 0)
      for (const [combo, weight] of menu) {
        const draws = (DAYS_A_YEAR[difficulty] * weight) / total
        const available = POOL[difficulty][combo].length
        expect(available / draws, `${difficulty} ${combo}`).toBeGreaterThan(5)
      }
    }
  })
})

describe('secondsUntilNextUtcDay', () => {
  it('counts down to midnight UTC', () => {
    expect(secondsUntilNextUtcDay(new Date('2026-08-09T00:00:00Z'))).toBe(86_400)
    expect(secondsUntilNextUtcDay(new Date('2026-08-09T23:59:00Z'))).toBe(60)
  })

  it('never returns zero, which would defeat caching entirely', () => {
    expect(secondsUntilNextUtcDay(new Date('2026-08-09T23:59:59.900Z'))).toBeGreaterThan(0)
  })
})

describe('pickPuzzle', () => {
  it('is deterministic — the same date and salt always give the same puzzle', async () => {
    const runs = await Promise.all([
      pickPuzzle(POOL, '2026-08-09', SALT),
      pickPuzzle(POOL, '2026-08-09', SALT),
      pickPuzzle(POOL, '2026-08-09', SALT),
    ])
    expect(runs[1]).toEqual(runs[0])
    expect(runs[2]).toEqual(runs[0])
  })

  it('gives a different puzzle for a different salt, which is the point of the secret', async () => {
    const mine = await pickPuzzle(POOL, '2026-08-09', SALT)
    const theirs = await pickPuzzle(POOL, '2026-08-09', 'a-different-salt')
    expect([theirs.start, theirs.end]).not.toEqual([mine.start, mine.end])
  })

  it('carries the right id, date and difficulty', async () => {
    const puzzle = await pickPuzzle(POOL, '2026-08-09', SALT)
    expect(puzzle.date).toBe('2026-08-09')
    expect(puzzle.id).toBe(puzzleId('2026-08-09'))
    // 2026-08-09 is a Sunday.
    expect(puzzle.best).toBeGreaterThanOrEqual(7)
  })

  it('always sets par above the shortest route, so a clean round goes under', async () => {
    for (const date of dateRange(EPOCH, 120)) {
      const puzzle = await pickPuzzle(POOL, date, SALT)
      expect(puzzle.par, date).toBe(parFor(puzzle.best, difficultyFor(date)))
      expect(puzzle.par, date).toBeGreaterThan(puzzle.best)
    }
  })

  it('only ever produces a solvable puzzle', async () => {
    for (const date of dateRange(EPOCH, 400)) {
      const puzzle = await pickPuzzle(POOL, date, SALT)
      expect(connectable(puzzle.start, puzzle.end), date).toBe(true)
      // Measured around whatever the day has shut, priced through whatever it
      // has roughened, and joining whatever it insists on reaching. Checking
      // the open graph would pass on a barrier day whose real route is longer,
      // which is exactly the bug that ships a daily nobody can finish at the
      // stated par — and with a waypoint the floor is the cheapest route
      // *through* it, which is dearer again.
      expect(floorOf(puzzle), date).toBe(puzzle.best + 1)
    }
  })

  it('never shuts, roughens or requires an endpoint, and never cuts the only way through', async () => {
    for (const date of dateRange(EPOCH, 400)) {
      const puzzle = await pickPuzzle(POOL, date, SALT)
      for (const code of [
        ...(puzzle.closed ?? []),
        ...(puzzle.rough ?? []),
        ...(puzzle.required ?? []),
      ]) {
        expect(code, date).not.toBe(puzzle.start)
        expect(code, date).not.toBe(puzzle.end)
      }
      // newGame refuses every shape the pool must never produce — a severed
      // route, a country both shut and rough, a waypoint already touching an
      // end — so building one is the end-to-end check that it never does.
      expect(() => newGame(puzzle), date).not.toThrow()
    }
  })

  it('is symmetric, so the coin that reverses a pair cannot change its par', async () => {
    // Rough is charged on arrival, so `d(a,b) - d(b,a) = rough(b) - rough(a)`.
    // With a rough endpoint one pool entry would have two different pars
    // depending on which way round the flip served it, and half of them are
    // served backwards. This is that stated as the number it would break.
    for (const date of dateRange(EPOCH, 200)) {
      const puzzle = await pickPuzzle(POOL, date, SALT)
      if (!puzzle.rough?.length) continue
      const within = without(puzzle.closed ?? [])
      const priced = new Set(puzzle.rough)
      expect(distance(puzzle.start, puzzle.end, within, priced), date).toBe(
        distance(puzzle.end, puzzle.start, within, priced),
      )
    }
  })

  it('carries a barrier often enough to be the game, and lets a plain hole through too', async () => {
    const days = await Promise.all(
      dateRange(EPOCH, 350).map((date) => pickPuzzle(POOL, date, SALT)),
    )
    const barriered = days.filter(
      (puzzle) => puzzle.closed?.length || puzzle.rough?.length || puzzle.required?.length,
    ).length
    expect(barriered).toBeGreaterThan(days.length * 0.5)
    expect(barriered).toBeLessThan(days.length * 0.9)
  })

  it('shows every mechanic inside a season, or nobody ever learns it', async () => {
    // A weight small enough that a mechanic goes months without appearing is a
    // mechanic the game may as well not have. Ninety days is a quarter of a
    // year and is meant to be generous.
    const days = await Promise.all(dateRange(EPOCH, 90).map((date) => pickPuzzle(POOL, date, SALT)))
    expect(
      days.some((p) => !p.closed && !p.rough && !p.required),
      'a plain hole',
    ).toBe(true)
    // By what the player is shown rather than by how the pool filed it. These
    // used to be `=== 1` and `> 1`, which agreed with the real line only
    // because the pool shuts exactly one country for a `closed` hole: two of
    // the curated regions are exactly `NAMED_CLOSURE_LIMIT` countries, and a
    // round shutting one of those is named one by one at the player and is a
    // closure whatever the build called it.
    expect(
      days.some((p) => mechanicsOf(p).includes('closed')),
      'a closure, named one by one',
    ).toBe(true)
    expect(
      days.some((p) => mechanicsOf(p).includes('bounds')),
      'a region out of bounds',
    ).toBe(true)
    expect(
      days.some((p) => p.rough?.length),
      'rough ground',
    ).toBe(true)
    expect(
      days.some((p) => p.required?.length),
      'a dogleg',
    ).toBe(true)
    // And at least one day carrying two of them at once.
    expect(
      days.some((p) => [p.closed, p.rough, p.required].filter((f) => f?.length).length > 1),
      'two barriers at once',
    ).toBe(true)
  })

  it('never gives a Monday or a Tuesday two barriers at once', async () => {
    // Not a preference: `easy` is exactly `best === 3` and the map holds no
    // doubled hole that short, so a rotation offering one would 500 the day.
    for (const date of dateRange(EPOCH, 400)) {
      if (difficultyFor(date) !== 'easy') continue
      const puzzle = await pickPuzzle(POOL, date, SALT)
      const carried = [puzzle.closed, puzzle.rough, puzzle.required].filter((f) => f?.length).length
      expect(carried, date).toBeLessThanOrEqual(1)
    }
  })

  it('makes every barrier bite — the open route is always shorter', async () => {
    for (const date of dateRange(EPOCH, 400)) {
      const puzzle = await pickPuzzle(POOL, date, SALT)
      if (!puzzle.closed?.length && !puzzle.rough?.length && !puzzle.required?.length) continue
      // The fairway is the standing exemption: a straight course leaves the
      // floor where it was, a bent one is priced by its closure like bounds
      // is — but no course is ever cheaper carved than open.
      if (fairwayRound(puzzle)) {
        expect(distance(puzzle.start, puzzle.end)!, date).toBeLessThanOrEqual(puzzle.best + 1)
        continue
      }
      expect(distance(puzzle.start, puzzle.end)!, date).toBeLessThan(puzzle.best + 1)
    }
  })

  it('never puts a country against itself', async () => {
    for (const date of dateRange(EPOCH, 120)) {
      const puzzle = await pickPuzzle(POOL, date, SALT)
      expect(puzzle.start, date).not.toBe(puzzle.end)
    }
  })

  it('runs some pairs backwards, so a pair does not always present the same way', async () => {
    const seen = new Set<string>()
    for (const date of dateRange(EPOCH, 60)) {
      const puzzle = await pickPuzzle(POOL, date, SALT)
      seen.add(puzzle.start < puzzle.end ? 'forward' : 'reversed')
    }
    expect(seen).toEqual(new Set(['forward', 'reversed']))
  })

  it('does not repeat itself systematically over a year', async () => {
    const dates = dateRange(EPOCH, 365)
    const puzzles = await Promise.all(dates.map((d) => pickPuzzle(POOL, d, SALT)))
    const keys = puzzles.map((p) => [p.start, p.end].sort().join('-'))

    // Each weekday draws from its own bucket, so a year is roughly 104 easy
    // draws from 841, 156 medium from 2485 and 104 hard from 2378. Birthday
    // collisions alone predict about ten repeats, and there is no dedup pass —
    // this guards against a stuck index, not against chance.
    expect(new Set(keys).size).toBeGreaterThan(340)
  })

  it('spreads across the pool rather than clustering', async () => {
    const dates = dateRange(EPOCH, 200)
    const puzzles = await Promise.all(dates.map((d) => pickPuzzle(POOL, d, SALT)))
    const countries = new Set(puzzles.flatMap((p) => [p.start, p.end]))
    expect(countries.size).toBeGreaterThan(100)
  })

  it('refuses a pool with nothing where it looked, rather than serving a blank', async () => {
    // 2026-08-09 is a Sunday, which draws from hard. Emptying every one of its
    // combinations means whichever the rotation names is missing, so this does
    // not depend on which way the digest falls.
    const stripped = Object.fromEntries(Object.keys(POOL.hard).map((combo) => [combo, []]))
    const empty = { ...POOL, hard: stripped } as unknown as PuzzlePool
    await expect(pickPuzzle(empty, '2026-08-09', SALT)).rejects.toThrow(/nothing for "hard"/)
  })
})

describe('the served record', () => {
  const dates = Object.keys(SERVED)

  it('names real dates, and none before the epoch', () => {
    for (const date of dates) {
      expect(date, date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(() => puzzleId(date), date).not.toThrow()
      expect(date >= EPOCH, date).toBe(true)
    }
  })

  it('records a day that is still playable against the map we ship', () => {
    // The record is what the site served, not what this build would choose, so
    // it is the one puzzle in the game that nothing here generated. If the map
    // ever moves under it, a player part-way through a pinned day is the one
    // who finds out — so check it here instead.
    for (const [date, puzzle] of Object.entries(SERVED)) {
      expect(floorOf(puzzle), date).toBe(puzzle.best + 1)
      expect(puzzle.par, date).toBeGreaterThan(puzzle.best)
      expect(() => newGame({ ...puzzle, id: puzzleId(date), date }), date).not.toThrow()
    }
  })

  it('answers for a pinned day instead of asking the pool', async () => {
    for (const [date, puzzle] of Object.entries(SERVED)) {
      const served = await pickPuzzle(POOL, date, SALT, SERVED)
      expect(served, date).toEqual({ ...puzzle, id: puzzleId(date), date })
    }
  })

  it('overrules a pool that would now say something else', async () => {
    // Without this the record is decoration: it has to be checked against a
    // pool that disagrees, or nothing proves it is consulted at all. The salt
    // here is not the one production serves under, so every pinned day is a
    // day the pool would answer differently.
    const disagreements = await Promise.all(
      Object.keys(SERVED).map(async (date) => {
        const fromPool = await pickPuzzle(POOL, date, SALT)
        const fromRecord = await pickPuzzle(POOL, date, SALT, SERVED)
        return JSON.stringify(fromPool) !== JSON.stringify(fromRecord)
      }),
    )
    expect(disagreements).toContain(true)
  })

  it('falls through to the pool for a day that was never served', async () => {
    const unserved = '2027-03-14'
    expect(SERVED[unserved]).toBeUndefined()
    expect(await pickPuzzle(POOL, unserved, SALT, SERVED)).toEqual(
      await pickPuzzle(POOL, unserved, SALT),
    )
  })

  it('will not let a record rewrite which day it is', async () => {
    // `id` and `date` are the calendar's to say. A record that disagreed would
    // be a record of some other day, and renumbering a day is how a share card
    // stops matching the round it came from.
    const record = {
      '2026-09-01': { start: 'FRA', end: 'POL', best: 4, par: 5, id: 999, date: '1999-01-01' },
    } as unknown as Served
    const puzzle = await pickPuzzle(POOL, '2026-09-01', SALT, record)
    expect(puzzle.id).toBe(puzzleId('2026-09-01'))
    expect(puzzle.date).toBe('2026-09-01')
  })
})

describe('parFor', () => {
  it('puts par a fixed distance above the shortest route', () => {
    expect(parFor(3, 'easy')).toBe(4)
    expect(parFor(5, 'medium')).toBe(6)
    expect(parFor(9, 'hard')).toBe(11)
  })

  it('gives every day at least one shot in hand', () => {
    // Without this a flawless round can only ever be level, which is what made
    // every good card read the same.
    for (const allowance of Object.values(ALLOWANCE)) expect(allowance).toBeGreaterThan(0)
  })

  it('saves the eagle for the hard day', () => {
    expect(ALLOWANCE.hard).toBeGreaterThan(ALLOWANCE.easy)
    expect(ALLOWANCE.hard).toBe(2)
  })
})
