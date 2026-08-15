/**
 * Turns the vendored upstream datasets into the three files the game runs on:
 *
 *   src/data/graph.json           the country graph — ships to the browser
 *   functions/data/pairs.json     the puzzle pool — server-side only
 *   public/countries-110m.json    globe geometry, fetched at runtime
 *
 * Everything here asserts as it goes. A surprise in the source data should
 * break the build, not the game.
 *
 *   npm run build:data
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_BEST, MIN_BEST, difficultyOf, type Difficulty } from '../src/game/difficulty.ts'
import {
  COMBOS,
  TAIL,
  entryOf,
  holeOf,
  type Combo,
  type Entry,
  type Hole,
} from '../src/game/pool.ts'
import { ROUGH_COST, SEA_COST } from '../src/game/terrain.ts'
import { LINK_CODES, LINK_CODE_LIMIT } from '../src/link-codes.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Countries with no polygon in the globe geometry are dropped from the graph
 * outright, which buys the invariant the reveal mechanic depends on: every
 * country is clickable, and every clickable shape is a country.
 *
 * At 110m resolution this removes 29 — 24 islands that had no land border to
 * begin with, plus Andorra, Liechtenstein, Monaco, San Marino and Vatican City.
 * All five are dead ends whose neighbours already border each other, so none
 * can ever sit on a shortest path, and dropping them disconnects nothing.
 */
const GEOMETRY_RESOLUTION = '110m'

/**
 * Border claims the source data records in one direction only. Each is a
 * maritime link rather than a land border, so dropping them is correct — but
 * they are listed explicitly so that any *new* asymmetry fails the build.
 */
const KNOWN_ONE_WAY: ReadonlyArray<[string, string]> = [['LKA', 'IND']]

// The playable range and the route-length buckets live with par itself, in
// `src/game/daily.ts`, because the browser needs them too: free play builds a
// puzzle client-side and has to arrive at the same par the pool would. One
// definition, imported here rather than restated.

type RawCountry = {
  cca3: string
  ccn3?: string
  name: { common: string; official: string }
  altSpellings?: string[]
  borders?: string[]
  latlng?: [number, number]
  flag?: string
  unMember?: boolean
}

export type CountryNode = {
  name: string
  flag: string
  ccn3: string
  latlng: [number, number]
  alt: string[]
  borders: string[]
  sea: string[]
  component: number
}

/** A curated crossing, where it is actually made, and why it is one. */
type SeaLink = {
  link: [string, string]
  kind: 'fixed' | 'ferry' | 'strait' | 'dormant'
  /**
   * Where to draw the crossing from and to, as [lat, lng] on each side.
   *
   * The centre of the region the crossing serves — Chukotka and Alaska, Kent
   * and Hauts-de-France — rather than either extreme. Country centroids would
   * run the Bering Strait from Siberia to Kansas; the two capes themselves are
   * 82 km apart and vanish at any sensible zoom. The middle of the right region
   * points at the right place and is still long enough to see.
   */
  from: [number, number]
  to: [number, number]
  basis: string
}

/** What ships to the browser purely so the globe can draw the crossings. */
export type Crossing = { link: [string, string]; from: [number, number]; to: [number, number] }

/**
 * A named group of countries a round can put in the rough or shut altogether.
 *
 * Curated rather than generated, and that was measured rather than assumed:
 * seed-a-country-and-take-its-neighbours regions were eligible on 7,889 pairs
 * but produced a route round within a stroke of the route through — the
 * decision the mechanic exists for — on only 23% of them. The other three
 * quarters were decoration wearing a mechanic's clothes.
 *
 * Naming them buys the rest. The banner can say "the Maghreb is rough today"
 * instead of greying four anonymous shapes, the pool stores one integer instead
 * of a country list, and a link costs one byte rather than four.
 */
type Region = {
  name: string
  countries: string[]
  basis: string
}

export type Graph = Record<string, CountryNode>

function fail(message: string): never {
  throw new Error(`build-data: ${message}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

/**
 * Cheapest costs from `source`, optionally with some countries shut and some
 * priced as rough. A shut country is not reachable and cannot be routed
 * through; a rough one is both, and simply costs more to be in.
 *
 * Named `bfs` no longer, because a sea leg costs more than a land border and
 * breadth-first search cannot weigh anything. Mirrors `search` in
 * `src/game/graph.ts`, deliberately: the pool this writes and the rules the
 * browser plays by have to agree about what a route costs.
 *
 * Kept for the pass that checks the pool after it is built. Generation runs on
 * `matrixFor` below, which answers the same questions from a table — this one
 * stays the plain reading of the rules, so the check is not quite the thing
 * being checked.
 */
export function cheapest(
  links: Record<string, string[]>,
  linkCost: (from: string, to: string) => number,
  source: string,
  closed?: ReadonlySet<string>,
  rough?: ReadonlySet<string>,
): Map<string, number> {
  const best = new Map([[source, 0]])
  const settled = new Set<string>()
  const discovered = [source]

  for (;;) {
    let current: string | null = null
    let cost = Number.POSITIVE_INFINITY
    for (const code of discovered) {
      if (settled.has(code)) continue
      const so_far = best.get(code)!
      if (so_far < cost) {
        current = code
        cost = so_far
      }
    }
    if (current === null) return best

    settled.add(current)
    for (const neighbour of links[current]) {
      if (settled.has(neighbour) || closed?.has(neighbour)) continue
      // The rough is charged against the destination and not the link, so every
      // way into a rough country costs the same premium.
      const premium = rough?.has(neighbour) ? ROUGH_COST - 1 : 0
      const next = cost + linkCost(current, neighbour) + premium
      const known = best.get(neighbour)
      if (known === undefined) {
        best.set(neighbour, next)
        discovered.push(neighbour)
      } else if (next < known) {
        best.set(neighbour, next)
      }
    }
  }
}

/**
 * The cheapest route from `start` to `end` running *through* `via`, by
 * Suurballe — and its whole purpose is to be a different algorithm from the one
 * that generated the answer.
 *
 * `viaCostOf` finds the same number as a minimum-cost flow augmented by
 * Bellman–Ford. This finds it by reweighting the graph with one Dijkstra's
 * distances, so that every arc is non-negative, reversing the first path and
 * running Dijkstra again. Same definition, no shared code — which is exactly the
 * relationship this file already keeps between `cheapest` and `matrixFor`, and
 * the only kind of check worth putting under a floor that the browser will
 * independently re-derive with a third implementation.
 *
 * `undefined` where no such route exists — a waypoint with only one way in and
 * out — which is the pool's statement of the dogleg's third rule.
 *
 * Nodes are `>CODE` for arriving in a country and `<CODE` for leaving it, so the
 * one-unit capacity between them is what forces the two paths apart. `.` is the
 * sink both ends drain into.
 */
function suurballe(
  start: string,
  end: string,
  via: string,
  shut?: ReadonlySet<string>,
  priced?: ReadonlySet<string>,
): number | undefined {
  const SINK = '.'
  const arcs = new Map<string, Map<string, number>>()
  // `arc` not `join`: `join` is imported from node:path at the top of this
  // file and used throughout for real paths.
  const arc = (from: string, to: string, cost: number) => {
    if (!arcs.has(from)) arcs.set(from, new Map())
    arcs.get(from)!.set(to, cost)
  }
  const terminals = new Set([start, end, via])
  for (const code of Object.keys(graph)) {
    if (shut?.has(code)) continue
    // No unit passes *through* a terminal; the route starts, ends or turns there.
    if (!terminals.has(code)) arc(`>${code}`, `<${code}`, priced?.has(code) ? ROUGH_COST - 1 : 0)
    for (const other of links[code]) {
      if (shut?.has(other)) continue
      arc(`<${code}`, `>${other}`, linkCost(code, other))
    }
  }
  arc(`>${start}`, SINK, 0)
  arc(`>${end}`, SINK, 0)

  const source = `<${via}`
  /** Dijkstra over an arc map. Returns costs and how each node was reached. */
  const run = (over: Map<string, Map<string, number>>) => {
    const best = new Map([[source, 0]])
    const before = new Map<string, string>()
    const settled = new Set<string>()
    const seen = [source]
    for (;;) {
      let current: string | null = null
      let cost = Number.POSITIVE_INFINITY
      for (const node of seen) {
        if (settled.has(node)) continue
        if (best.get(node)! < cost) {
          current = node
          cost = best.get(node)!
        }
      }
      if (current === null) return { best, before }
      settled.add(current)
      for (const [to, weight] of over.get(current) ?? []) {
        if (settled.has(to)) continue
        const next = cost + weight
        const known = best.get(to)
        if (known === undefined) {
          best.set(to, next)
          before.set(to, current)
          seen.push(to)
        } else if (next < known) {
          best.set(to, next)
          before.set(to, current)
        }
      }
    }
  }

  const first = run(arcs)
  const reach = first.best.get(SINK)
  if (reach === undefined) return undefined

  // Every arc reweighted by the distances just found. That makes all of them
  // non-negative and every arc on the first path exactly zero, so the second
  // pass is another plain Dijkstra rather than something that has to cope with
  // the negative weight of taking a choice back.
  const shifted = new Map<string, Map<string, number>>()
  for (const [from, out] of arcs) {
    const here = first.best.get(from)
    if (here === undefined) continue
    for (const [to, cost] of out) {
      const there = first.best.get(to)
      if (there === undefined) continue
      if (!shifted.has(from)) shifted.set(from, new Map())
      shifted.get(from)!.set(to, cost + here - there)
    }
  }
  // The first path is turned round, free in either direction, which is what
  // lets the second path undo part of it and still be priced correctly.
  for (let node = SINK; node !== source;) {
    const from = first.before.get(node)
    if (from === undefined) return undefined
    shifted.get(from)?.delete(node)
    if (!shifted.has(node)) shifted.set(node, new Map())
    shifted.get(node)!.set(from, 0)
    node = from
  }

  const another = run(shifted).best.get(SINK)
  if (another === undefined) return undefined
  // Both units are shifted by the same distance, because both end at the sink.
  return reach * 2 + another
}

/** A country's own coordinates, straight from the source data. */
function graphLatLng(code: string): [number, number] {
  const found = countries.find((c) => c.cca3 === code)
  return found!.latlng as [number, number]
}

/** Kilometres between two [lat, lng] points, as the crow flies. */
function greatCircle([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const rad = Math.PI / 180
  const half =
    0.5 -
    Math.cos((lat2 - lat1) * rad) / 2 +
    (Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * (1 - Math.cos((lng2 - lng1) * rad))) / 2
  return 2 * 6371 * Math.asin(Math.sqrt(half))
}

// ---------------------------------------------------------------------------

const raw: RawCountry[] = JSON.parse(readFileSync(join(ROOT, 'data/raw/countries.json'), 'utf8'))

type Topology = {
  objects: { countries: { geometries: Array<{ id?: string; properties?: unknown }> } }
}
const topology: Topology = JSON.parse(
  readFileSync(join(ROOT, `data/raw/countries-${GEOMETRY_RESOLUTION}.json`), 'utf8'),
)
const drawable = new Set(
  topology.objects.countries.geometries.map((g) => g.id).filter((id): id is string => Boolean(id)),
)

// The source marks Vatican City as a UN member (it is really an observer), so
// the member filter yields 193 plus one.
const members = raw.filter((c) => c.unMember)
assert(
  members.length === 194,
  `expected 194 UN-member entries, found ${members.length} — did data/raw/countries.json change?`,
)

const countries = members.filter((c) => c.ccn3 && drawable.has(c.ccn3))
assert(
  countries.length === 165,
  `expected 165 countries with globe geometry, found ${countries.length}`,
)

const codes = new Set(countries.map((c) => c.cca3))

// Free-play links are a country per byte, indexed into src/link-codes.ts, so
// that list is the wire format and may only ever grow. Nothing here rewrites
// it: a rebuild that renumbered it would leave every link ever shared pointing
// at a different puzzle, silently, which is why this asks for a hand edit.
const missing = [...codes].filter((code) => !LINK_CODES.includes(code))
assert(
  missing.length === 0,
  `new to the graph and absent from src/link-codes.ts: ${missing.join(', ')} — ` +
    `append them to the END of LINK_CODES, never in sorted position`,
)
assert(new Set(LINK_CODES).size === LINK_CODES.length, 'src/link-codes.ts lists a country twice')
// 0xFF is the sentinel that marks a v2 `?g=` link, and it works only because no
// country index can ever reach it — see `src/freeplay-url.ts`. Growing the table
// that far would make every existing link ambiguous rather than merely long.
assert(
  LINK_CODES.length < 0xff,
  `src/link-codes.ts has ${LINK_CODES.length} entries and must stay under 255: 0xFF is the link format's version marker`,
)
assert(
  LINK_CODES.length <= LINK_CODE_LIMIT,
  `src/link-codes.ts holds ${LINK_CODES.length} countries, past the ${LINK_CODE_LIMIT} a one-byte index reaches`,
)

// A land border has to be claimed from both sides. Taking the intersection
// drops maritime artefacts; anything dropped that we did not already know
// about is a data change we want to hear about.
const claimed = new Map(
  countries.map((c) => [c.cca3, new Set((c.borders ?? []).filter((b) => codes.has(b)))]),
)

const oneWay: Array<[string, string]> = []
const adjacency: Record<string, string[]> = {}
for (const code of codes) {
  const mutual: string[] = []
  for (const other of claimed.get(code)!) {
    if (claimed.get(other)!.has(code)) mutual.push(other)
    else oneWay.push([code, other])
  }
  adjacency[code] = mutual.sort()
}

const unexpected = oneWay.filter(
  ([a, b]) => !KNOWN_ONE_WAY.some(([ka, kb]) => ka === a && kb === b),
)
assert(
  unexpected.length === 0,
  `unexpected one-way border claims: ${unexpected.map(([a, b]) => `${a}->${b}`).join(', ')}`,
)

/** Connected components of a link map, numbered largest first. */
function componentsOf(links: Record<string, string[]>): string[][] {
  const groups: string[][] = []
  const visited = new Set<string>()
  for (const start of [...codes].sort()) {
    if (visited.has(start)) continue
    const group: string[] = []
    const queue = [start]
    visited.add(start)
    for (let head = 0; head < queue.length; head++) {
      group.push(queue[head])
      for (const neighbour of links[queue[head]]) {
        if (visited.has(neighbour)) continue
        visited.add(neighbour)
        queue.push(neighbour)
      }
    }
    groups.push(group)
  }
  groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))
  return groups
}

// The land game, checked before any crossing is added. Sea links must not move
// these two numbers, and asserting them here rather than after is what makes
// that a fact rather than a hope.
const landGroups = componentsOf(adjacency)
const landSizes = landGroups.map((g) => g.length)
assert(
  landSizes[0] === 124 && landSizes[1] === 22,
  `expected land components of 124 (Afro-Eurasia) and 22 (Americas), got ${landSizes[0]} and ${landSizes[1]}`,
)
const landComponentOf = new Map<string, number>()
landGroups.forEach((group, index) => group.forEach((code) => landComponentOf.set(code, index)))

// ------------------------------------------------------------ sea crossings

const seaLinks: SeaLink[] = JSON.parse(readFileSync(join(ROOT, 'data/sea-links.json'), 'utf8'))

const sea: Record<string, string[]> = Object.fromEntries([...codes].map((code) => [code, []]))
const seaKeys = new Set<string>()

const crossings: Crossing[] = []
for (const { link, kind, basis, from, to } of seaLinks) {
  const [a, b] = link
  assert(codes.has(a) && codes.has(b), `sea link ${a}-${b} names a country that is not playable`)
  assert(a < b, `sea link ${a}-${b} is not in alphabetical order`)
  assert(!seaKeys.has(`${a}|${b}`), `sea link ${a}-${b} is listed twice`)
  assert(!adjacency[a].includes(b), `sea link ${a}-${b} is already a land border`)
  assert(
    ['fixed', 'ferry', 'strait', 'dormant'].includes(kind),
    `sea link ${a}-${b} has an unknown kind "${kind}"`,
  )
  // The justification is the inclusion rule. A crossing nobody can explain is a
  // crossing nobody can defend, so an empty one fails the build.
  assert(basis.trim().length > 20, `sea link ${a}-${b} has no real justification`)
  for (const [label, point] of [
    ['from', from],
    ['to', to],
  ] as const) {
    assert(
      Array.isArray(point) && point.length === 2,
      `sea link ${a}-${b} has no ${label} coordinate`,
    )
    assert(point[0] >= -90 && point[0] <= 90, `sea link ${a}-${b} has a bad ${label} latitude`)
    assert(point[1] >= -180 && point[1] <= 180, `sea link ${a}-${b} has a bad ${label} longitude`)
  }
  // The whole point of hand-placing these: the crossing has to be shorter than
  // the line between the two countries' middles, or it is not drawn anywhere
  // near where the crossing actually is.
  const crossed = greatCircle(from, to)
  const middles = greatCircle(graphLatLng(a), graphLatLng(b))
  assert(
    crossed <= middles,
    `sea link ${a}-${b} is drawn ${Math.round(crossed)} km, further than the ${Math.round(middles)} km between the two countries' middles`,
  )
  assert(
    crossed < 2000,
    `sea link ${a}-${b} is drawn ${Math.round(crossed)} km long — too far to be a crossing`,
  )

  seaKeys.add(`${a}|${b}`)
  sea[a].push(b)
  sea[b].push(a)
  crossings.push({ link: [a, b], from, to })
}
for (const code of codes) sea[code].sort()

/**
 * The property that protects the land game: contract each land component to a
 * node, and the crossings must form a forest over those nodes.
 *
 * A forest means every crossing is a bridge, so none of them can ever offer a
 * second way between two countries that were already joined — and therefore no
 * existing route can get shorter. Give one component two berths and that stops
 * being true, and every puzzle in the pool is silently up for renegotiation.
 */
const merged = new Map<number, number>()
function rootOf(component: number): number {
  let current = component
  while (merged.get(current) !== undefined && merged.get(current) !== current) {
    current = merged.get(current)!
  }
  return current
}
for (const { link } of seaLinks) {
  const [a, b] = link
  const rootA = rootOf(landComponentOf.get(a)!)
  const rootB = rootOf(landComponentOf.get(b)!)
  assert(
    rootA !== rootB,
    `sea link ${a}-${b} gives a landmass a second berth — that can shorten existing routes`,
  )
  merged.set(rootA, rootB)
}

const links: Record<string, string[]> = Object.fromEntries(
  [...codes].map((code) => [code, [...adjacency[code], ...sea[code]]]),
)
const linkCost = (from: string, to: string) => (seaKeys.has(key(from, to)) ? SEA_COST : 1)
function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

const groups = componentsOf(links)

const componentOf = new Map<string, number>()
groups.forEach((group, index) => group.forEach((code) => componentOf.set(code, index)))

const sizes = groups.map((g) => g.length)
const stranded = groups.slice(1).flat()
assert(
  sizes[0] === 161,
  `expected one world of 161 countries once the crossings are in, got ${sizes[0]}`,
)
assert(
  stranded.join(',') === 'FJI,NZL,SLB,VUT',
  `expected exactly Fiji, New Zealand, Solomon Islands and Vanuatu to stay unplayable, got ${stranded.join(', ')}`,
)

// ----------------------------------------------------------------- regions

const regions: Region[] = JSON.parse(readFileSync(join(ROOT, 'data/regions.json'), 'utf8'))

const regionNames = new Set<string>()
// `inRegion` not `countries`: the module-level `countries` list is in scope
// here, and shadowing it made this loop read as if it filtered that.
for (const { name, countries: inRegion, basis } of regions) {
  assert(!regionNames.has(name), `region "${name}" is listed twice`)
  regionNames.add(name)
  assert(inRegion.length >= 2, `region "${name}" needs more than one country to be a region`)
  assert(new Set(inRegion).size === inRegion.length, `region "${name}" names a country twice`)
  for (const code of inRegion) {
    assert(codes.has(code), `region "${name}" names ${code}, which is not playable`)
  }
  // The justification is the inclusion rule, as it is for a crossing: a region
  // nobody can explain is one nobody can defend, and the banner has to name it.
  assert(basis.trim().length > 20, `region "${name}" has no real justification`)

  // Connected *within itself*, over land or water. A region in two pieces is
  // two regions, and shutting one would grey two unrelated parts of the globe
  // under a single name — which is the one thing naming them was for.
  const inside = new Set(inRegion)
  const seen = new Set([inRegion[0]])
  const queue = [inRegion[0]]
  for (let head = 0; head < queue.length; head++) {
    for (const link of links[queue[head]]) {
      if (inside.has(link) && !seen.has(link)) {
        seen.add(link)
        queue.push(link)
      }
    }
  }
  assert(
    seen.size === inRegion.length,
    `region "${name}" is not connected — ${inRegion.filter((c) => !seen.has(c)).join(', ')} hangs off nothing`,
  )
}

// Overlap is allowed and deliberate: the Alps and Central Europe share
// Switzerland and Austria, because a country can belong to more than one region
// and no round ever applies two at once. What is not allowed is one region
// containing another, which would make the smaller unreachable by any selection
// that prefers the larger.
for (const outer of regions) {
  for (const inner of regions) {
    if (outer === inner) continue
    const outerSet = new Set(outer.countries)
    assert(
      !inner.countries.every((code) => outerSet.has(code)),
      `region "${inner.name}" sits entirely inside "${outer.name}"`,
    )
  }
}

const graph: Graph = {}
for (const country of countries.sort((a, b) => a.cca3.localeCompare(b.cca3))) {
  assert(country.ccn3, `${country.cca3} has no ccn3, so it cannot be joined to the globe geometry`)
  assert(country.latlng?.length === 2, `${country.cca3} has no usable latlng`)
  graph[country.cca3] = {
    name: country.name.common,
    flag: country.flag ?? '',
    ccn3: country.ccn3,
    latlng: country.latlng as [number, number],
    // Deduped against the common name so autocomplete does not offer the same
    // string twice; "UK", "Holland", "UAE" and friends all live here.
    alt: [...new Set([country.name.official, ...(country.altSpellings ?? [])])].filter(
      (s) => s !== country.name.common,
    ),
    borders: adjacency[country.cca3],
    // Kept apart from `borders`, which goes on meaning land only — the globe
    // draws the two differently and "shares a land border" stays answerable.
    sea: sea[country.cca3],
    component: componentOf.get(country.cca3)!,
  }
}

// ------------------------------------------------------------------- the pool
//
// A hole is a pair of countries and whichever barriers it carries, and a day
// may carry two of them. Every eligible pair therefore contributes one entry per
// combination it can support — the same two countries with a region in the rough
// is a different hole from the same two countries with a country shut, and both
// are different from the same two played open.
//
// Bucketing is by how a hole actually plays, never by its open route: a pair
// whose open route is two countries is no puzzle at all, and the same pair with
// China shut may be a perfectly good hard one.

const codeList = Object.keys(graph)
const N = codeList.length
const AT = new Map(codeList.map((code, at) => [code, at]))
const UNREACHABLE = 0x7fff

/** Adjacency and link cost, flattened to indices for the generation pass. */
const NEIGHBOURS: Int16Array[] = codeList.map(
  (code) => new Int16Array(links[code].map((other) => AT.get(other)!)),
)
const STEPS: Int16Array[] = codeList.map(
  (code) => new Int16Array(links[code].map((other) => linkCost(code, other))),
)

/**
 * Cheapest costs from every country to every other, under one arrangement of
 * shut and rough ground. `at(from, to)` reads it.
 *
 * A table rather than a search per question, because the questions repeat far
 * more than they vary: there are 165 single closures, 12 regions to shut and 12
 * to roughen, and every pair on the map asks about the same ones. Building all
 * 190 tables up front costs 31,000 searches; asking pair by pair would cost
 * millions, and the waypoint scan below would be the whole afternoon.
 *
 * Directed, and deliberately so: rough is charged on arrival, so the cost from
 * a rough country is not the cost to it. `steinerOf` reads legs *from* each
 * terminal, exactly as `steiner` in `src/game/graph.ts` does.
 */
function allPairs(closed?: ReadonlySet<string>, rough?: ReadonlySet<string>): Int16Array {
  const shut = new Uint8Array(N)
  const priced = new Uint8Array(N)
  for (const code of closed ?? []) shut[AT.get(code)!] = 1
  for (const code of rough ?? []) priced[AT.get(code)!] = 1

  const table = new Int16Array(N * N).fill(UNREACHABLE)
  const best = new Int16Array(N)
  const settled = new Uint8Array(N)

  for (let source = 0; source < N; source++) {
    if (shut[source]) continue
    best.fill(UNREACHABLE)
    settled.fill(0)
    best[source] = 0

    for (;;) {
      let current = -1
      let cost = UNREACHABLE
      for (let at = 0; at < N; at++) {
        if (settled[at] || best[at] >= cost) continue
        current = at
        cost = best[at]
      }
      if (current === -1) break

      settled[current] = 1
      const neighbours = NEIGHBOURS[current]
      const steps = STEPS[current]
      for (let edge = 0; edge < neighbours.length; edge++) {
        const to = neighbours[edge]
        if (settled[to] || shut[to]) continue
        const next = cost + steps[edge] + (priced[to] ? ROUGH_COST - 1 : 0)
        if (next < best[to]) best[to] = next
      }
    }
    table.set(best, source * N)
  }
  return table
}

const TABLES = new Map<string, Int16Array>()

/** The table for an arrangement, built once and kept. */
function matrixFor(closed?: ReadonlySet<string>, rough?: ReadonlySet<string>): Int16Array {
  // `cacheKey` not `key`: `key(a, b)` is a function declared above.
  const cacheKey = `${[...(closed ?? [])].sort().join(',')}|${[...(rough ?? [])].sort().join(',')}`
  let table = TABLES.get(cacheKey)
  if (!table) {
    table = allPairs(closed, rough)
    TABLES.set(cacheKey, table)
  }
  return table
}

const OPEN = matrixFor()
const at = (table: Int16Array, from: number, to: number) => table[from * N + to]

/**
 * The cheapest route from `from` to `to` that runs *through* `via`, under one
 * arrangement — the index-graph mirror of `searchVia` in `src/game/graph.ts`,
 * and the number that must agree with it, because `assertPlayable` re-derives
 * every served hole's floor in the browser with the other one.
 *
 * Two internally-disjoint paths out of the waypoint, one to each end, as a
 * minimum-cost flow of value two over the split graph. `UNREACHABLE` where the
 * second path does not exist, which is the third rule of the dogleg: a country
 * a route cannot go in one border and out another of is a cul-de-sac.
 *
 * The arc list is laid out once for the whole run and reset per query, because
 * this is asked about 17,000 times and rebuilding 1,600 arcs each time is the
 * only part of it that would show up in the clock.
 */
const SINK = N * 2
const ARC_TAIL: number[] = []
const ARC_TIP: number[] = []
const ARC_HEAD = new Int32Array(SINK + 1).fill(-1)
const ARC_NEXT: number[] = []
const ARC_BASE: number[] = []
/** Each country's own split arc, so its price and its gate are one write. */
const SPLIT_ARC = new Int32Array(N)
/** Each country's arc to the sink, opened only for the two ends of a query. */
const SINK_ARC = new Int32Array(N)
{
  const arc = (tail: number, tip: number, weight: number) => {
    ARC_TIP.push(tip)
    ARC_TAIL.push(tail)
    ARC_BASE.push(weight)
    ARC_NEXT.push(ARC_HEAD[tail])
    ARC_HEAD[tail] = ARC_TIP.length - 1
    ARC_TIP.push(tail)
    ARC_TAIL.push(tip)
    ARC_BASE.push(-weight)
    ARC_NEXT.push(ARC_HEAD[tip])
    ARC_HEAD[tip] = ARC_TIP.length - 1
  }
  for (let node = 0; node < N; node++) {
    SPLIT_ARC[node] = ARC_TIP.length
    arc(node * 2, node * 2 + 1, 0)
    const neighbours = NEIGHBOURS[node]
    const steps = STEPS[node]
    for (let edge = 0; edge < neighbours.length; edge++) {
      arc(node * 2 + 1, neighbours[edge] * 2, steps[edge])
    }
  }
  // One sink fed by both ends, a unit apiece, which is what makes the two paths
  // go to *different* places rather than both taking the cheaper one.
  for (let node = 0; node < N; node++) {
    SINK_ARC[node] = ARC_TIP.length
    arc(node * 2, SINK, 0)
  }
}
const ARCS = ARC_TIP.length
const FLOW_CAP = new Int32Array(ARCS)
const FLOW_COST = new Int32Array(ARCS)

function viaCostOf(
  from: number,
  to: number,
  via: number,
  closed?: ReadonlySet<string>,
  priced?: Uint8Array | null,
): number {
  for (let arc = 0; arc < ARCS; arc++) {
    FLOW_CAP[arc] = arc % 2 === 0 ? 1 : 0
    FLOW_COST[arc] = ARC_BASE[arc]
  }
  // A country's premium is charged by its own split arc, once, exactly where
  // the player pays it. No terminal is charged, and none may be rough.
  if (priced) {
    for (let node = 0; node < N; node++) {
      if (!priced[node]) continue
      FLOW_COST[SPLIT_ARC[node]] = ROUGH_COST - 1
      FLOW_COST[SPLIT_ARC[node] + 1] = -(ROUGH_COST - 1)
    }
  }
  // Shut ground is subtracted, exactly as `within` subtracts in the browser.
  for (const code of closed ?? []) FLOW_CAP[SPLIT_ARC[AT.get(code)!]] = 0
  // Nothing passes *through* somewhere the route starts, ends or turns.
  for (const node of [from, to, via]) FLOW_CAP[SPLIT_ARC[node]] = 0
  // Only the two ends drain, and only one unit each.
  for (let node = 0; node < N; node++) FLOW_CAP[SINK_ARC[node]] = 0
  FLOW_CAP[SINK_ARC[from]] = 1
  FLOW_CAP[SINK_ARC[to]] = 1

  const source = via * 2 + 1
  const best = new Int32Array(SINK + 1)
  const cameBy = new Int32Array(SINK + 1)
  const queued = new Uint8Array(SINK + 1)
  let total = 0
  for (let unit = 0; unit < 2; unit++) {
    // Bellman–Ford, not Dijkstra: a residual arc carries the negative of the
    // weight it undoes, which is the whole reason the first augmentation can be
    // taken back when the second one needs its ground.
    best.fill(0x3fffffff)
    cameBy.fill(-1)
    queued.fill(0)
    best[source] = 0
    queued[source] = 1
    const pending = [source]
    for (let head = 0; head < pending.length; head++) {
      const current = pending[head]
      queued[current] = 0
      for (let arc = ARC_HEAD[current]; arc >= 0; arc = ARC_NEXT[arc]) {
        if (FLOW_CAP[arc] <= 0) continue
        const reach = best[current] + FLOW_COST[arc]
        if (reach >= best[ARC_TIP[arc]]) continue
        best[ARC_TIP[arc]] = reach
        cameBy[ARC_TIP[arc]] = arc
        if (queued[ARC_TIP[arc]]) continue
        queued[ARC_TIP[arc]] = 1
        pending.push(ARC_TIP[arc])
      }
    }
    if (best[SINK] >= 0x3fffffff) return UNREACHABLE
    total += best[SINK]
    for (let node = SINK; node !== source; node = ARC_TAIL[cameBy[node]]) {
      FLOW_CAP[cameBy[node]] -= 1
      FLOW_CAP[cameBy[node] ^ 1] += 1
    }
  }
  return total
}

/** A region as a flag array, for pricing the split arcs. */
const PRICED = new Map<string, Uint8Array>()
function pricedFlags(region: Region): Uint8Array {
  let flags = PRICED.get(region.name)
  if (!flags) {
    flags = new Uint8Array(N)
    for (const code of region.countries) flags[AT.get(code)!] = 1
    PRICED.set(region.name, flags)
  }
  return flags
}

const inRange = (best: number) => best >= MIN_BEST && best <= MAX_BEST

/**
 * The single closure that lengthens this puzzle most without breaking it.
 *
 * Only countries on *some* shortest route are worth testing: anywhere else can
 * be removed without the route noticing. That is the `there + back === span`
 * filter, and it cuts the search from every country to about nine.
 *
 * Largest gain wins, since that is the best proxy for a genuine chokepoint
 * rather than one of several parallel routes. Ties break by code so the pool is
 * reproducible.
 */
function closureFor(from: number, to: number): Hole | null {
  const span = at(OPEN, from, to)
  if (span >= UNREACHABLE) return null

  let chosen: { code: string; best: number } | null = null
  for (let candidate = 0; candidate < N; candidate++) {
    if (candidate === from || candidate === to) continue
    const there = at(OPEN, from, candidate)
    const back = at(OPEN, candidate, to)
    if (there + back !== span) continue

    const code = codeList[candidate]
    // Unreachable means this country is the only way through: shutting it would
    // leave a puzzle with no answer at all.
    const detoured = at(matrixFor(new Set([code])), from, to)
    if (detoured >= UNREACHABLE) continue

    const best = detoured - 1
    if (detoured <= span || !inRange(best)) continue
    if (!chosen || best > chosen.best || (best === chosen.best && code < chosen.code)) {
      chosen = { code, best }
    }
  }
  if (!chosen) return null
  return { start: codeList[from], end: codeList[to], best: chosen.best, closed: [chosen.code] }
}

/**
 * The region whose shutting lengthens this route most. What `closureFor` does
 * for a country, for a whole place — a different mechanic to play, since above
 * `LONE_CLOSURE_LIMIT` the notice stops counting shut borders and names the
 * region instead, but identical arithmetic.
 */
function boundsFor(from: number, to: number): Hole | null {
  const span = at(OPEN, from, to)
  if (span >= UNREACHABLE) return null

  const [start, end] = [codeList[from], codeList[to]]
  let chosen: { region: Region; best: number } | null = null
  for (const region of regions) {
    if (region.countries.includes(start) || region.countries.includes(end)) continue
    const shut = at(matrixFor(new Set(region.countries)), from, to)
    if (shut >= UNREACHABLE || shut <= span) continue

    const best = shut - 1
    if (!inRange(best)) continue
    if (
      !chosen ||
      best > chosen.best ||
      (best === chosen.best && region.name < chosen.region.name)
    ) {
      chosen = { region, best }
    }
  }
  if (!chosen) return null
  return { start, end, best: chosen.best, closed: [...chosen.region.countries] }
}

/**
 * The region to put in the rough, and this is not the closure rule.
 *
 * Rough is a decision rather than a surcharge: the short way through and the
 * long way round are both open, and the hole is only worth playing if choosing
 * between them is worth doing. So the rule takes the *biggest bite that still
 * leaves a live way round* — the largest gain among regions the route can
 * dodge for a stroke or less — and falls back to the closest thing to a dodge
 * when no region leaves one at all.
 *
 * Measured over all 5,665 eligible pairs. Against taking the largest gain
 * outright it drops the share of holes that force you into the rough from 63%
 * to 49%, at no cost in difficulty spread; against taking the closest dodge it
 * keeps the bite (a gain of two or more on 32% of holes rather than 24%). All
 * three rules bucket almost identically, so unlike the waypoint rule below this
 * was a choice about what the hole feels like, not about where it lands.
 *
 * Regions containing either endpoint are left out. The premium is charged on
 * arrival, so a rough endpoint makes the hole cost different amounts measured
 * from either end — and `pickPuzzle` runs half the pool's pairs backwards.
 */
function roughFor(from: number, to: number, closed?: ReadonlySet<string>): Hole | null {
  const open = at(matrixFor(closed), from, to)
  if (open >= UNREACHABLE) return null

  const [start, end] = [codeList[from], codeList[to]]
  type Candidate = { region: Region; priced: number; best: number; gap: number }
  const candidates: Candidate[] = []

  for (const region of regions) {
    if (region.countries.includes(start) || region.countries.includes(end)) continue
    // A country cannot be both shut and rough, and `newGame` refuses a puzzle
    // that claims it is.
    if (closed && region.countries.some((code) => closed.has(code))) continue

    const priced = at(matrixFor(closed, new Set(region.countries)), from, to)
    if (priced >= UNREACHABLE || priced === open) continue
    const best = priced - 1
    if (!inRange(best)) continue

    const skirted = at(matrixFor(new Set([...(closed ?? []), ...region.countries])), from, to)
    candidates.push({
      region,
      priced,
      best,
      gap: skirted >= UNREACHABLE ? UNREACHABLE : skirted - priced,
    })
  }
  if (candidates.length === 0) return null

  const live = candidates.filter((candidate) => candidate.gap <= 1)
  const chosen = (live.length > 0 ? live : candidates).sort(
    (a, b) => b.priced - a.priced || a.gap - b.gap || a.region.name.localeCompare(b.region.name),
  )[0]

  const hole: Hole = { start, end, best: chosen.best, rough: [...chosen.region.countries] }
  // The closure travels with the hole it was measured against. Leaving it
  // behind would file a `best` that only makes sense with a country shut
  // against an entry that does not shut it.
  if (closed) hole.closed = [...closed]
  return hole
}

/**
 * The waypoint the round must run through, by the **smallest** positive gain.
 *
 * Deliberately not the closure rule, and this one is about safety rather than
 * feel. A closure's gain is bounded by the topology, so largest-gain lands
 * anywhere; a waypoint's is bounded only by `MAX_BEST`, so largest-gain
 * saturates at ten every single time — measured, it put 9,135 of 9,135 eligible
 * pairs in `hard`, and Monday would never see a dogleg. Smallest positive gain
 * spreads them.
 *
 * `best` is the cheapest route *through* the waypoint, and the arithmetic here
 * is the reverse of what it used to be. It was the cheapest *tree* joining both
 * ends and the waypoint, for which `d(from, via) + d(via, to)` was an
 * over-estimate on 84% of waypoints. It is now a **lower bound** — met on most,
 * exceeded wherever the cheapest way in blocks the cheapest way out — and that
 * is what makes the scan below sound.
 *
 * ## Why this is not 165 flows per pair
 *
 * The bound is two table reads, and the answer wanted is the *smallest* gain.
 * So: price every candidate by the bound, walk them cheapest-first, and stop as
 * soon as the bound on what is left cannot beat what has been found. Measured,
 * that is 1.30 exact evaluations per pair rather than ~150.
 *
 * The break has to compare the code as well as the cost, and must not compare
 * it alone. Candidates are in `(bound, code)` order and every exact cost is at
 * least its bound, so nothing after `(chosen.cost, chosen.code)` can beat it;
 * but breaking on the code while the bound is still under `chosen.cost` would
 * throw away a candidate that could. The two agree on this graph, which is
 * exactly what would make the tighter one a silent trap.
 */
function waypointFor(
  from: number,
  to: number,
  closed?: ReadonlySet<string>,
  rough?: Region,
): Hole | null {
  const table = matrixFor(closed, rough && new Set(rough.countries))
  const priced = rough ? pricedFlags(rough) : null
  const base = at(table, from, to)
  if (base >= UNREACHABLE) return null

  const [start, end] = [codeList[from], codeList[to]]
  // A waypoint next door to an endpoint is not a dogleg: the bend is half made
  // before the player has done anything. `newGame` refuses one.
  const adjacent = new Set([...links[start], ...links[end]])

  const candidates: { code: string; node: number; bound: number }[] = []
  for (let candidate = 0; candidate < N; candidate++) {
    if (candidate === from || candidate === to) continue
    const code = codeList[candidate]
    if (closed?.has(code) || adjacent.has(code)) continue
    // The route leaves the waypoint rather than arriving at it, so a premium
    // there would go uncharged — `newGame` refuses a rough waypoint for this.
    if (priced?.[candidate]) continue

    const there = at(table, from, candidate)
    const back = at(table, candidate, to)
    if (there >= UNREACHABLE || back >= UNREACHABLE) continue
    const bound = there + back
    if (bound <= base || !inRange(bound - 1)) continue
    candidates.push({ code, node: candidate, bound })
  }
  candidates.sort((one, other) => one.bound - other.bound || one.code.localeCompare(other.code))

  let chosen: { code: string; best: number; cost: number } | null = null
  for (const { code, node, bound } of candidates) {
    if (chosen && (bound > chosen.cost || (bound === chosen.cost && code >= chosen.code))) break
    const cost = viaCostOf(from, to, node, closed, priced)
    if (cost >= UNREACHABLE || cost <= base) continue
    const best = cost - 1
    if (!inRange(best)) continue
    if (!chosen || cost < chosen.cost || (cost === chosen.cost && code < chosen.code)) {
      chosen = { code, best, cost }
    }
  }
  if (!chosen) return null

  const hole: Hole = { start, end, best: chosen.best, required: [chosen.code] }
  if (closed) hole.closed = [...closed]
  if (rough) hole.rough = [...rough.countries]
  return hole
}

/**
 * The fairway's tuning, fixed from `scripts/measure-bent-fairways.ts`
 * distributions at the second checkpoint (2026-08-12). The first cut carved
 * around the shortest route and the planet made that samey: Earth funnels
 * shortest routes through three land bridges, and Russia sat on 39% of all
 * corridors. A course is now allowed to *bend* — run through a waypoint the
 * direct route ignores — and the pool is a water-filled selection that spreads
 * corridors across the map, holding the worst trunk near a quarter.
 */
const FAIRWAY_MIN_ROUGH = 8
const FAIRWAY_MIN_CLOSED = 110
/** A bend under two strokes is a wobble the player cannot feel. */
const FAIRWAY_MIN_BEND = 2
/** Bent corridors a pair may offer the selection, before it spreads them. */
const FAIRWAY_VIAS = 6
/**
 * A ceiling the fill never actually reaches: the overlap and trunk gates
 * below exhaust the candidates first, at ~385 courses on the current map.
 * That is the point — the pool is however many genuinely different courses
 * Earth holds, not a quota filled by loosening what "different" means. The
 * rotation's floors (>156 hard, >94 medium — five times the annual draws)
 * are what the gates must clear, and `daily.test.ts` holds them to it.
 */
const FAIRWAY_POOL = 800

/**
 * Two courses sharing most of their fairway are one challenge wearing two
 * pairs of endpoints — the first playtest fortnight drew four courses whose
 * whole test was crossing the Central American isthmus, told apart only by
 * their tails. Country-level caps cannot see that; Jaccard overlap of the
 * fairway sets can, and a course too alike anything already kept is dead for
 * good, since the kept only accumulate. Measured at 0.5 the surviving pool
 * ran too thin for the rotation's floors; 0.6 keeps 385 courses, none of
 * which shares more than three-fifths of its ground with any other.
 */
const FAIRWAY_MAX_OVERLAP = 0.6

/**
 * No country may sit on more fairways than this, full stop. The water-fill's
 * rising cap spreads courses while supply lasts, but with the look-alike
 * sweep retiring candidates the fill would otherwise keep loosening until it
 * hit `FAIRWAY_POOL` — measured, Russia climbed from 39% of corridors to 51%
 * that way. The ceiling holds the worst trunk near a quarter of the pool.
 */
const FAIRWAY_TRUNK_CAP = 100

/**
 * Restated from `FAIRWAY_LIMIT` in `src/game/rules.ts`, which this script must
 * not import — `rules.ts` reaches `graph.ts`, which reads the file this script
 * writes. `pool.test.ts` imports the real one and holds the committed pool to
 * it, so a drift between the two fails there.
 */
const FAIRWAY_LIMIT = 40

/** No rough anywhere: the pricing a corridor-only floor is asked under. */
const NO_PRICES = new Uint8Array(N)

/**
 * The cheapest route across a carved board: one priced Dijkstra from `from`,
 * over the graph with `shut` removed and `priced` charged on arrival. What
 * `allPairs` does for every source at once, for the one source a candidate
 * course needs.
 *
 * Cost and route together, from the one search, because the two callers want
 * different halves and the cost is the expensive half to say twice. The floor
 * only wants the figure; the shortcut repair has to see *which way* the cheaper
 * route goes in order to close the rough it rides, and used to re-add that
 * route up by hand afterwards — a third spelling of
 * `steps[edge] + (priced[next] ? ROUGH_COST - 1 : 0)`, which it then compared
 * against a floor computed by the other two. Price rough differently in one
 * place and not the others and the repair loop measures a route under a metric
 * the pool was not built on, quietly closing the wrong band countries.
 */
function carvedSearch(
  from: number,
  to: number,
  shut: Uint8Array,
  priced: Uint8Array,
): { cost: number; path: number[] | null } {
  const best = new Int16Array(N).fill(UNREACHABLE)
  const parent = new Int16Array(N).fill(-1)
  const settled = new Uint8Array(N)
  best[from] = 0

  for (;;) {
    let current = -1
    let cost = UNREACHABLE
    for (let node = 0; node < N; node++) {
      if (settled[node] || best[node] >= cost) continue
      current = node
      cost = best[node]
    }
    if (current === -1) return { cost: best[to], path: null }
    if (current === to) break

    settled[current] = 1
    const neighbours = NEIGHBOURS[current]
    const steps = STEPS[current]
    for (let edge = 0; edge < neighbours.length; edge++) {
      const next = neighbours[edge]
      if (settled[next] || shut[next]) continue
      const through = cost + steps[edge] + (priced[next] ? ROUGH_COST - 1 : 0)
      if (through < best[next]) {
        best[next] = through
        parent[next] = current
      }
    }
  }

  const path: number[] = []
  for (let node = to; node !== -1; node = parent[node]) path.push(node)
  return { cost: best[to], path: path.reverse() }
}

/** A candidate course, held back from `file` until the water-fill has chosen. */
type Course = { hole: Hole; fairway: string[]; bend: number; key: string }

/**
 * The whole world carved into a course, straight or bent.
 *
 * The corridor keeps tied strands: every country on some equally-cheap route —
 * to the waypoint and on from it when the course bends (`via >= 0`), between
 * the two ends when it does not. Parallel strands are where the mid-course
 * decisions live; the hand-built LKA-MDG round kept Israel beside Jordan and
 * Afghanistan beside Pakistan, and that is the shape this reproduces. The
 * rough starts one link out, like the derivation `deriveFairway` makes for a
 * corridor painted in the builder — and is then *repaired*: any band country
 * a cheaper-than-fairway route rides is shut instead, because the rough is an
 * option on the outskirts and never the answer. `best` is the fairway's own
 * floor, band shut, and the pool test holds every committed course to it.
 *
 * A bent course is priced by the closure, exactly as `bounds` is: the floor is
 * recomputed over the carved board, and the bend is what it grew by. A
 * straight course leaves the floor alone by construction — it holds every
 * cheapest route. Never easy either way: a three-country hop has no room to
 * be a course.
 */
function carveCourse(from: number, to: number, via: number): Course | null {
  const span = at(OPEN, from, to)
  if (span >= UNREACHABLE) return null

  const inCorridor = new Uint8Array(N)
  const fairwayNodes: number[] = []
  if (via < 0) {
    for (let node = 0; node < N; node++) {
      const there = at(OPEN, from, node)
      const back = at(OPEN, node, to)
      if (there < UNREACHABLE && back < UNREACHABLE && there + back === span) {
        inCorridor[node] = 1
        fairwayNodes.push(node)
      }
    }
  } else {
    const toVia = at(OPEN, from, via)
    const fromVia = at(OPEN, via, to)
    if (toVia >= UNREACHABLE || fromVia >= UNREACHABLE) return null
    for (let node = 0; node < N; node++) {
      const a = at(OPEN, from, node)
      const b = at(OPEN, node, via)
      const c = at(OPEN, via, node)
      const e = at(OPEN, node, to)
      const onFirst = a < UNREACHABLE && b < UNREACHABLE && a + b === toVia
      const onSecond = c < UNREACHABLE && e < UNREACHABLE && c + e === fromVia
      if (onFirst || onSecond) {
        inCorridor[node] = 1
        fairwayNodes.push(node)
      }
    }
  }

  const shut = new Uint8Array(N)
  const priced = new Uint8Array(N)
  for (let node = 0; node < N; node++) {
    if (inCorridor[node]) continue
    const neighbours = NEIGHBOURS[node]
    let touches = false
    for (let edge = 0; edge < neighbours.length; edge++) {
      if (inCorridor[neighbours[edge]]) {
        touches = true
        break
      }
    }
    if (touches) priced[node] = 1
    else shut[node] = 1
  }

  // The floor the fairway itself offers: the corridor with the band shut too.
  // This is what `best` will be — the rough is an option on the outskirts,
  // never the answer — and a corridor that cannot reach the far end on its
  // own is no course at all.
  const banded = new Uint8Array(N)
  for (let node = 0; node < N; node++) banded[node] = shut[node] || priced[node] ? 1 : 0
  const floor = carvedSearch(from, to, banded, NO_PRICES).cost
  if (floor >= UNREACHABLE) return null
  const best = floor - 1
  if (!inRange(best) || difficultyOf(best) === 'easy') return null
  const bend = floor - span
  if (via >= 0 && bend < FAIRWAY_MIN_BEND) return null

  // Shortcut repair. A band one link out can carry the very route the bend
  // exists to rule off — the first cut of BEN-DJI priced the direct line at a
  // stroke a country and the fairway arc was a decoy. So long as the carved
  // board plays cheaper than the fairway does, close the rough the cheaper
  // route rides; what remains of the band is strictly an option. Each pass
  // shuts at least one country, so this ends.
  for (;;) {
    const shortcut = carvedSearch(from, to, shut, priced)
    if (!shortcut.path) return null
    if (shortcut.cost >= floor) break
    let closedAny = false
    for (const node of shortcut.path) {
      if (priced[node]) {
        priced[node] = 0
        shut[node] = 1
        closedAny = true
      }
    }
    assert(closedAny, 'a carved board played under its fairway without touching the rough')
  }

  const rough: string[] = []
  const closed: string[] = []
  for (let node = 0; node < N; node++) {
    if (priced[node]) rough.push(codeList[node])
    else if (shut[node]) closed.push(codeList[node])
  }
  if (rough.length < FAIRWAY_MIN_ROUGH || closed.length < FAIRWAY_MIN_CLOSED) return null

  // `codeList` is alphabetical so every list already is; sorted() is the
  // stated contract rather than an accident of iteration order, because the
  // share invariant is deep equality over the rebuilt puzzle, order included.
  const fairway = fairwayNodes.map((node) => codeList[node]).sort()
  return {
    hole: {
      start: codeList[from],
      end: codeList[to],
      best,
      closed: closed.sort(),
      rough: rough.sort(),
    },
    fairway,
    bend,
    key: fairway.join(','),
  }
}

/**
 * Every course this pair may offer the water-fill: the straight corridor, and
 * up to `FAIRWAY_VIAS` bends. Vias are priced by their bound and walked
 * biggest-bend-first, so the arcs on offer are the pair's most dramatic; a via
 * beside an endpoint is no bend at all, and two vias on the same arc carve the
 * same corridor and count once.
 */
function fairwaysFor(from: number, to: number): Course[] {
  const span = at(OPEN, from, to)
  if (span >= UNREACHABLE) return []

  const courses: Course[] = []
  const straight = carveCourse(from, to, -1)
  if (straight) courses.push(straight)

  const [start, end] = [codeList[from], codeList[to]]
  const adjacent = new Set([...links[start], ...links[end]])
  const priced: { via: number; bound: number }[] = []
  for (let via = 0; via < N; via++) {
    if (via === from || via === to || adjacent.has(codeList[via])) continue
    const there = at(OPEN, from, via)
    const back = at(OPEN, via, to)
    if (there >= UNREACHABLE || back >= UNREACHABLE) continue
    const bound = there + back
    if (bound - 1 > MAX_BEST || bound - span < FAIRWAY_MIN_BEND) continue
    priced.push({ via, bound })
  }
  priced.sort(
    (one, other) => other.bound - one.bound || codeList[one.via].localeCompare(codeList[other.via]),
  )

  const seen = new Set(straight ? [straight.key] : [])
  for (const { via } of priced) {
    if (courses.length >= FAIRWAY_VIAS + (straight ? 1 : 0)) break
    const carved = carveCourse(from, to, via)
    if (!carved || seen.has(carved.key)) continue
    seen.add(carved.key)
    courses.push(carved)
  }
  return courses
}

const pool: Record<Difficulty, Record<Combo, Entry[]>> = {
  easy: emptyCombos(),
  medium: emptyCombos(),
  hard: emptyCombos(),
}
function emptyCombos(): Record<Combo, Entry[]> {
  const combos = {} as Record<Combo, Entry[]>
  for (const combo of COMBOS) combos[combo] = []
  return combos
}

const histogram = new Map<number, number>()

/** Fairway candidates across every pair, spread and filed after the loop. */
const courses: Course[] = []

function file(combo: Combo, hole: Hole | null): Hole | null {
  if (!hole) return null
  pool[difficultyOf(hole.best)][combo].push(entryOf(combo, hole))
  return hole
}

for (let from = 0; from < N; from++) {
  for (let to = from + 1; to < N; to++) {
    // Unordered pairs: emit each one once, in alphabetical order, because
    // `pickPuzzle` runs half of them backwards on a coin and cost is symmetric
    // while no endpoint is rough — which none of these ever is.
    const span = at(OPEN, from, to)
    if (span >= UNREACHABLE) continue

    const [start, end] = [codeList[from], codeList[to]]
    const best = span - 1

    if (inRange(best)) {
      file('open', { start, end, best })
      histogram.set(best, (histogram.get(best) ?? 0) + 1)
    }

    // Pairs too short to be a puzzle open are still considered for every
    // barrier, because a barrier lengthens them: without this the easy bucket,
    // whose whole range is a single route length, could hold almost nothing.
    const closure = file('closed', closureFor(from, to))
    const bounds = file('bounds', boundsFor(from, to))
    const rough = file('rough', roughFor(from, to))
    file('dogleg', waypointFor(from, to))
    courses.push(...fairwaysFor(from, to))

    // Two barriers, chosen in a fixed order — the shut ground first, then the
    // rough, then the waypoint — each measured against the graph the earlier
    // ones leave behind. The order is not cosmetic: picking the closure first
    // yields half again as many playable `closed+rough` holes as picking the
    // rough first, because a closure has many more candidates to give up.
    if (closure) {
      const shut = new Set(closure.closed!)
      file('closed+rough', roughFor(from, to, shut))
      file('closed+dogleg', waypointFor(from, to, shut))
    }
    if (bounds) {
      file('bounds+dogleg', waypointFor(from, to, new Set(bounds.closed!)))
    }
    if (rough) {
      const region = regions.find((r) => r.countries.join() === rough.rough!.join())!
      file('rough+dogleg', waypointFor(from, to, undefined, region))
    }
  }
}

// The fairway pool is a *selection*, not everything viable: a water-fill that
// spreads corridors across the map. Passes at cap 1, 2, 3… each keep, walking
// the biggest bends first, every course no fairway country of which has yet
// been kept as often as the pass allows — so a corridor of fresh countries
// always gets in before a third run down a used trunk, and the straight
// courses fill the gaps the arcs leave. Each keep also retires every course
// too alike it, which is what country counts cannot do: four courses whose
// whole test is one isthmus share no cap but share the challenge.
// Deterministic, and stopped at `FAIRWAY_POOL`, past which the diversity this
// exists for erodes.
{
  const ordered = [...courses].sort(
    (one, other) =>
      other.bend - one.bend ||
      one.hole.start.localeCompare(other.hole.start) ||
      one.hole.end.localeCompare(other.hole.end) ||
      one.key.localeCompare(other.key),
  )

  // Fairways as bitsets, because the similarity sweep is every kept course
  // against every candidate and popcounts are what make that a blink.
  const words = (N + 31) >> 5
  const bits = ordered.map((course) => {
    const set = new Uint32Array(words)
    for (const code of course.fairway) {
      const node = AT.get(code)!
      set[node >> 5] |= 1 << (node & 31)
    }
    return set
  })
  const tooAlike = (one: number, other: number): boolean => {
    let inter = 0
    for (let word = 0; word < words; word++) {
      let x = bits[one][word] & bits[other][word]
      x = x - ((x >>> 1) & 0x55555555)
      x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
      inter += (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
    }
    const union = ordered[one].fairway.length + ordered[other].fairway.length - inter
    return inter / union > FAIRWAY_MAX_OVERLAP
  }

  const seen = new Map<string, number>()
  const taken = new Uint8Array(ordered.length)
  const dead = new Uint8Array(ordered.length)
  let kept = 0
  let alive = ordered.length
  for (let cap = 1; kept < FAIRWAY_POOL && alive > 0 && cap <= FAIRWAY_TRUNK_CAP; cap++) {
    // `idx` not `at`: `at(table, from, to)` is a helper declared above.
    for (let idx = 0; idx < ordered.length && kept < FAIRWAY_POOL; idx++) {
      if (taken[idx] || dead[idx]) continue
      if (ordered[idx].fairway.some((code) => (seen.get(code) ?? 0) >= cap)) continue
      for (const code of ordered[idx].fairway) seen.set(code, (seen.get(code) ?? 0) + 1)
      taken[idx] = 1
      kept++
      alive--
      for (let other = 0; other < ordered.length; other++) {
        if (taken[other] || dead[other] || other === idx) continue
        if (tooAlike(idx, other)) {
          dead[other] = 1
          alive--
        }
      }
    }
  }
  // Filed in the deterministic walk order rather than the order taken, so the
  // committed file cannot depend on the fill's internal state.
  // `idx` not `at`, as above.
  for (let idx = 0; idx < ordered.length; idx++) {
    if (taken[idx]) file('fairway', ordered[idx].hole)
  }
}

// Everything the pool claims, checked against a plain reading of the rules
// rather than against the tables that generated it. `cheapest` is the slow
// obvious search; `matrixFor` is the fast one. They have to agree.
for (const [difficulty, combos] of Object.entries(pool)) {
  for (const [name, entries] of Object.entries(combos)) {
    const combo = name as Combo

    // Every difficulty holds every hole that carries one barrier or none, so a
    // Monday can be a dogleg and a Saturday can be plain.
    //
    // Two barriers are a different matter, and the exception is the map's
    // rather than a policy: `easy` is exactly `best === 3`, and a barrier only
    // earns a place here if it bites, so two of them need an open route of one
    // or two countries to land back on three — and a waypoint may not border an
    // endpoint. Measured, there are none at all. The rotation in
    // `src/game/daily.ts` therefore offers doubles to medium and hard only, and
    // `daily.test.ts` checks that what it offers is what the pool holds.
    if (TAIL[combo].length <= 1 || difficulty !== 'easy') {
      assert(entries.length > 0, `${difficulty} holds no "${combo}" holes`)
    }

    for (const entry of entries) {
      // Decoded the way the server will decode it, which for the fairway means
      // the complement expands here too — so every assert below runs against
      // the closed list a player would actually be handed, and a tombstone in
      // `LINK_CODES` (a code the graph no longer holds) fails the country
      // check rather than shipping.
      const hole = holeOf(combo, entry)
      const { start, end, best } = hole
      const tail = TAIL[combo]
      const where = `${combo} ${start}->${end}`

      assert(
        graph[start].component === graph[end].component,
        `${where} spans two components and can never be solved`,
      )
      assert(difficultyOf(best) === difficulty, `${where} is in the wrong bucket`)
      assert(inRange(best), `${where} has a route length of ${best}, outside the pool's range`)

      const shut = hole.closed?.length ? new Set(hole.closed) : undefined
      const priced = hole.rough?.length ? new Set(hole.rough) : undefined

      for (const code of hole.closed ?? []) {
        assert(code in graph, `${where} closes ${code}, which is not a country`)
        assert(code !== start && code !== end, `${where} closes one of its own endpoints`)
      }
      for (const code of hole.rough ?? []) {
        assert(code in graph, `${where} roughens ${code}, which is not a country`)
        // Not taste: the premium is charged on arriving, so a rough endpoint
        // makes the hole cost different amounts from either end, and half the
        // pool's pairs are served backwards.
        assert(code !== start && code !== end, `${where} roughens one of its own endpoints`)
        assert(!shut?.has(code), `${where} both shuts and roughens ${code}`)
      }
      for (const code of hole.required ?? []) {
        assert(code in graph, `${where} requires ${code}, which is not a country`)
        assert(code !== start && code !== end, `${where} requires one of its own endpoints`)
        assert(!shut?.has(code), `${where} both shuts and requires ${code}`)
        assert(!priced?.has(code), `${where} both roughens and requires ${code}`)
        assert(
          !links[code].includes(start) && !links[code].includes(end),
          `${where} requires ${code}, which already touches an endpoint`,
        )
      }

      // The floor, recomputed — and on a dogleg, recomputed by a *different
      // algorithm*. `viaCostOf` is a min-cost flow; `suurballe` is two Dijkstras
      // with a reweighted second pass. They answer the same question and share
      // no code, which is the same relationship `cheapest` has to `matrixFor`
      // and the only kind of check worth running against a number the browser
      // will independently re-derive.
      const via = hole.required?.[0]
      const floor =
        via === undefined
          ? cheapest(links, linkCost, start, shut, priced).get(end)
          : suurballe(start, end, via, shut, priced)
      assert(floor === best + 1, `${where} is not actually solvable in ${best} countries`)
      if (via !== undefined) {
        assert(
          hole.required!.length === 1,
          `${where} asks for more than one country to pass through`,
        )
        // The third rule, stated where the pool can be held to it: a waypoint a
        // route cannot go in one border and out another of would be a hole
        // nobody could finish. `suurballe` returning a number *is* that proof.
        assert(Number.isFinite(floor!), `${where} requires ${via}, which no route can pass through`)
      }

      // Every barrier has to bite, or it is decoration wearing a mechanic's
      // clothes: the same pair without it must be strictly cheaper. The
      // fairway is the one exemption, in both directions at once: a straight
      // course holds every cheapest route and leaves the floor exactly where
      // it was, while a bent one is priced by its closure like `bounds` is.
      // What no course may ever be is *cheaper* carved than open — and the
      // generic floor recheck above has already pinned `best + 1` against the
      // carved board, so the open floor only needs its bound.
      if (combo === 'fairway') {
        assert(
          cheapest(links, linkCost, start).get(end)! <= best + 1,
          `${where} claims a floor under the open route, which nothing can`,
        )
        // The rough is an option on the outskirts and never the answer: the
        // fairway alone, band shut, must already play at the claimed floor.
        // Without this a bent course can be a decoy — the arc drawn open, the
        // direct line priced a stroke a country, and optimal play cutting
        // straight through the rough.
        assert(
          cheapest(links, linkCost, start, new Set([...hole.closed!, ...hole.rough!])).get(end) ===
            best + 1,
          `${where} plays cheaper through its rough than down its fairway`,
        )
        assert(
          hole.closed!.length > FAIRWAY_LIMIT,
          `${where} shuts only ${hole.closed!.length} countries and would not read as a fairway`,
        )
        assert(hole.rough!.length > 0, `${where} has no rough band at all`)
      } else if (tail.length > 0) {
        assert(
          cheapest(links, linkCost, start).get(end)! < best + 1,
          `${where} carries a barrier that changes nothing`,
        )
      }
    }
  }
}

// The globe geometry goes out as a runtime asset rather than into the bundle.
// Its country names are stripped: the whole game rests on shapes being unnamed
// until the player pays for them, so the names have no business being shipped.
for (const geometry of topology.objects.countries.geometries) delete geometry.properties

writeFileSync(join(ROOT, 'src/data/graph.json'), JSON.stringify(graph, null, 1) + '\n')
// Ships to the browser: the rules only need `sea` on each country, but the
// globe needs to know where to draw the line.
writeFileSync(join(ROOT, 'src/data/crossings.json'), JSON.stringify(crossings, null, 1) + '\n')
// Ships to the browser: free play builds a round client-side, so the region a
// round names has to be resolvable without asking the server. The `basis` is
// left behind — it is why the region exists, not something a player reads.
writeFileSync(
  join(ROOT, 'src/data/regions.json'),
  JSON.stringify(
    regions.map(({ name, countries: inRegion }) => ({ name, countries: inRegion })),
    null,
    1,
  ) + '\n',
)
writeFileSync(join(ROOT, 'functions/data/pairs.json'), JSON.stringify(pool) + '\n')
writeFileSync(join(ROOT, 'public/countries-110m.json'), JSON.stringify(topology) + '\n')

const countOf = (difficulty: Difficulty) =>
  COMBOS.reduce((n, combo) => n + pool[difficulty][combo].length, 0)
const total = countOf('easy') + countOf('medium') + countOf('hard')
console.log(
  `countries      ${countries.length} of ${members.length} UN members (rest have no polygon at ${GEOMETRY_RESOLUTION})`,
)
console.log(
  `components     ${groups.length} — one world of ${sizes[0]}, ${stranded.length} still stranded (${stranded.join(', ')})`,
)
console.log(
  `regions        ${regions.length} named, ${new Set(regions.flatMap((r) => r.countries)).size} countries covered`,
)
console.log(
  `crossings      ${seaLinks.length} sea links, a forest over the ${landSizes.length} landmasses (${seaLinks.filter((l) => l.kind === 'dormant').length} dormant)`,
)
console.log(
  `dropped        ${oneWay.map(([a, b]) => `${a}->${b}`).join(', ')} (known maritime claims)`,
)
console.log(
  `puzzles        ${total}  easy ${countOf('easy')} · medium ${countOf('medium')} · hard ${countOf('hard')}`,
)
console.log(`holes by combination`)
for (const combo of COMBOS) {
  const counts = (['easy', 'medium', 'hard'] as const).map((d) => pool[d][combo].length)
  console.log(
    `  ${combo.padEnd(15)} ${String(counts[0] + counts[1] + counts[2]).padStart(6)}` +
      `   easy ${String(counts[0]).padStart(5)} · medium ${String(counts[1]).padStart(5)} · hard ${String(counts[2]).padStart(5)}`,
  )
}
console.log(
  `route histogram  ${[...histogram.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([best, n]) => `${best}:${n}`)
    .join(' ')}`,
)
