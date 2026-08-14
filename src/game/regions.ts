/**
 * The named regions a round can put in the rough or shut altogether.
 *
 * Curated in `data/regions.json` and emitted by `scripts/build-data.ts`, so
 * this ships with the bundle for the same reason the graph does: free play
 * builds a round in the browser and cannot wait on a server to find out what
 * "the Maghreb" means.
 *
 * A region is a name and a list, and the rules never learn it exists —
 * `Puzzle.rough` is a plain list of countries. The name is for the player: a
 * banner that says "the Maghreb is rough today" is a mechanic, and four greyed
 * anonymous shapes are a puzzle about what the game is doing.
 */
import data from '../data/regions.json' with { type: 'json' }
import { type CountryCode, distance, without } from './graph'

export type Region = {
  name: string
  countries: CountryCode[]
}

export const REGIONS = data as Region[]

/**
 * The names that take a plural verb: "the Alps **are** rough today".
 *
 * Written out rather than guessed at. The tell people reach for is a trailing
 * s, and the Caucasus is the counter-example sitting in this very list — as is
 * every name that is plural without one. It is not in `data/regions.json`
 * either, tempting as that is: that file is an input to `build:data`, and
 * adding a field to it means regenerating `pairs.json`, which reshuffles every
 * date for a fact about English.
 *
 * `regions.test.ts` holds each of these to a region that exists, so a rename
 * cannot quietly leave one behind.
 */
const PLURAL_NAMES: ReadonlySet<string> = new Set([
  'The Alps',
  'The Anatolian and Iranian highlands',
  'The Carpathians',
])

/** Whether this region's name is a plural, for the sentence it goes into. */
export function regionIsPlural(region: Region): boolean {
  return PLURAL_NAMES.has(region.name)
}

export function regionNamed(name: string): Region | undefined {
  return REGIONS.find((region) => region.name === name)
}

/**
 * The region these countries are exactly, if they are one.
 *
 * How a round that arrived as a bare list of countries — from a link, or from
 * the pool — gets its name back. Exact rather than nearest: a set that is
 * *nearly* the Maghreb is not the Maghreb, and calling it that in the banner
 * would be a lie about which countries are rough.
 */
export function regionOf(countries: readonly CountryCode[]): Region | undefined {
  if (countries.length === 0) return undefined
  const wanted = new Set(countries)
  if (wanted.size !== countries.length) return undefined
  return REGIONS.find(
    (region) =>
      region.countries.length === wanted.size && region.countries.every((code) => wanted.has(code)),
  )
}

/** A region, and what putting it in the rough does to this particular route. */
export type RoughOption = {
  region: Region
  /** What a perfect round costs with the region priced. */
  best: number
  /** What it would cost to route round the region entirely, or null. */
  around: number | null
}

/**
 * Every region that actually changes this route, dearest first.
 *
 * The same service `hazardsFor` does for closures, and for the same reason:
 * most regions do nothing to most routes, and a player left to guess would
 * mostly pick ones that change nothing. A region already off the route is not
 * a harder puzzle, it is the same puzzle with some countries coloured in.
 *
 * Regions containing either endpoint are left out rather than reported — the
 * premium is charged on arrival, so a rough endpoint makes the hole cost
 * different amounts measured from either end, and `newGame` refuses it.
 */
export function roughFor(start: CountryCode, end: CountryCode): RoughOption[] {
  const open = distance(start, end)
  if (open === null) return []

  const found: RoughOption[] = []
  for (const region of REGIONS) {
    const countries = new Set(region.countries)
    if (countries.has(start) || countries.has(end)) continue

    const priced = distance(start, end, undefined, countries)
    if (priced === null || priced === open) continue

    found.push({
      region,
      best: priced - 1,
      around: (() => {
        const skirted = distance(start, end, without(region.countries))
        return skirted === null ? null : skirted - 1
      })(),
    })
  }

  return found.sort((a, b) => b.best - a.best || a.region.name.localeCompare(b.region.name))
}

/** A region, and what shutting it does to this particular route. */
export type BoundsOption = {
  region: Region
  /** What a perfect round costs with the region shut. */
  best: number
}

/**
 * Every region whose shutting genuinely lengthens this route, longest first.
 *
 * What `hazardsFor` does for a single country, for a whole place. The two are
 * different mechanics rather than the same one at two sizes — a closed border
 * is a country you cannot enter, and out of bounds is a part of the world the
 * round has been ruled off — but the arithmetic is identical, so the filter is
 * too: regions that change nothing are left out, and so are regions whose
 * shutting cuts every route, which is not a harder puzzle but no puzzle.
 */
export function boundsFor(start: CountryCode, end: CountryCode): BoundsOption[] {
  const open = distance(start, end)
  if (open === null) return []

  const found: BoundsOption[] = []
  for (const region of REGIONS) {
    const countries = new Set(region.countries)
    if (countries.has(start) || countries.has(end)) continue

    const shut = distance(start, end, without(region.countries))
    if (shut === null || shut <= open) continue

    found.push({ region, best: shut - 1 })
  }

  return found.sort((a, b) => b.best - a.best || a.region.name.localeCompare(b.region.name))
}
