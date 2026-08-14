/**
 * What actually got committed to `functions/data/pairs.json`.
 *
 * `scripts/build-data.ts` asserts as it generates; this asserts against the
 * artefact, which is what the game will really load. The two are deliberately
 * different code: the build searches a flattened table of indices, and this
 * relaxes every link until nothing improves. A second opinion is only worth
 * having if it can be wrong in different ways.
 *
 * Its own file rather than a section of `data.test.ts` because it is the slow
 * one — fifty thousand holes, each re-searched from scratch — and vitest runs
 * files in parallel but the tests inside one in sequence. Split per combination
 * for the same reason, and so that a failure names the mechanic that broke.
 */
import { describe, expect, it } from 'vitest'
import graph from './graph.json' with { type: 'json' }
import pairs from '../../functions/data/pairs.json' with { type: 'json' }
import { BUCKETS, MAX_BEST, MIN_BEST } from '../game/difficulty'
import { COMBOS, TAIL, entryOf, holeOf, type Combo, type Entry, type Hole } from '../game/pool'
import { FAIRWAY_LIMIT } from '../game/rules'
import { ROUGH_COST, SEA_COST } from '../game/terrain'
import builtRegions from './regions.json' with { type: 'json' }

type Node = { borders: string[]; sea: string[]; component: number }

const nodes = graph as unknown as Record<string, Node>
const pool = pairs as unknown as Record<string, Record<string, Entry[]>>

const NONE: ReadonlySet<string> = new Set()

/**
 * Cheapest costs from `from` to everywhere, by relaxing every link until
 * nothing improves.
 *
 * Too slow to ship and too simple to get wrong. It runs once per pool entry —
 * three times for a hole with a waypoint — so it avoids allocating inside the
 * loop, which is the whole difference between a few seconds and half a minute.
 *
 * The rough is charged on arriving, never on the link, which is what makes the
 * result directional. That is not an oddity to work around: it is the reason no
 * endpoint may ever be rough, and there is a test below that says so.
 */
function costsFrom(
  from: string,
  closed: ReadonlySet<string> = NONE,
  rough: ReadonlySet<string> = NONE,
): Map<string, number> {
  const best = new Map<string, number>([[from, 0]])
  let moved = true
  while (moved) {
    moved = false
    // Entries added mid-iteration are visited by the same pass, which is only
    // ever a shortcut: the loop still ends when nothing improves.
    for (const [code, so_far] of best) {
      if (closed.has(code)) continue
      const node = nodes[code]
      for (const other of node.borders) {
        if (closed.has(other)) continue
        const step = 1 + (rough.has(other) ? ROUGH_COST - 1 : 0)
        if (so_far + step < (best.get(other) ?? Number.POSITIVE_INFINITY)) {
          best.set(other, so_far + step)
          moved = true
        }
      }
      for (const other of node.sea) {
        if (closed.has(other)) continue
        const step = SEA_COST + (rough.has(other) ? ROUGH_COST - 1 : 0)
        if (so_far + step < (best.get(other) ?? Number.POSITIVE_INFINITY)) {
          best.set(other, so_far + step)
          moved = true
        }
      }
    }
  }
  return best
}

function distance(
  from: string,
  to: string,
  closed?: ReadonlySet<string>,
  rough?: ReadonlySet<string>,
): number | null {
  if (closed?.has(from) || closed?.has(to)) return null
  return costsFrom(from, closed, rough).get(to) ?? null
}

/**
 * The open graph, searched once per country rather than once per hole. Every
 * barrier has to be checked against the route it lengthened, and forty thousand
 * of those questions are about the same 165 open searches.
 */
const OPEN = new Map<string, Map<string, number>>()
function openDistance(from: string, to: string): number | null {
  let costs = OPEN.get(from)
  if (!costs) {
    costs = costsFrom(from)
    OPEN.set(from, costs)
  }
  return costs.get(to) ?? null
}

/**
 * Report every hole that breaks a rule, rather than asserting on each in turn.
 *
 * Fifty thousand `expect` calls cost several seconds all by themselves, and
 * they report the first offender rather than the shape of the problem. This
 * asserts once and names up to ten, which is the difference between "one hole
 * is wrong" and "every rough hole is wrong".
 */
function none(broken: string[]): void {
  expect(broken.slice(0, 10), `${broken.length} holes break this`).toEqual([])
}

/**
 * The floor for a hole with a waypoint: the cheapest route that goes in one
 * border of it and out another, or `null` where no such route exists.
 *
 * Its own implementation, like everything else here. The build finds this as a
 * minimum-cost flow over flattened index arrays and re-derives it with
 * Suurballe; this builds the split graph out of `nodes` directly and augments
 * twice with a plain queue relaxation. Three readings of one definition, and a
 * second opinion is only worth having if it can be wrong in different ways.
 *
 * Countries split in two — `>X` to arrive, `<X` to leave — with one unit of
 * capacity between the halves, which is what keeps the two paths apart. Nothing
 * passes through an end or the waypoint itself; both ends drain into one sink,
 * a unit apiece, so the two paths cannot run to the same place.
 */
const VIA_ARCS = (() => {
  const codes = Object.keys(nodes)
  const at = new Map(codes.map((code, index) => [code, index]))
  const enter = (index: number) => index * 2
  const leave = (index: number) => index * 2 + 1
  const sink = codes.length * 2
  const tail: number[] = []
  const tip: number[] = []
  const base: number[] = []
  const split: number[] = []
  const drain: number[] = []
  const arc = (from: number, to: number, weight: number) => {
    tail.push(from)
    tip.push(to)
    base.push(weight)
    tail.push(to)
    tip.push(from)
    base.push(-weight)
  }
  for (const code of codes) {
    split.push(tail.length)
    arc(enter(at.get(code)!), leave(at.get(code)!), 0)
    for (const other of [...nodes[code].borders, ...nodes[code].sea].sort()) {
      if (!at.has(other)) continue
      arc(
        leave(at.get(code)!),
        enter(at.get(other)!),
        nodes[code].sea.includes(other) ? SEA_COST : 1,
      )
    }
  }
  for (const code of codes) {
    drain.push(tail.length)
    arc(enter(at.get(code)!), sink, 0)
  }
  return { codes, at, tail, tip, base, split, drain, sink, enter }
})()

function viaCost(
  start: string,
  end: string,
  via: string,
  closed: ReadonlySet<string> = NONE,
  rough: ReadonlySet<string> = NONE,
): number | null {
  const { at, tail, tip, base, split, drain, sink } = VIA_ARCS
  const [from, to, turn] = [at.get(start), at.get(end), at.get(via)]
  if (from === undefined || to === undefined || turn === undefined) return null

  const cap = base.map((_, arc) => (arc % 2 === 0 ? 1 : 0))
  const cost = [...base]
  for (const [code, index] of at) {
    if (rough.has(code)) {
      cost[split[index]] = ROUGH_COST - 1
      cost[split[index] + 1] = -(ROUGH_COST - 1)
    }
    if (closed.has(code)) cap[split[index]] = 0
    cap[drain[index]] = 0
  }
  for (const index of [from, to, turn]) cap[split[index]] = 0
  cap[drain[from]] = 1
  cap[drain[to]] = 1

  const out: number[][] = Array.from({ length: sink + 1 }, () => [])
  for (let arc = 0; arc < tail.length; arc++) out[tail[arc]].push(arc)

  const source = turn * 2 + 1
  let total = 0
  for (let unit = 0; unit < 2; unit++) {
    const best = new Array(sink + 1).fill(Infinity)
    const came = new Array(sink + 1).fill(-1)
    best[source] = 0
    const pending = [source]
    const queued = new Array(sink + 1).fill(false)
    queued[source] = true
    for (let head = 0; head < pending.length; head++) {
      const node = pending[head]
      queued[node] = false
      for (const arc of out[node]) {
        if (cap[arc] <= 0) continue
        const reach = best[node] + cost[arc]
        if (reach >= best[tip[arc]]) continue
        best[tip[arc]] = reach
        came[tip[arc]] = arc
        if (queued[tip[arc]]) continue
        queued[tip[arc]] = true
        pending.push(tip[arc])
      }
    }
    if (!Number.isFinite(best[sink])) return null
    total += best[sink]
    for (let node = sink; node !== source; node = tail[came[node]]) {
      cap[came[node]] -= 1
      cap[came[node] ^ 1] += 1
    }
  }
  return total
}

/** Cheapest route over land borders only, ignoring every crossing. */
function landDistance(from: string, to: string, closed: ReadonlySet<string> = NONE): number | null {
  if (closed.has(from) || closed.has(to)) return null
  const seen = new Map([[from, 0]])
  const queue = [from]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    if (current === to) return seen.get(current)!
    for (const neighbour of nodes[current].borders) {
      if (seen.has(neighbour) || closed.has(neighbour)) continue
      seen.set(neighbour, seen.get(current)! + 1)
      queue.push(neighbour)
    }
  }
  return null
}

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const

/** Every hole in the pool, with where it was filed. */
const all: Array<{ difficulty: string; combo: Combo; hole: Hole }> = []
for (const difficulty of DIFFICULTIES) {
  for (const combo of COMBOS) {
    for (const entry of pool[difficulty][combo] ?? []) {
      all.push({ difficulty, combo, hole: holeOf(combo, entry) })
    }
  }
}

const setOf = (codes?: string[]) => (codes?.length ? new Set(codes) : undefined)

/**
 * Room for the searches to be slow.
 *
 * Fifty thousand independent re-searches take about six seconds here, and the
 * per-combination split keeps the worst single test near a second and a half.
 * Vitest's default ceiling is five, and CI has two cores — near enough that a
 * loaded runner would fail this on timing rather than on anything being wrong.
 * The work is bounded and known; the clock it runs against should not be the
 * thing that decides.
 */
const SLOW = 30_000

describe('pairs.json', () => {
  it('is filed under exactly the difficulties and combinations the game asks for', () => {
    expect(Object.keys(pool).sort()).toEqual([...DIFFICULTIES].sort())
    for (const difficulty of DIFFICULTIES) {
      expect(Object.keys(pool[difficulty]).sort(), difficulty).toEqual([...COMBOS].sort())
    }
  })

  it('holds every hole the pool held before the barriers were added', () => {
    // The strongest statement available that regenerating moved nothing it did
    // not mean to. The pool used to be 14,484 entries — 8,047 played open and
    // 6,437 with a country shut — and those are exactly the two combinations
    // that existed then. Both are still generated by the same rules, so both
    // still come out at exactly those counts.
    const count = (combo: Combo) =>
      DIFFICULTIES.reduce((sum, difficulty) => sum + pool[difficulty][combo].length, 0)
    expect(count('open')).toBe(8047)
    expect(count('closed')).toBe(6437)
  })

  it('offers enough of every hole a rotation can ask for', () => {
    // `easy` holds no doubled hole and is not meant to: it is exactly
    // `best === 3`, and two barriers that each bite cannot fit underneath it.
    // Everything the rotation in `src/game/daily.ts` can name has to be here in
    // quantity, and `daily.test.ts` is what checks the two lists agree.
    for (const difficulty of DIFFICULTIES) {
      for (const combo of COMBOS) {
        if (TAIL[combo].length > 1 && difficulty === 'easy') continue
        expect(pool[difficulty][combo].length, `${difficulty} ${combo}`).toBeGreaterThan(50)
      }
    }
  })

  // One test per combination: fifty thousand independent searches is well past
  // vitest's five-second default if they run as one, and a failure that names
  // the mechanic is worth more than one that names an index.
  for (const combo of COMBOS) {
    it(
      `solves every ${combo} hole in exactly its route length`,
      () => {
        const holes = all.filter((held) => held.combo === combo)
        expect(holes.length, combo).toBeGreaterThan(0)

        const broken: string[] = []
        for (const { hole } of holes) {
          const { start, end, best } = hole
          const closed = setOf(hole.closed)
          const rough = setOf(hole.rough)
          const floor = hole.required?.length
            ? viaCost(start, end, hole.required[0], closed, rough)
            : distance(start, end, closed, rough)
          if (floor !== best + 1) broken.push(`${start}->${end} claims ${best + 1}, costs ${floor}`)
        }
        none(broken)
      },
      SLOW,
    )
  }

  it(
    'makes every barrier bite, so none of them is decoration',
    () => {
      // A barrier that leaves the route alone is a hole with some countries
      // coloured in. One that severs it is a hole with no answer. Both are build
      // bugs, and the second is the one that ships a daily nobody can finish.
      const broken: string[] = []
      for (const { combo, hole } of all) {
        if (TAIL[combo].length === 0) continue
        const open = openDistance(hole.start, hole.end)
        // The one exemption, in both directions at once: a straight course
        // holds every cheapest route and leaves the floor exactly where it
        // was, while a bent one is priced by its closure like `bounds` is.
        // What no course may ever be is cheaper carved than open — the floor
        // test above has already pinned `best + 1` against the carved board.
        if (combo === 'fairway') {
          if (open === null || open > hole.best + 1) {
            broken.push(`fairway ${hole.start}->${hole.end} open ${open}, claims ${hole.best + 1}`)
          }
          continue
        }
        if (open === null || open >= hole.best + 1) {
          broken.push(
            `${combo} ${hole.start}->${hole.end} open ${open}, barriered ${hole.best + 1}`,
          )
        }
      }
      none(broken)
    },
    SLOW,
  )

  it('never shuts, roughens or requires an endpoint, or a country off the map', () => {
    const broken: string[] = []
    for (const { combo, hole } of all) {
      const { start, end } = hole
      for (const code of [
        ...(hole.closed ?? []),
        ...(hole.rough ?? []),
        ...(hole.required ?? []),
      ]) {
        if (!nodes[code]) broken.push(`${combo} ${start}->${end} names ${code}, not a country`)
        if (code === start || code === end) {
          broken.push(`${combo} ${start}->${end} names ${code}, its own endpoint`)
        }
      }
    }
    none(broken)
  })

  it('never asks for a country it has also shut, or roughened one it has shut', () => {
    const broken: string[] = []
    for (const { combo, hole } of all) {
      const closed = new Set(hole.closed ?? [])
      const rough = new Set(hole.rough ?? [])
      const where = `${combo} ${hole.start}->${hole.end}`
      for (const code of rough) {
        if (closed.has(code)) broken.push(`${where} both shuts and roughens ${code}`)
      }
      for (const code of hole.required ?? []) {
        if (closed.has(code)) broken.push(`${where} both shuts and requires ${code}`)
        if (rough.has(code)) broken.push(`${where} both roughens and requires ${code}`)
        // A waypoint next door to an endpoint plays itself on the opening beat.
        const touches = [...nodes[code].borders, ...nodes[code].sea]
        if (touches.includes(hole.start) || touches.includes(hole.end)) {
          broken.push(`${where} requires ${code}, which already touches an endpoint`)
        }
      }
    }
    none(broken)
  })

  it(
    'costs the same from either end, which is what the reversing coin needs',
    () => {
      // `pickPuzzle` runs half the pool's pairs backwards. Rough is charged on
      // arrival, so `d(a,b) - d(b,a) = rough(b) - rough(a)` — with a rough
      // endpoint one entry would have two different pars depending on the flip.
      // Sampled, because this is three searches a hole and the guarantee is
      // structural: no endpoint is rough, checked above on every last one.
      const roughHoles = all
        .filter(({ hole }) => hole.rough?.length)
        .filter((_, at) => at % 53 === 0)
      expect(roughHoles.length).toBeGreaterThan(50)

      for (const { combo, hole } of roughHoles) {
        const closed = setOf(hole.closed)
        const rough = setOf(hole.rough)
        expect(
          distance(hole.start, hole.end, closed, rough),
          `${combo} ${hole.start} -> ${hole.end}`,
        ).toBe(distance(hole.end, hole.start, closed, rough))
      }
    },
    SLOW,
  )

  it('only ever roughens or rules out a whole named region', () => {
    // One rough country is worth exactly one stroke and can never be worth
    // more — you can always walk through it for +1 — so a lone rough country is
    // not a tradeoff at all. Only a region makes going round worth weighing.
    //
    // Checked as an exact set rather than as a count, and the difference is not
    // pedantry: a set that is *nearly* the Maghreb costs the same to cross and
    // is not the Maghreb, so `regionOf` will not name it and the banner falls
    // back to greying anonymous shapes. Cost alone cannot tell the two apart —
    // this is the only thing that can.
    const named = new Set(
      (builtRegions as Array<{ countries: string[] }>).map((region) =>
        [...region.countries].sort().join('+'),
      ),
    )
    const isRegion = (codes: string[]) => named.has([...codes].sort().join('+'))

    const broken: string[] = []
    for (const { combo, hole } of all) {
      // The fairway is the standing exception on both counts: its rough is the
      // band of near-optimal ground beside the spine and its closure is most
      // of the planet — neither is, or should be, a named region. Its own
      // shape is pinned by the fairway test below.
      if (combo === 'fairway') continue
      const where = `${combo} ${hole.start}->${hole.end}`
      if (hole.rough?.length && !isRegion(hole.rough)) {
        broken.push(`${where} roughens ${hole.rough.join(',')}, which is no region`)
      }
      // `bounds` rules out a whole place; `closed` shuts exactly one country.
      // They are different mechanics rather than one at two sizes, and the
      // rotation rations them apart, so the pool has to keep them apart too.
      if (combo.startsWith('bounds') && !isRegion(hole.closed ?? [])) {
        broken.push(`${where} shuts ${hole.closed?.join(',')}, which is no region`)
      }
      if (combo.startsWith('closed') && hole.closed?.length !== 1) {
        broken.push(`${where} shuts ${hole.closed?.length} countries, not one`)
      }
    }
    none(broken)
  })

  it('carves every fairway hole as a course, in canonical order', () => {
    // Four facts the mechanic rests on. The closure must sit above
    // `FAIRWAY_LIMIT` or the browser would read the day as `bounds` and
    // explain a region instead of a course; there must be a rough band or the
    // hole is bounds at scale wearing the wrong copy; both lists must be
    // alphabetical, because the share invariant is deep equality over the
    // rebuilt puzzle — order included — and the complement a link decodes to
    // is sorted; and the fairway alone, band shut too, must already play at
    // the claimed floor — the rough is an option on the outskirts, never the
    // answer, or the course is a decoy and par belongs to the shortcut.
    const inOrder = (codes: string[]) => codes.every((code, at) => at === 0 || codes[at - 1] < code)

    const broken: string[] = []
    for (const { combo, hole } of all) {
      if (combo !== 'fairway') continue
      const where = `fairway ${hole.start}->${hole.end}`
      if ((hole.closed?.length ?? 0) <= FAIRWAY_LIMIT) {
        broken.push(`${where} shuts ${hole.closed?.length}, too few to classify as a fairway`)
      }
      if (!hole.rough?.length) broken.push(`${where} has no rough band`)
      if (!inOrder(hole.closed ?? []) || !inOrder(hole.rough ?? [])) {
        broken.push(`${where} lists are not in canonical order`)
      }
      const fairwayOnly = distance(
        hole.start,
        hole.end,
        new Set([...(hole.closed ?? []), ...(hole.rough ?? [])]),
      )
      if (fairwayOnly !== hole.best + 1) {
        broken.push(
          `${where} needs its rough: fairway-only floor ${fairwayOnly}, best ${hole.best}`,
        )
      }
    }
    none(broken)
  })

  it('round-trips a fairway hole through its complement encoding', () => {
    // The wire carries the open ground — corridor, then band — and the closed
    // list is derived on decode. Encode-then-decode must reproduce the hole
    // exactly, order included, and the wire form must actually be the small
    // one, or the complement is costing bytes instead of saving them.
    const sample = all.find((held) => held.combo === 'fairway')!.hole
    const entry = entryOf('fairway', sample)
    const wired = entry[3] as string[]
    expect(wired.length + sample.closed!.length).toBe(
      Object.keys(nodes).length - sample.rough!.length,
    )
    expect(wired.length).toBeLessThan(sample.closed!.length)
    expect(holeOf('fairway', entry)).toEqual(sample)
  })

  it(
    'still holds every hole the land game had, at the same length',
    () => {
      // The forest property in the build says crossings cannot shorten an
      // existing route. This is that claim stated as a number, over exactly the
      // holes it was first measured on: the two combinations the pool had before
      // any of the new barriers existed.
      const landOnly = all.filter(({ combo, hole }) => {
        if (combo !== 'open' && combo !== 'closed') return false
        const byLand = landDistance(hole.start, hole.end, setOf(hole.closed))
        return byLand !== null && byLand === hole.best + 1
      })
      expect(landOnly.length).toBe(11008)
    },
    SLOW,
  )

  it('offers puzzles that need the water, and plenty that do not', () => {
    // A crossing that never comes up is a mechanic nobody meets; one that comes
    // up constantly stops the land game being the game.
    const wet = all.filter(
      ({ hole }) => nodes[hole.start].sea.length > 0 || nodes[hole.end].sea.length > 0,
    )
    expect(wet.length).toBeGreaterThan(all.length * 0.05)
    expect(wet.length).toBeLessThan(all.length * 0.6)
  })

  it('never crosses components, so no puzzle is ever impossible', () => {
    none(
      all
        .filter(({ hole }) => nodes[hole.start].component !== nodes[hole.end].component)
        .map(({ hole }) => `${hole.start}->${hole.end} spans two components`),
    )
  })

  it('keeps the route length inside the playable range', () => {
    none(
      all
        .filter(({ hole }) => hole.best < MIN_BEST || hole.best > MAX_BEST)
        .map(({ hole }) => `${hole.start}->${hole.end} is ${hole.best}`),
    )
  })

  it('lists each hole once, alphabetically ordered', () => {
    // A pair appears many times over — open, with a country shut, with a region
    // rough, with a waypoint — because those are all different holes. What it
    // carries is part of its identity, so the key has to be too.
    const seen = new Set<string>()
    const broken: string[] = []
    for (const { hole } of all) {
      const key = [
        hole.start,
        hole.end,
        (hole.closed ?? []).join('+'),
        (hole.rough ?? []).join('+'),
        (hole.required ?? []).join('+'),
      ].join('|')
      if (hole.start.localeCompare(hole.end) >= 0) broken.push(`${key} is not in order`)
      if (seen.has(key)) broken.push(`${key} appears twice`)
      seen.add(key)
    }
    none(broken)
  })

  it('sorts each hole into the right bucket, by how it plays rather than how it would open', () => {
    // A hole is bucketed by its barriered route length, not its open one, so a
    // pair too short to be a puzzle at all can be a perfectly good hard hole
    // once a country is shut.
    const broken: string[] = []
    for (const { difficulty, combo, hole } of all) {
      const [floor, ceiling] = BUCKETS[difficulty as keyof typeof BUCKETS]
      if (hole.best < floor || hole.best > ceiling) {
        broken.push(`${difficulty} ${combo} ${hole.start}->${hole.end} is ${hole.best}`)
      }
    }
    none(broken)
  })
})
