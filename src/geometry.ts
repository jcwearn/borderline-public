/**
 * Globe geometry: Natural Earth country polygons, joined to the game graph.
 *
 * Fetched at runtime rather than bundled, and stripped of its country names by
 * the data build — the whole game rests on a shape being anonymous until the
 * player pays for its name, so the names never reach the browser.
 */
import { feature } from 'topojson-client'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import { GRAPH, type CountryCode } from './game/graph'

export type CountryFeature = Feature<Polygon | MultiPolygon> & {
  /** The country this shape is, or `null` for terrain that is not in play. */
  code: CountryCode | null
}

let cache: Promise<CountryFeature[]> | null = null

/**
 * Every polygon on the globe. Those that match a playable country carry its
 * code; disputed territories, dependencies and Antarctica carry `null` and are
 * drawn as inert terrain — visible, so the world still looks like the world,
 * but not clickable and never named.
 */
export function loadCountryFeatures(): Promise<CountryFeature[]> {
  cache ??= fetchFeatures()
  return cache
}

/** A name's footprint on screen, in pixels, centred on the country it marks. */
export type LabelBox = {
  code: CountryCode
  x: number
  y: number
  width: number
  height: number
}

/**
 * Which of these names can be drawn without landing on top of each other.
 *
 * Zoomed out, the Balkans collapse into a pile of overlapping text that names
 * nothing. A blanket zoom threshold would fix that by also hiding a name with
 * an ocean of room around it, so instead each name is kept only if it clears
 * every name already kept. Earlier entries win, which makes the caller's order
 * the priority order: the two endpoints first, then the route as it was built.
 */
export function fitLabels(boxes: readonly LabelBox[], gap = 0): Set<CountryCode> {
  const kept: LabelBox[] = []
  const fits = new Set<CountryCode>()

  for (const box of boxes) {
    if (kept.some((other) => overlaps(box, other, gap))) continue
    kept.push(box)
    fits.add(box.code)
  }
  return fits
}

/** Two centred boxes overlap when their gap-padded half-widths reach. */
function overlaps(a: LabelBox, b: LabelBox, gap: number): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width + gap * 2 &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height + gap * 2
  )
}

async function fetchFeatures(): Promise<CountryFeature[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}countries-110m.json`)
  if (!response.ok) throw new Error(`could not load globe geometry (${response.status})`)

  const topology = (await response.json()) as Topology<{ countries: GeometryCollection }>
  const collection = feature(topology, topology.objects.countries)

  const byCcn3 = new Map<string, CountryCode>(
    Object.entries(GRAPH).map(([code, country]) => [country.ccn3, code]),
  )

  return collection.features.map((shape) => ({
    ...(shape as Feature<Polygon | MultiPolygon>),
    code: byCcn3.get(String(shape.id)) ?? null,
  }))
}
