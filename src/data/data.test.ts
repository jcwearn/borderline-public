/**
 * `scripts/build-data.ts` asserts as it generates. These tests assert against
 * what actually got committed, which is what the game will really load — they
 * catch a graph.json that was hand-edited or left stale after a data change.
 */
import { describe, expect, it } from 'vitest'
import graph from './graph.json' with { type: 'json' }
import geometry from '../../public/countries-110m.json' with { type: 'json' }
import rawSeaLinks from '../../data/sea-links.json' with { type: 'json' }
import rawCrossings from '../data/crossings.json' with { type: 'json' }
import rawRegions from '../../data/regions.json' with { type: 'json' }
import builtRegions from './regions.json' with { type: 'json' }
// The one statement of what a crossing costs, which the build generates against
// and the game scores against. Restating it here was how it used to be, and a
// third copy free to drift was exactly the risk.
import { SEA_COST } from '../game/terrain'

type Node = {
  name: string
  flag: string
  ccn3: string
  latlng: number[]
  borders: string[]
  sea: string[]
  component: number
}

/** Kilometres between two [lat, lng] points, as the crow flies. */
function greatCircle([lat1, lng1]: number[], [lat2, lng2]: number[]): number {
  const rad = Math.PI / 180
  const half =
    0.5 -
    Math.cos((lat2 - lat1) * rad) / 2 +
    (Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * (1 - Math.cos((lng2 - lng1) * rad))) / 2
  return 2 * 6371 * Math.asin(Math.sqrt(half))
}

const nodes = graph as Record<string, Node>

/**
 * Cheapest cost, by relaxing every link until nothing improves.
 *
 * Deliberately not the algorithm being checked: the game runs Dijkstra, and a
 * second opinion is only worth having if it can be wrong in different ways.
 * This one is too slow to ship and too simple to get wrong — but it runs once
 * per pool entry, so it avoids allocating inside the loop, which is the whole
 * difference between a few seconds and half a minute.
 */
function distance(from: string, to: string, closed?: string): number | null {
  const best = new Map<string, number>([[from, 0]])
  let moved = true
  while (moved) {
    moved = false
    // Entries added mid-iteration are visited by the same pass, which is only
    // ever a shortcut: the loop still ends when nothing improves.
    for (const [code, so_far] of best) {
      if (code === closed) continue
      const node = nodes[code]
      for (const other of node.borders) {
        if (other === closed) continue
        if (so_far + 1 < (best.get(other) ?? Number.POSITIVE_INFINITY)) {
          best.set(other, so_far + 1)
          moved = true
        }
      }
      for (const other of node.sea) {
        if (other === closed) continue
        if (so_far + SEA_COST < (best.get(other) ?? Number.POSITIVE_INFINITY)) {
          best.set(other, so_far + SEA_COST)
          moved = true
        }
      }
    }
  }
  return best.get(to) ?? null
}

describe('graph.json', () => {
  it('holds every UN member state that has a polygon to click', () => {
    expect(Object.keys(nodes)).toHaveLength(165)
  })

  it('omits countries too small to render, so every country is clickable', () => {
    for (const code of ['AND', 'LIE', 'MCO', 'SMR', 'VAT', 'SGP', 'MLT', 'BRB']) {
      expect(nodes[code], code).toBeUndefined()
    }
  })

  it('only references countries it contains', () => {
    for (const [code, node] of Object.entries(nodes)) {
      for (const neighbour of node.borders) {
        expect(nodes[neighbour], `${code} -> ${neighbour}`).toBeDefined()
      }
    }
  })

  it('is symmetric — a border is claimed from both sides', () => {
    for (const [code, node] of Object.entries(nodes)) {
      for (const neighbour of node.borders) {
        expect(nodes[neighbour].borders, `${neighbour} should border ${code}`).toContain(code)
      }
    }
  })

  it('never lists a country as its own neighbour', () => {
    for (const [code, node] of Object.entries(nodes)) {
      expect(node.borders).not.toContain(code)
    }
  })

  it('gives every country the identifiers the globe and UI need', () => {
    for (const [code, node] of Object.entries(nodes)) {
      expect(node.name, code).toBeTruthy()
      expect(node.flag, code).toBeTruthy()
      expect(node.ccn3, code).toMatch(/^\d{3}$/)
    }
  })

  it('joins one-to-one with globe geometry via ccn3', () => {
    const seen = new Set(Object.values(nodes).map((n) => n.ccn3))
    expect(seen.size).toBe(Object.keys(nodes).length)
  })

  it('agrees with its own component labels', () => {
    for (const [code, node] of Object.entries(nodes)) {
      for (const neighbour of node.borders) {
        expect(nodes[neighbour].component, `${code}/${neighbour}`).toBe(node.component)
      }
    }
  })

  it('is one world once the crossings are counted', () => {
    const sizes = new Map<number, number>()
    for (const node of Object.values(nodes)) {
      sizes.set(node.component, (sizes.get(node.component) ?? 0) + 1)
    }
    expect(sizes.get(0)).toBe(161)
    // Fiji, New Zealand, the Solomons and Vanuatu, each alone.
    expect([...sizes.values()].filter((n) => n === 1)).toHaveLength(4)
    expect(nodes.NGA.component).toBe(0)
    expect(nodes.KOR.component).toBe(0)
    // The Bering Strait put the Americas on the same board as everything else.
    expect(nodes.USA.component).toBe(0)
    expect(nodes.FJI.component).not.toBe(0)
  })

  it('leaves the land game exactly as it was', () => {
    // Crossings form a forest over the landmasses, so every one is a bridge and
    // none of them can offer a second way between two countries already joined.
    // If that ever breaks, existing puzzles silently change length.
    expect(nodes.JPN.borders).toEqual([])
    expect(nodes.GBR.borders).toEqual(['IRL'])
    for (const [code, node] of Object.entries(nodes)) {
      for (const other of node.sea) {
        expect(node.borders, `${code} - ${other}`).not.toContain(other)
      }
    }
  })

  it('gives every island nothing reaches an empty crossing list', () => {
    for (const stranded of ['FJI', 'NZL', 'SLB', 'VUT']) {
      expect(nodes[stranded].sea, stranded).toEqual([])
      expect(nodes[stranded].borders, stranded).toEqual([])
    }
  })

  it('joins each island to the world it was missing', () => {
    for (const island of ['JPN', 'CUB', 'ISL', 'MDG', 'PHL', 'AUS', 'LKA', 'CYP', 'BHS', 'JAM']) {
      expect(nodes[island].sea.length, island).toBeGreaterThan(0)
      expect(nodes[island].component, island).toBe(0)
    }
  })

  it('leaves island nations isolated, since this is a land-border game', () => {
    for (const code of ['JPN', 'AUS', 'MDG', 'ISL', 'CUB', 'LKA', 'NZL']) {
      expect(nodes[code].borders, code).toEqual([])
    }
  })

  it('keeps the land borders that island nations genuinely have', () => {
    expect(nodes.GBR.borders).toEqual(['IRL'])
    expect(nodes.HTI.borders).toEqual(['DOM'])
  })
})

describe('globe geometry', () => {
  const topology = geometry as unknown as {
    objects: { countries: { geometries: Array<{ id?: string; properties?: unknown }> } }
  }
  const shapes = topology.objects.countries.geometries

  it('carries no country names, which the player is supposed to buy', () => {
    for (const shape of shapes) {
      expect(shape.properties).toBeUndefined()
    }
  })

  it('has a polygon for every country in the graph, so all are clickable', () => {
    const drawable = new Set(shapes.map((s) => s.id))
    for (const [code, node] of Object.entries(nodes)) {
      expect(drawable.has(node.ccn3), `${code} (${node.ccn3}) has no polygon`).toBe(true)
    }
  })

  it('leaves only non-member territory unclaimed, drawn as inert terrain', () => {
    const byCcn3 = new Set(Object.values(nodes).map((n) => n.ccn3))
    const unclaimed = shapes.filter((s) => !s.id || !byCcn3.has(s.id))
    // Western Sahara, Falklands, Greenland, Fr. S. Antarctic Lands, Puerto
    // Rico, Palestine, New Caledonia, Taiwan, Antarctica, and Kosovo in three
    // fragments with no id at all.
    expect(unclaimed).toHaveLength(12)
  })
})

describe('sea-links.json', () => {
  const seaLinks = rawSeaLinks as unknown as Array<{
    link: [string, string]
    kind: string
    from: [number, number]
    to: [number, number]
    basis: string
  }>

  it('names only countries the graph contains, in alphabetical order', () => {
    for (const { link } of seaLinks) {
      const [a, b] = link
      expect(nodes[a], a).toBeDefined()
      expect(nodes[b], b).toBeDefined()
      expect(a.localeCompare(b)).toBeLessThan(0)
    }
  })

  it('justifies every crossing, because the justification is the inclusion rule', () => {
    for (const { link, kind, basis } of seaLinks) {
      expect(['fixed', 'ferry', 'strait', 'dormant'], link.join('-')).toContain(kind)
      expect(basis.trim().length, link.join('-')).toBeGreaterThan(20)
    }
  })

  it('is exactly what ended up in the graph', () => {
    const fromFile = new Set(seaLinks.map(({ link }) => link.join('-')))
    const fromGraph = new Set<string>()
    for (const [code, node] of Object.entries(nodes)) {
      for (const other of node.sea) fromGraph.add([code, other].sort().join('-'))
    }
    expect([...fromGraph].sort()).toEqual([...fromFile].sort())
  })

  it('is drawn across the right water, not between the two countries', () => {
    // Between country centroids the Bering Strait is a 9,000 km line from
    // Siberia to Kansas. Drawn Chukotka to Alaska it is 1,548 km, which points
    // at the right place and is still long enough to pick out on the globe.
    for (const { link, from, to } of seaLinks) {
      const [a, b] = link
      const drawn = greatCircle(from, to)
      const middles = greatCircle(nodes[a].latlng, nodes[b].latlng)
      expect(drawn, `${a}-${b} drawn ${Math.round(drawn)}km`).toBeLessThanOrEqual(middles)
      expect(drawn, `${a}-${b} drawn ${Math.round(drawn)}km`).toBeLessThan(2000)
    }
  })

  it('puts each end on its own side of the water', () => {
    // Catches a swapped pair, which is the realistic way to get this wrong.
    for (const { link, from, to } of seaLinks) {
      const [a, b] = link
      expect(greatCircle(from, nodes[a].latlng), `${a}-${b} from`).toBeLessThan(
        greatCircle(to, nodes[a].latlng),
      )
      expect(greatCircle(to, nodes[b].latlng), `${a}-${b} to`).toBeLessThan(
        greatCircle(from, nodes[b].latlng),
      )
    }
  })

  it('ships to the browser exactly what the file says', () => {
    const crossings = rawCrossings as unknown as Array<{
      link: [string, string]
      from: [number, number]
      to: [number, number]
    }>
    expect(crossings).toHaveLength(seaLinks.length)
    for (const { link, from, to } of seaLinks) {
      const shipped = crossings.find((c) => c.link.join('-') === link.join('-'))
      expect(shipped, link.join('-')).toBeDefined()
      expect(shipped!.from).toEqual(from)
      expect(shipped!.to).toEqual(to)
    }
  })

  it('never duplicates a land border', () => {
    for (const { link } of seaLinks) {
      const [a, b] = link
      expect(nodes[a].borders, link.join('-')).not.toContain(b)
    }
  })
})

describe('regions.json', () => {
  type Region = { name: string; countries: string[]; basis: string }
  const regions = rawRegions as Region[]
  const built = builtRegions as { name: string; countries: string[] }[]

  it('ships exactly what was curated, minus the reasoning', () => {
    // The `basis` is why a region exists, not something a player ever reads, so
    // it stays in the source file and out of the bundle.
    expect(built).toEqual(regions.map(({ name, countries }) => ({ name, countries })))
  })

  it('names only countries the graph holds', () => {
    for (const { name, countries } of regions) {
      for (const code of countries) expect(nodes[code], `${name} names ${code}`).toBeDefined()
    }
  })

  it('gives every region a name of its own', () => {
    const names = regions.map((region) => region.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('justifies every region, because the banner has to name it', () => {
    for (const { name, basis } of regions) {
      expect(basis.trim().length, name).toBeGreaterThan(20)
    }
  })

  it('keeps every region in one piece', () => {
    // A region in two pieces is two regions, and shutting it would grey two
    // unrelated parts of the globe under a single name.
    for (const { name, countries } of regions) {
      const inside = new Set(countries)
      const seen = new Set([countries[0]])
      const queue = [countries[0]]
      for (let head = 0; head < queue.length; head++) {
        for (const link of [...nodes[queue[head]].borders, ...nodes[queue[head]].sea]) {
          if (inside.has(link) && !seen.has(link)) {
            seen.add(link)
            queue.push(link)
          }
        }
      }
      expect(seen.size, `${name} is not connected`).toBe(countries.length)
    }
  })

  it('lets regions overlap but never nest', () => {
    // The Alps and Central Europe share Switzerland and Austria, deliberately —
    // a country may belong to more than one region and no round applies two at
    // once. Containment is the case that would make the smaller unreachable.
    for (const outer of regions) {
      for (const inner of regions) {
        if (outer === inner) continue
        const held = new Set(outer.countries)
        expect(
          inner.countries.every((code) => held.has(code)),
          `${inner.name} sits inside ${outer.name}`,
        ).toBe(false)
      }
    }
  })

  it('gives every region something to bite on', () => {
    // The one that stops a region being decoration. A region no cheapest route
    // runs through can be marked rough all day and change nothing — and that is
    // not hypothetical: Central Asia, the Balkans and the Baltics are all
    // perfectly good regions that no route between two other countries uses.
    const sample = Object.keys(nodes).filter((_, index) => index % 4 === 0)
    for (const { name, countries } of regions) {
      const inside = new Set(countries)
      const bites = sample.some((from) =>
        sample.some((to) => {
          if (from >= to || inside.has(from) || inside.has(to)) return false
          const open = distance(from, to)
          if (open === null || open - 1 < 3 || open - 1 > 10) return false
          // Shut the region: if that lengthens the route, some cheapest route
          // ran through it, which is exactly what "bites" means.
          const round = shutDistance(from, to, inside)
          return round === null || round > open
        }),
      )
      expect(bites, `${name} is on no cheapest route and would be decoration`).toBe(true)
    }
  })
})

/** `distance`, but with a whole set shut rather than a single country. */
function shutDistance(from: string, to: string, shut: ReadonlySet<string>): number | null {
  if (shut.has(from) || shut.has(to)) return null
  const best = new Map<string, number>([[from, 0]])
  let moved = true
  while (moved) {
    moved = false
    for (const [code, so_far] of best) {
      const node = nodes[code]
      for (const other of node.borders) {
        if (shut.has(other)) continue
        if (so_far + 1 < (best.get(other) ?? Number.POSITIVE_INFINITY)) {
          best.set(other, so_far + 1)
          moved = true
        }
      }
      for (const other of node.sea) {
        if (shut.has(other)) continue
        if (so_far + SEA_COST < (best.get(other) ?? Number.POSITIVE_INFINITY)) {
          best.set(other, so_far + SEA_COST)
          moved = true
        }
      }
    }
  }
  return best.get(to) ?? null
}
