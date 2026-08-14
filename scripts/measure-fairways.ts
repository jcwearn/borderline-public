/**
 * Measures what fairway days would look like, before any are built.
 *
 * A fairway day carves the world into three by how far out of the way each
 * country is: `slack(v) = d(start, v) + d(v, end) - d(start, end)`, in cost
 * units. Slack at most F is the fairway, slack at most R is the rough band
 * around it, and everything further — including anything unreachable — is out
 * of bounds. Endpoints have slack 0, so they are always on the fairway; the
 * open shortest routes all have slack 0 too, so the floor never moves. The
 * open questions are the two slacks and the quality filters, and they are
 * questions about distributions, which is what this script prints.
 *
 * Read-only and stdout-only: it writes nothing, and it deliberately does not
 * import `scripts/build-data.ts`, whose top level runs the whole pipeline. It
 * reads the browser's own graph instead, the way `build-og.ts` does.
 *
 *   node --experimental-strip-types scripts/measure-fairways.ts
 */
import { CODES, costsFrom, shortestPath, type CountryCode } from '../src/game/graph.ts'
import { BUCKETS, MAX_BEST, difficultyOf, type Difficulty } from '../src/game/difficulty.ts'
// Not `src/game/regions.ts`: its relative imports carry no extensions, so it
// resolves only under the bundler. The committed data is the same list.
import regions from '../src/data/regions.json' with { type: 'json' }

/**
 * The carvings under consideration.
 *
 * `slack` puts every country within F of optimal on the fairway — which keeps
 * every tied route, so where two coasts tie the fairway holds both. `spine`
 * instead takes exactly one canonical shortest path (the game's own
 * stable-tie-break route) as the fairway and demotes every other near-optimal
 * country to the rough — the hand-built ZAF-CIV round is this shape, the west
 * coast chosen and the east coast made expensive. Both leave the floor where
 * it was: the spine survives intact and unpriced.
 */
type Carving =
  | { mode: 'slack'; fairwaySlack: number; roughSlack: number }
  | { mode: 'spine'; roughSlack: number }

const GRID: ReadonlyArray<Carving> = [
  ...[0, 1, 2].flatMap((f) =>
    [1, 2, 3].map((extra) => ({ mode: 'slack', fairwaySlack: f, roughSlack: f + extra }) as const),
  ),
  ...[1, 2, 3].map((r) => ({ mode: 'spine', roughSlack: r }) as const),
]

function carvingName(carving: Carving): string {
  return carving.mode === 'spine'
    ? `SPINE R=${carving.roughSlack}`
    : `F=${carving.fairwaySlack} R=${carving.roughSlack}`
}

/**
 * Candidate quality filters, loosest first. A hole with no rough band is just
 * bounds at scale; a sprawling fairway is not a corridor; and a closure that
 * shuts less than half the world undercuts "everything else is out".
 */
const FILTERS = [
  { name: 'loose', minRough: 1, maxFairway: 40, minClosed: 60 },
  { name: 'corridor', minRough: 5, maxFairway: 25, minClosed: 90 },
  { name: 'tight', minRough: 8, maxFairway: 18, minClosed: 110 },
] as const

/**
 * Pool-size floors implied by the two rotation proposals: `daily.test.ts`
 * requires pool size over five times the annual draws for every (difficulty,
 * combo) the rotation names. Medium has 156 draws a year, hard 104, and the
 * weights are out of each row's own total of 100.
 */
const FLOORS = [
  { name: 'hard-heavy (hard 40 / medium 7)', medium: 5 * 156 * 0.07, hard: 5 * 104 * 0.4 },
  { name: 'gentler (hard 30 / medium 12)', medium: 5 * 156 * 0.12, hard: 5 * 104 * 0.3 },
] as const

/** The two hand-built reference rounds, decoded from Jackson's `?g=` links. */
const HAND_BUILT = 'ZAF-CIV hand-built for comparison: closed 10, rough 23, rest of world open'

const COSTS = new Map<CountryCode, Map<CountryCode, number>>(
  CODES.map((code) => [code, costsFrom(code)]),
)

type Pair = { start: CountryCode; end: CountryCode; best: number; difficulty: Difficulty }

const pairs: Pair[] = []
for (const [i, start] of CODES.entries()) {
  const from = COSTS.get(start)!
  for (const end of CODES.slice(i + 1)) {
    const span = from.get(end)
    if (span === undefined) continue
    const best = span - 1
    // Easy is excluded by design: a fairway day is never easy.
    if (best < BUCKETS.medium[0] || best > MAX_BEST) continue
    pairs.push({ start, end, best, difficulty: difficultyOf(best) })
  }
}

type Carved = { fairway: CountryCode[]; rough: CountryCode[]; closed: CountryCode[] }

/** Partition every country. `CODES` is alphabetical, so each list is sorted. */
function carve(pair: Pair, carving: Carving): Carved {
  const from = COSTS.get(pair.start)!
  const to = COSTS.get(pair.end)!
  const span = pair.best + 1
  const spine =
    carving.mode === 'spine' ? new Set(shortestPath(pair.start, pair.end) ?? []) : undefined
  const fairway: CountryCode[] = []
  const rough: CountryCode[] = []
  const closed: CountryCode[] = []
  for (const code of CODES) {
    const there = from.get(code)
    const back = to.get(code)
    const slack =
      there === undefined || back === undefined ? Number.POSITIVE_INFINITY : there + back - span
    const onFairway = carving.mode === 'spine' ? spine!.has(code) : slack <= carving.fairwaySlack
    if (onFairway) fairway.push(code)
    else if (slack <= carving.roughSlack) rough.push(code)
    else closed.push(code)
  }
  return { fairway, rough, closed }
}

function accepts(filter: (typeof FILTERS)[number], carved: Carved): boolean {
  return (
    carved.rough.length >= filter.minRough &&
    carved.fairway.length <= filter.maxFairway &&
    carved.closed.length >= filter.minClosed
  )
}

/** min/p10/median/p90/max over a list, as one compact cell. */
function spread(values: number[]): string {
  if (values.length === 0) return '—'
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.floor((sorted.length - 1) * q)]
  const shown = [at(0), at(0.1), at(0.5), at(0.9), at(1)]
  return shown.map((v) => (Number.isInteger(v) ? v : v.toFixed(1))).join('/')
}

/** What this hole would add to `pairs.json`, in the pool's own entry shape. */
function entryBytes(pair: Pair, carved: Carved): number {
  return JSON.stringify([pair.start, pair.end, pair.best, carved.closed, carved.rough]).length + 1
}

/** The same hole with the fairway stored and the closure derived: ~4x smaller. */
function complementBytes(pair: Pair, carved: Carved): number {
  return JSON.stringify([pair.start, pair.end, pair.best, carved.fairway, carved.rough]).length + 1
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`
}

const byDifficulty = (wanted: Difficulty) => (pair: Pair) => pair.difficulty === wanted

console.log(`${CODES.length} countries, ${pairs.length} eligible pairs (open best 4-10):`)
console.log(
  `  medium ${pairs.filter(byDifficulty('medium')).length}, hard ${pairs.filter(byDifficulty('hard')).length}`,
)
console.log('pool floors (size must exceed 5x annual draws):')
for (const floor of FLOORS) {
  console.log(`  ${floor.name}: medium > ${floor.medium}, hard > ${floor.hard}`)
}
const largestRegion = Math.max(...regions.map((region) => region.countries.length))
console.log(`largest curated region: ${largestRegion} countries (FAIRWAY_LIMIT candidate: 40)`)
console.log(HAND_BUILT)

for (const carving of GRID) {
  console.log(`\n== ${carvingName(carving)} ==`)
  const carvedPairs = pairs.map((pair) => ({ pair, carved: carve(pair, carving) }))

  for (const difficulty of ['medium', 'hard'] as const) {
    const ours = carvedPairs.filter(({ pair }) => pair.difficulty === difficulty)
    const of = (picked: (carved: Carved, pair: Pair) => number) =>
      spread(ours.map(({ pair, carved }) => picked(carved, pair)))
    console.log(
      `${difficulty}: fairway ${of((c) => c.fairway.length)}  rough ${of((c) => c.rough.length)}  ` +
        `closed ${of((c) => c.closed.length)}  width ${of((c, p) => c.fairway.length / (p.best + 2))}`,
    )
  }

  for (const filter of FILTERS) {
    const kept = carvedPairs.filter(({ carved }) => accepts(filter, carved))
    const medium = kept.filter(({ pair }) => pair.difficulty === 'medium')
    const hard = kept.filter(({ pair }) => pair.difficulty === 'hard')
    const bytes = kept.reduce((sum, { pair, carved }) => sum + entryBytes(pair, carved), 0)
    const compact = kept.reduce((sum, { pair, carved }) => sum + complementBytes(pair, carved), 0)
    const minClosed =
      kept.length === 0 ? '—' : Math.min(...kept.map(({ carved }) => carved.closed.length))
    console.log(
      `  ${filter.name.padEnd(8)} (rough>=${filter.minRough}, fairway<=${filter.maxFairway}, closed>=${filter.minClosed}): ` +
        `medium ${medium.length}, hard ${hard.length} ` +
        `(${Math.round((kept.length / pairs.length) * 100)}% of pairs), ` +
        `min closed ${minClosed}, +${kb(bytes)} storing closed / +${kb(compact)} storing fairway`,
    )
    for (const [label, bucket] of [
      ['medium', medium],
      ['hard', hard],
    ] as const) {
      if (bucket.length === 0) continue
      const picks = [1 / 6, 3 / 6, 5 / 6].map((q) => bucket[Math.floor((bucket.length - 1) * q)])
      const shown = picks
        .map(
          ({ pair, carved }) =>
            `${pair.start}-${pair.end} best ${pair.best}: f${carved.fairway.length} r${carved.rough.length} c${carved.closed.length}`,
        )
        .join(' | ')
      console.log(`    ${label} samples: ${shown}`)
    }
  }

  const reference = carvedPairs.find(({ pair }) => pair.start === 'CIV' && pair.end === 'ZAF')
  if (reference) {
    const { pair, carved } = reference
    console.log(`  ZAF-CIV (best ${pair.best}): fairway [${carved.fairway.join(' ')}]`)
    console.log(
      `    rough ${carved.rough.length} [${carved.rough.join(' ')}]  closed ${carved.closed.length}`,
    )
  }
}
