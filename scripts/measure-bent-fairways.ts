/**
 * Measures bent fairway corridors, before the generator is rewritten to make
 * them.
 *
 * The first fairway pool carved around the shortest route, and the planet made
 * that samey: Earth funnels shortest routes through three land bridges, so
 * Russia sat on 39% of all corridors, Israel 39%, Egypt 38%. A bent corridor
 * runs through a chosen waypoint instead — the course is the detour, the
 * closure moves the floor exactly as `bounds` does, and the reference rounds
 * (ZAF-CIV up the east coast, the hand-built LKA-MDG coastal Horn) are this
 * shape.
 *
 * A corridor here keeps tied strands: on each leg, every country on some
 * equally-cheap route to the waypoint. The rough band is one link out and the
 * rest of the world is shut — the same derivation the builder's painted
 * fairway uses, so the daily and a hand-built round are one mechanic.
 *
 * The open questions were the bite floor, the diversity cap, how many vias a
 * pair may file, and how much of the pool stays straight — all distribution
 * questions, which is what this prints. The checkpoint chose the water-fill's
 * 800-hole prefix, and `build-data.ts` now runs that selection for real — so
 * this is the record of how the parameters were chosen, and its pool-mix
 * section reads `pairs.json` as it stood *before* the rework: rerun against a
 * regenerated pool, that section describes the selection's own output rather
 * than the straight pool it was measured against.
 *
 *   node --experimental-strip-types scripts/measure-bent-fairways.ts
 */
import { CODES, costsFrom, distance, links, type CountryCode } from '../src/game/graph.ts'
import { MAX_BEST, difficultyOf } from '../src/game/difficulty.ts'
import pairs from '../functions/data/pairs.json' with { type: 'json' }

const COSTS = new Map<CountryCode, Map<CountryCode, number>>(
  CODES.map((code) => [code, costsFrom(code)]),
)
const d = (from: CountryCode, to: CountryCode) => COSTS.get(from)!.get(to)

/** Candidate corridors per pair, before the diversity pass picks between them. */
const VIAS_PER_PAIR = 3

/** How much the closure must lengthen the route for the bend to be felt. */
const MIN_BITE = 2

/** The quality filters carried over from the straight measurement. */
const MIN_ROUGH = 8
const MIN_CLOSED = 110

type Corridor = {
  start: CountryCode
  end: CountryCode
  via: CountryCode
  best: number
  bend: number
  fairway: CountryCode[]
  rough: CountryCode[]
  closed: CountryCode[]
}

/**
 * The corridor through a waypoint, tied strands kept: on each leg, every
 * country on some equally-cheap route. Band one link out; the rest shut.
 */
function carve(start: CountryCode, end: CountryCode, via: CountryCode): Corridor | null {
  const toVia = d(start, via)
  const fromVia = d(via, end)
  if (toVia === undefined || fromVia === undefined) return null

  const course = new Set<CountryCode>()
  for (const code of CODES) {
    const a = d(start, code)
    const b = d(code, via)
    const c = d(via, code)
    const e = d(code, end)
    const onFirst = a !== undefined && b !== undefined && a + b === toVia
    const onSecond = c !== undefined && e !== undefined && c + e === fromVia
    if (onFirst || onSecond) course.add(code)
  }

  const rough: CountryCode[] = []
  const closed: CountryCode[] = []
  for (const code of CODES) {
    if (course.has(code)) continue
    if (links(code).some((other) => course.has(other))) rough.push(code)
    else closed.push(code)
  }

  const floor = distance(start, end, new Set([...course, ...rough]), new Set(rough))
  if (floor === null) return null
  return {
    start,
    end,
    via,
    best: floor - 1,
    bend: floor - d(start, end)!,
    fairway: [...course].sort(),
    rough: rough.sort(),
    closed: closed.sort(),
  }
}

/** min/p10/median/p90/max, one compact cell. */
function spread(values: number[]): string {
  if (values.length === 0) return '—'
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.floor((sorted.length - 1) * q)]
  return [at(0), at(0.1), at(0.5), at(0.9), at(1)].join('/')
}

// ---------------------------------------------------------------- generation

const candidates: Corridor[] = []
let pairsWithBend = 0
let eligiblePairs = 0

for (const [i, start] of CODES.entries()) {
  for (const end of CODES.slice(i + 1)) {
    const span = d(start, end)
    if (span === undefined) continue
    eligiblePairs++

    // Price every via by its bound, walk the biggest bends first, and keep the
    // first few whose carved board really bites. The bound over-counts (the
    // carved floor can cut through the rough), so the walk keeps going until
    // enough have survived the exact check.
    const adjacent = new Set([...links(start), ...links(end)])
    const priced = CODES.flatMap((via) => {
      if (via === start || via === end || adjacent.has(via)) return []
      const there = d(start, via)
      const back = d(via, end)
      if (there === undefined || back === undefined) return []
      const bound = there + back
      if (bound - 1 > MAX_BEST || bound - span < MIN_BITE) return []
      return [{ via, bound }]
    }).sort((one, other) => other.bound - one.bound || one.via.localeCompare(other.via))

    const kept: Corridor[] = []
    for (const { via } of priced) {
      if (kept.length >= VIAS_PER_PAIR) break
      const carved = carve(start, end, via)
      if (!carved) continue
      if (carved.best > MAX_BEST || difficultyOf(carved.best) === 'easy') continue
      if (carved.bend < MIN_BITE) continue
      if (carved.rough.length < MIN_ROUGH || carved.closed.length < MIN_CLOSED) continue
      kept.push(carved)
    }
    if (kept.length > 0) pairsWithBend++
    candidates.push(...kept)
  }
}

console.log(`${eligiblePairs} connected pairs, ${pairsWithBend} with a viable bend`)
console.log(`${candidates.length} bent corridors (up to ${VIAS_PER_PAIR} vias a pair)`)
for (const difficulty of ['medium', 'hard'] as const) {
  const ours = candidates.filter((corridor) => difficultyOf(corridor.best) === difficulty)
  console.log(
    `${difficulty}: ${ours.length} candidates  ` +
      `fairway ${spread(ours.map((c) => c.fairway.length))}  ` +
      `rough ${spread(ours.map((c) => c.rough.length))}  ` +
      `closed ${spread(ours.map((c) => c.closed.length))}  ` +
      `bend ${spread(ours.map((c) => c.bend))}`,
  )
}

// ------------------------------------------------------------ diversity pass

// The straight corridors already committed to the pool enter the same
// selection as bend-0 candidates, so the bent/straight mix falls out of the
// spread rather than being a second dial.
type Filed = Corridor & { straight: boolean }
const pool = pairs as unknown as Record<
  string,
  Record<string, [string, string, number, string[], string[]][]>
>
const straight: Filed[] = ['medium', 'hard'].flatMap((difficulty) =>
  pool[difficulty].fairway.map(([start, end, best, fairway, rough]) => ({
    start,
    end,
    via: '—',
    best,
    bend: 0,
    fairway,
    rough,
    closed: [],
    straight: true,
  })),
)
const everything: Filed[] = [
  ...candidates.map((corridor) => ({ ...corridor, straight: false })),
  ...straight,
]

/**
 * Water-filling: passes at cap 1, 2, 3… each keeping, in a fixed order,
 * every corridor no country of which has yet been kept as often as the pass
 * allows. Early passes spread the pool across the map — a corridor of fresh
 * countries always gets in before a third run down a used trunk — and the
 * prefix at any size is the most-diverse pool of that size. Deterministic.
 */
function waterFill(): Filed[] {
  const ordered = [...everything].sort(
    (one, other) =>
      other.bend - one.bend ||
      one.start.localeCompare(other.start) ||
      one.end.localeCompare(other.end) ||
      one.via.localeCompare(other.via),
  )
  const seen = new Map<CountryCode, number>()
  const kept: Filed[] = []
  const taken = new Set<Filed>()
  for (let cap = 1; taken.size < ordered.length && cap < 400; cap++) {
    for (const corridor of ordered) {
      if (taken.has(corridor)) continue
      if (corridor.fairway.some((code) => (seen.get(code) ?? 0) >= cap)) continue
      for (const code of corridor.fairway) seen.set(code, (seen.get(code) ?? 0) + 1)
      taken.add(corridor)
      kept.push(corridor)
    }
  }
  return kept
}

const filled = waterFill()
console.log('\npool floors: hard > 156, medium > 94 (5x the annual draws at hard 30 / medium 12)')
console.log('most-diverse prefixes of the water-filled order:')
for (const size of [400, 800, 1600, 3200, filled.length]) {
  const kept = filled.slice(0, size)
  const medium = kept.filter((c) => difficultyOf(c.best) === 'medium')
  const hard = kept.filter((c) => difficultyOf(c.best) === 'hard')
  const bentShare = kept.filter((c) => !c.straight).length / kept.length

  const freq = new Map<CountryCode, number>()
  for (const corridor of kept) {
    for (const code of corridor.fairway) freq.set(code, (freq.get(code) ?? 0) + 1)
  }
  const top = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const bytes = kept.reduce(
    (sum, c) => sum + JSON.stringify([c.start, c.end, c.best, c.fairway, c.rough]).length + 1,
    0,
  )
  console.log(
    `first ${String(size).padStart(5)}: medium ${medium.length}, hard ${hard.length}, ` +
      `${Math.round(bentShare * 100)}% bent, ` +
      `top trunks ${top.map(([code, n]) => `${code} ${Math.round((100 * n) / kept.length)}%`).join(' ')}, ` +
      `+${Math.round(bytes / 1024)} KB`,
  )
}

// ------------------------------------------------------------------- samples

const shown = filled.slice(0, 1600)
console.log(`\nsamples from the first 1600, spread across the list:`)
for (const q of [0, 0.12, 0.25, 0.37, 0.5, 0.62, 0.75, 0.87, 0.99]) {
  const corridor = shown[Math.floor((shown.length - 1) * q)]
  const { start, end, via, best, bend, fairway, rough } = corridor
  console.log(
    `  ${start}->${end} via ${via}: best ${best} (bend +${bend}) ` +
      `f${fairway.length} r${rough.length}  [${fairway.join(' ')}]`,
  )
}

// The two reference rounds, if the rules admit them.
for (const [start, end, via] of [
  ['CIV', 'ZAF', 'DJI'],
  ['ESP', 'IND', 'ALB'],
] as const) {
  const carved = carve(start, end, via)
  if (!carved) continue
  console.log(
    `\nreference ${start}->${end} via ${via}: best ${carved.best} (bend +${carved.bend}) ` +
      `f${carved.fairway.length} r${carved.rough.length} c${carved.closed.length}`,
  )
  console.log(`  fairway: ${carved.fairway.join(' ')}`)
}
