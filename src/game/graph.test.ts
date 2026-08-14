/**
 * The search primitives everything else is built on.
 *
 * These had no direct tests before — they were only ever exercised through the
 * rules — which is uncomfortable for the one module a wrong answer would show
 * up in as a subtly wrong route rather than as a crash.
 */
import { describe, expect, it } from 'vitest'
import {
  CODES,
  GRAPH,
  connectable,
  cost,
  country,
  distance,
  beyond,
  costsFrom,
  exists,
  isSea,
  neighbours,
  ROUGH_COST,
  SEA_COST,
  costVia,
  links,
  routeVia,
  search,
  searchVia,
  shortestPath,
  without,
} from './graph'

/**
 * An independent cheapest-cost search, written the slow obvious way: relax
 * every link over and over until nothing improves. Far too slow to ship and
 * far too simple to be wrong, which is exactly what a second opinion should be.
 *
 * Answers for the whole map at once, for the reason `costsFrom` exists: the
 * relaxation has already settled every country by the time it has settled any
 * one of them, so asking per destination did the same work 165 times over and
 * left the test a hair under its timeout — reliably over it whenever the rest
 * of the suite was running alongside.
 */
function referenceCosts(
  from: string,
  rough?: ReadonlySet<string>,
  within?: ReadonlySet<string>,
): Map<string, number> {
  if (within && !within.has(from)) return new Map()
  const best = new Map([[from, 0]])
  for (let round = 0; round < CODES.length; round++) {
    let moved = false
    for (const [code, so_far] of [...best]) {
      const node = GRAPH[code]
      for (const other of [...node.borders, ...node.sea]) {
        if (within && !within.has(other)) continue
        const next =
          so_far +
          (node.sea.includes(other) ? SEA_COST : 1) +
          (rough?.has(other) ? ROUGH_COST - 1 : 0)
        if (next < (best.get(other) ?? Number.POSITIVE_INFINITY)) {
          best.set(other, next)
          moved = true
        }
      }
    }
    if (!moved) break
  }
  return best
}

/**
 * Every seventh country, against all 165 targets — about four thousand routes.
 *
 * Sampled on the source side only: a full 165x165 sweep is twenty-seven
 * thousand searches per test and took the whole suite from under a second to
 * over five, which is a price worth paying only if it caught something the
 * sample misses. Deterministic, so a failure is always reproducible.
 */
const SOURCES = CODES.filter((_, index) => index % 7 === 0)

describe('search', () => {
  it('agrees with a plain breadth-first search', () => {
    for (const from of SOURCES) {
      const reference = referenceCosts(from)
      for (const to of CODES) {
        expect(distance(from, to), `${from} -> ${to}`).toBe(reference.get(to) ?? null)
      }
    }
  })

  it('returns a route whose cost is the sum of the links it uses', () => {
    for (const [from, to] of [
      ['NGA', 'KOR'],
      ['PRT', 'CHN'],
      ['FRA', 'POL'],
      ['LSO', 'EGY'],
    ]) {
      const found = search(from, to)!
      const summed = found.path
        .slice(1)
        .reduce((total, code, index) => total + cost(found.path[index], code), 0)
      expect(summed, `${from} -> ${to}`).toBe(found.cost)
    }
  })

  it('returns a route that is actually a route', () => {
    for (const [from, to] of [
      ['NGA', 'KOR'],
      ['PRT', 'CHN'],
      ['LSO', 'EGY'],
    ]) {
      const path = shortestPath(from, to)!
      expect(path.at(0)).toBe(from)
      expect(path.at(-1)).toBe(to)
      expect(new Set(path).size, 'visits nothing twice').toBe(path.length)
      for (let i = 1; i < path.length; i++) {
        expect(neighbours(path[i - 1]), `${path[i - 1]} -> ${path[i]}`).toContain(path[i])
      }
    }
  })

  it('costs nothing to stay where you are', () => {
    expect(search('FRA', 'FRA')).toEqual({ cost: 0, path: ['FRA'] })
    expect(distance('FRA', 'FRA')).toBe(0)
  })

  it('finds no route to a country nothing reaches', () => {
    // The four left with neither a land border nor a curated crossing.
    for (const stranded of ['FJI', 'NZL', 'SLB', 'VUT']) {
      expect(search('FRA', stranded), stranded).toBeNull()
    }
  })

  it('crosses water now that there are crossings', () => {
    expect(distance('KOR', 'JPN')).toBe(SEA_COST)
    expect(shortestPath('FRA', 'GBR')).toEqual(['FRA', 'GBR'])
    // The Bering Strait is what joins the Americas to everything else.
    expect(distance('RUS', 'USA')).toBe(SEA_COST)
    expect(distance('FRA', 'BRA')).not.toBeNull()
  })

  it('charges a crossing more than a land border', () => {
    // Going the long way round by land beats a crossing whenever the land route
    // is shorter than the premium, which is the decision the cost is there for.
    expect(cost('FRA', 'GBR')).toBe(SEA_COST)
    expect(cost('FRA', 'DEU')).toBe(1)
    expect(SEA_COST).toBeGreaterThan(1)
  })

  it('is symmetric, since every border is', () => {
    for (const from of SOURCES) {
      for (const to of CODES) {
        expect(distance(from, to), `${from} -> ${to}`).toBe(distance(to, from))
      }
    }
  })
})

describe('a stable route', () => {
  // Pinned exactly. Any of these changing means `detours` and the share grid
  // change with it, so a diff here is a decision rather than an accident.
  it('picks the same route every time', () => {
    expect(shortestPath('FRA', 'POL')).toEqual(['FRA', 'DEU', 'POL'])
    expect(shortestPath('PRT', 'CHN')).toEqual(['PRT', 'ESP', 'FRA', 'DEU', 'POL', 'RUS', 'CHN'])
  })

  it('picks the same route for the puzzle from the video', () => {
    expect(shortestPath('NGA', 'KOR')).toEqual([
      'NGA',
      'NER',
      'DZA',
      'MAR',
      'ESP',
      'FRA',
      'DEU',
      'POL',
      'RUS',
      'PRK',
      'KOR',
    ])
  })

  it('does not depend on which end you start from', () => {
    const there = shortestPath('PRT', 'CHN')!
    const back = shortestPath('CHN', 'PRT')!
    expect(back.length).toBe(there.length)
  })
})

describe('searching a subset', () => {
  it('only walks countries inside the set', () => {
    const open = new Set(['FRA', 'DEU', 'POL'])
    expect(shortestPath('FRA', 'POL', open)).toEqual(['FRA', 'DEU', 'POL'])
  })

  it('finds nothing when the set leaves no way through', () => {
    expect(distance('FRA', 'POL', new Set(['FRA', 'POL']))).toBeNull()
  })

  it('finds nothing when either end is outside the set', () => {
    expect(distance('FRA', 'POL', new Set(['DEU', 'POL']))).toBeNull()
    expect(distance('FRA', 'POL', new Set(['FRA', 'DEU']))).toBeNull()
  })

  it('routes the long way round when the short way is excluded', () => {
    // Germany is the whole of France -> Poland, so without it the route has to
    // go south through Switzerland, Austria and Czechia.
    expect(shortestPath('FRA', 'POL', without(['DEU']))).toEqual([
      'FRA',
      'CHE',
      'AUT',
      'CZE',
      'POL',
    ])
  })
})

describe('without', () => {
  it('is every country but the ones named', () => {
    const rest = without(['FRA'])
    expect(rest.has('FRA')).toBe(false)
    expect(rest.size).toBe(CODES.length - 1)
  })

  it('is the whole graph when nothing is excluded', () => {
    expect(without([]).size).toBe(CODES.length)
  })

  it('ignores a country that was never there', () => {
    expect(without(['XXX']).size).toBe(CODES.length)
  })
})

describe('cost', () => {
  it('charges the same for every land border', () => {
    // The knob Phase 4 turns. While it is flat, the search is a breadth-first
    // search wearing a heavier coat, which is exactly what the tests above pin.
    for (const code of CODES) {
      for (const neighbour of neighbours(code)) expect(cost(code, neighbour)).toBe(1)
    }
  })
})

describe('the graph itself', () => {
  it('knows a country it has and refuses one it does not', () => {
    expect(exists('FRA')).toBe(true)
    expect(exists('XXX')).toBe(false)
    expect(() => country('XXX')).toThrow(/unknown country/)
  })

  it('joins everything the crossings reach, and nothing they do not', () => {
    expect(connectable('FRA', 'CHN')).toBe(true)
    expect(connectable('FRA', 'BRA')).toBe(true)
    expect(connectable('FRA', 'FJI')).toBe(false)
    // Whether a route exists and whether the components agree must never differ.
    for (const to of CODES) {
      expect(distance('FRA', to) !== null, `FRA -> ${to}`).toBe(connectable('FRA', to))
    }
  })

  it('keeps land borders and sea crossings apart, and both symmetric', () => {
    for (const code of CODES) {
      for (const other of GRAPH[code].sea) {
        expect(GRAPH[other].sea, `${code} <-> ${other}`).toContain(code)
        expect(isSea(code, other)).toBe(true)
        expect(GRAPH[code].borders, `${code} - ${other}`).not.toContain(other)
      }
    }
  })
})

describe('beyond', () => {
  it('is everything on the far side of a crossing', () => {
    // Iceland hangs off Denmark alone, so cutting that link strands it.
    expect([...beyond('DNK', 'ISL')]).toEqual(['ISL'])
  })

  it('leaves the near side out, because every crossing is a bridge', () => {
    for (const code of CODES) {
      for (const other of GRAPH[code].sea) {
        expect(beyond(code, other).has(code), `${code}-${other}`).toBe(false)
      }
    }
  })

  it('splits the world in two and loses nobody', () => {
    // The forest property as arithmetic: the two sides of any crossing account
    // for the whole playable world exactly once.
    const playable = CODES.filter((code) => GRAPH[code].component === GRAPH.FRA.component)
    for (const code of CODES) {
      for (const other of GRAPH[code].sea) {
        const far = beyond(code, other)
        const near = beyond(other, code)
        expect(far.size + near.size, `${code}-${other}`).toBe(playable.length)
        expect(
          [...far].some((c) => near.has(c)),
          `${code}-${other}`,
        ).toBe(false)
      }
    }
  })

  it('puts the Americas on the far side of the Bering Strait', () => {
    const far = beyond('RUS', 'USA')
    expect(far.has('BRA')).toBe(true)
    expect(far.has('CUB')).toBe(true)
    expect(far.has('CHN')).toBe(false)
  })
})

describe('costsFrom', () => {
  it('gives the same answer as asking one destination at a time', () => {
    for (const from of SOURCES) {
      const costs = costsFrom(from)
      for (const to of CODES) {
        expect(costs.get(to) ?? null, `${from} -> ${to}`).toBe(distance(from, to))
      }
    }
  })

  it('leaves out what it cannot reach', () => {
    const costs = costsFrom('FRA')
    for (const stranded of ['FJI', 'NZL', 'SLB', 'VUT']) {
      expect(costs.has(stranded), stranded).toBe(false)
    }
  })

  it('honours a subset the same way the single search does', () => {
    const costs = costsFrom('FRA', without(['DEU']))
    expect(costs.get('POL')).toBe(distance('FRA', 'POL', without(['DEU'])))
    expect(costs.has('DEU')).toBe(false)
  })

  it('costs nothing to be where you already are', () => {
    expect(costsFrom('FRA').get('FRA')).toBe(0)
  })
})

/**
 * A rough region with something to say: the countries a Türkiye -> Poland route
 * would ordinarily walk through, so going round is a decision rather than the
 * only option. Fixed rather than generated, so a failure names a real route.
 */
const ROUGH = new Set(['BGR', 'ROU', 'SRB', 'HUN', 'GRC'])

describe('cost in the rough', () => {
  it('charges the premium on arriving, whichever way you came', () => {
    // Rough is a property of the country, not of the way in — which is the
    // whole difference between it and a sea crossing.
    expect(cost('ROU', 'BGR', ROUGH)).toBe(1 + (ROUGH_COST - 1))
    expect(cost('GRC', 'BGR', ROUGH)).toBe(1 + (ROUGH_COST - 1))
    expect(cost('BGR', 'TUR', ROUGH)).toBe(1)
  })

  it('stacks with a crossing rather than replacing it', () => {
    expect(cost('KOR', 'JPN', new Set(['JPN']))).toBe(SEA_COST + (ROUGH_COST - 1))
  })

  it('leaves an open board costing exactly what it did', () => {
    for (const from of SOURCES) {
      for (const to of neighbours(from)) {
        expect(cost(from, to, new Set()), `${from} -> ${to}`).toBe(cost(from, to))
      }
    }
  })
})

describe('search over rough ground', () => {
  it('agrees with the slow relaxation once the premium is in play', () => {
    for (const from of SOURCES) {
      const reference = referenceCosts(from, ROUGH)
      for (const to of CODES) {
        expect(distance(from, to, undefined, ROUGH), `${from} -> ${to}`).toBe(
          reference.get(to) ?? null,
        )
      }
    }
  })

  it('never makes a route cheaper, and sometimes makes one dearer', () => {
    let dearer = 0
    for (const from of SOURCES) {
      const open = costsFrom(from)
      const over = costsFrom(from, undefined, ROUGH)
      for (const to of CODES) {
        const before = open.get(to)
        const after = over.get(to)
        if (before === undefined) {
          expect(after, `${from} -> ${to}`).toBeUndefined()
          continue
        }
        expect(after, `${from} -> ${to}`).toBeGreaterThanOrEqual(before)
        if (after! > before) dearer++
      }
    }
    expect(dearer).toBeGreaterThan(0)
  })

  it('cannot strand anywhere, because a premium is not a wall', () => {
    // The reason `isWon` is deliberately never given a rough set: rough is
    // finite, so it can change what a route costs but never whether one exists.
    for (const from of SOURCES) {
      expect([...costsFrom(from, undefined, ROUGH).keys()].sort(), from).toEqual(
        [...costsFrom(from).keys()].sort(),
      )
    }
  })

  it('costs the same measured from either end, while no endpoint is rough', () => {
    // Load-bearing, and not merely tidy. Rough is charged on arrival, so cost
    // is symmetric only when neither end carries a premium — and `pickPuzzle`
    // runs half the pool's pairs backwards on a coin, so an asymmetry here
    // would give one pool entry two different `best` values depending on the
    // flip. This is the reason `newGame` refuses a rough endpoint.
    const clean = SOURCES.filter((code) => !ROUGH.has(code))
    const costs = new Map(clean.map((code) => [code, costsFrom(code, undefined, ROUGH)]))
    for (const from of clean) {
      for (const to of clean) {
        expect(costs.get(from)!.get(to), `${from} <-> ${to}`).toBe(costs.get(to)!.get(from))
      }
    }
  })

  it('is asymmetric the moment an end is rough, which is what we are guarding', () => {
    const asymmetric = CODES.filter(
      (to) => distance('BGR', to, undefined, ROUGH) !== distance(to, 'BGR', undefined, ROUGH),
    )
    expect(asymmetric.length).toBeGreaterThan(0)
  })
})

/**
 * The cheapest route from `from` to `to` running through `via`, by exhaustive
 * enumeration of every simple path.
 *
 * Brute force, and independent of `searchVia` in every part that could be
 * wrong: no flow, no potentials, no residual — just every route there is, kept
 * if it contains the waypoint. Only tractable inside a small `within` set, which
 * is the same trick `describe('searching a subset')` above already uses.
 */
function referenceVia(
  from: string,
  to: string,
  via: string,
  within: ReadonlySet<string>,
  rough?: ReadonlySet<string>,
): number | null {
  let cheapest: number | null = null
  const walk = (at: string, seen: Set<string>, spent: number) => {
    if (cheapest !== null && spent >= cheapest) return
    if (at === to) {
      if (seen.has(via)) cheapest = spent
      return
    }
    for (const link of [...links(at)].sort()) {
      if (!within.has(link) || seen.has(link)) continue
      seen.add(link)
      walk(link, seen, spent + cost(at, link, rough))
      seen.delete(link)
    }
  }
  walk(from, new Set([from]), 0)
  return cheapest
}

describe('searchVia', () => {
  /**
   * A dozen countries carved out of the real map, small enough that every simple
   * path through them can be enumerated and varied enough to hold real choices —
   * Germany and Austria give more than one way across, and Italy reaches Slovenia
   * both round the Alps and through them.
   */
  const EUROPE = new Set([
    'AUT',
    'BEL',
    'CHE',
    'CZE',
    'DEU',
    'ESP',
    'FRA',
    'HUN',
    'ITA',
    'NLD',
    'POL',
    'SVK',
    'SVN',
  ])

  const TRIPLES: [string, string, string][] = [
    ['ESP', 'POL', 'ITA'],
    ['ESP', 'POL', 'CHE'],
    ['ESP', 'HUN', 'DEU'],
    ['FRA', 'SVK', 'AUT'],
    ['NLD', 'SVN', 'CHE'],
    ['BEL', 'HUN', 'CZE'],
    ['ITA', 'POL', 'AUT'],
    ['ESP', 'SVK', 'NLD'],
  ]

  it('agrees with every simple route, enumerated', () => {
    for (const [from, to, via] of TRIPLES) {
      expect(costVia(from, to, via, EUROPE), `${from}/${via}/${to}`).toBe(
        referenceVia(from, to, via, EUROPE),
      )
    }
  })

  it('agrees over rough ground too', () => {
    for (const [from, to, via] of TRIPLES) {
      if (ROUGH.has(from) || ROUGH.has(to) || ROUGH.has(via)) continue
      expect(costVia(from, to, via, EUROPE, ROUGH), `${from}/${via}/${to}`).toBe(
        referenceVia(from, to, via, EUROPE, ROUGH),
      )
    }
  })

  /**
   * The inversion this mechanic turns on, and the reverse of what the tree it
   * replaced satisfied. Two shortest legs is a *lower* bound now: the cheapest
   * way in can block the cheapest way out, and then the route costs more.
   */
  it('never costs less than the two shortest legs', () => {
    for (const from of SOURCES) {
      for (const via of CODES) {
        if (via === from) continue
        for (const to of ['POL', 'THA', 'ZAF']) {
          if (to === from || to === via) continue
          const found = costVia(from, to, via)
          if (found === null) continue
          const bound = distance(from, via)! + distance(via, to)!
          expect(found, `${from}/${via}/${to}`).toBeGreaterThanOrEqual(bound)
        }
      }
    }
  })

  it('sometimes costs strictly more, which is the whole reason it is exact', () => {
    const strict = CODES.filter((via) => {
      if (via === 'FRA' || via === 'CHN') return false
      const found = costVia('FRA', 'CHN', via)
      return found !== null && found > distance('FRA', via)! + distance(via, 'CHN')!
    })
    expect(strict.length).toBeGreaterThan(0)
  })

  it('refuses a country with only one way in and out', () => {
    // Nineteen countries hold a single link, so the way in is also the only way
    // out and no route can pass through. This is the dogleg's third rule, and it
    // is not a separate test in the code — it is this function returning null.
    for (const dead of ['PRT', 'ISL', 'LSO', 'CAN', 'JPN']) {
      expect(costVia('FRA', 'TUR', dead), dead).toBeNull()
      expect(links(dead).length, dead).toBe(1)
    }
  })

  it('returns a real route: simple, joined up, and through all three', () => {
    for (const from of SOURCES) {
      for (const to of ['POL', 'THA', 'ZAF', 'BRA']) {
        for (const via of ['DEU', 'IRN', 'KEN']) {
          const found = searchVia(from, to, via)
          if (!found) continue
          const { cost: spent, path } = found
          expect(new Set(path).size, path.join('/')).toBe(path.length)
          expect(path[0]).toBe(from)
          expect(path.at(-1)).toBe(to)
          expect(path).toContain(via)
          let walked = 0
          for (let step = 1; step < path.length; step++) {
            expect(links(path[step - 1]), path.join('/')).toContain(path[step])
            walked += cost(path[step - 1], path[step])
          }
          expect(walked, path.join('/')).toBe(spent)
        }
      }
    }
  })

  it('reads the same both ways round, while no end is rough', () => {
    for (const via of CODES) {
      if (via === 'FRA' || via === 'CHN') continue
      expect(costVia('FRA', 'CHN', via), via).toBe(costVia('CHN', 'FRA', via))
    }
  })

  it('honours a closure the way every other search does', () => {
    // France -> Poland by way of Switzerland is France, Switzerland, Germany,
    // Poland. Shut Germany and the way out of Switzerland has to go round.
    const shut = without(['DEU'])
    expect(costVia('FRA', 'POL', 'CHE')).toBe(3)
    expect(costVia('FRA', 'POL', 'CHE', shut)).toBe(4)
    // And a waypoint that is itself shut is nowhere at all.
    expect(costVia('FRA', 'POL', 'DEU', shut)).toBeNull()
  })

  it('gives up when a terminal is on another landmass', () => {
    expect(costVia('FRA', 'FJI', 'DEU')).toBeNull()
    expect(costVia('FRA', 'POL', 'FJI')).toBeNull()
  })

  it('refuses a waypoint that is one of the ends', () => {
    expect(costVia('FRA', 'POL', 'FRA')).toBeNull()
    expect(costVia('FRA', 'POL', 'POL')).toBeNull()
  })

  /**
   * Pinned, like `describe('a stable route')` above and for the same reason:
   * `detours` and the share card read this route, so a tie-break that shifts is
   * a decision rather than an accident.
   */
  it('draws the same route it drew before', () => {
    expect(routeVia('ESP', 'SWE', 'ROU')).toEqual([
      'ESP',
      'FRA',
      'ITA',
      'SVN',
      'HUN',
      'ROU',
      'UKR',
      'RUS',
      'NOR',
      'SWE',
    ])
  })
})
