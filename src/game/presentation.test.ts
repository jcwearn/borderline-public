import { describe, expect, it } from 'vitest'
import { CODES, GRAPH, isSea, shortestPath } from './graph'
import { EMPTY_DRAFT, type Draft } from './freeplay'
import {
  crossingMatters,
  destination,
  draftRoleResolver,
  origin,
  railView,
  roleOf,
  visibleLabels,
  waypointLabel,
} from './presentation'
import {
  attemptReveal,
  isLegal,
  isNamed,
  newGame,
  place,
  validNextMoves,
  type GameState,
  type Puzzle,
} from './rules'

const NGA_KOR: Puzzle = { id: 1, date: '2026-08-09', start: 'NGA', end: 'KOR', best: 9, par: 11 }

function play(codes: string[]): GameState {
  return codes.reduce((state, code) => place(state, code).state, newGame(NGA_KOR))
}

describe('visibleLabels', () => {
  it('names only the two endpoints at the start of a round', () => {
    expect(
      visibleLabels(newGame(NGA_KOR))
        .map((l) => l.code)
        .sort(),
    ).toEqual(['KOR', 'NGA'])
  })

  it('never names anything the player has not earned', () => {
    // The single rule this module exists to protect. Checked against every
    // country in the graph, at three points in a round.
    const states = [newGame(NGA_KOR), play(['NER']), play(['NER', 'TCD', 'DZA'])]
    for (const state of states) {
      const shown = new Set(visibleLabels(state).map((l) => l.code))
      const earned = new Set([
        state.puzzle.start,
        state.puzzle.end,
        ...state.placed,
        ...state.revealed,
      ])
      for (const code of CODES) {
        expect(shown.has(code), `${code} should${earned.has(code) ? '' : ' not'} be named`).toBe(
          earned.has(code),
        )
      }
    }
  })

  it('names a country once it is placed', () => {
    expect(visibleLabels(play(['NER'])).map((l) => l.code)).toContain('NER')
  })

  it('names a country whose name was bought but which never got played', () => {
    const state = attemptReveal(newGame(NGA_KOR), 'FRA').state
    const label = visibleLabels(state).find((l) => l.code === 'FRA')
    expect(label).toBeDefined()
    expect(label!.role).toBe('known')
  })

  it('lights a legal move up without ever naming it', () => {
    // The whole point: you can see where you may go, not what it is called.
    const state = newGame(NGA_KOR)
    expect(roleOf(state, 'NER')).toBe('available')
    expect(visibleLabels(state).map((l) => l.code)).not.toContain('NER')
  })

  it('carries the coordinates and name straight from the graph', () => {
    const label = visibleLabels(newGame(NGA_KOR)).find((l) => l.code === 'NGA')!
    expect(label.name).toBe(GRAPH.NGA.name)
    expect([label.lat, label.lng]).toEqual(GRAPH.NGA.latlng)
  })

  it('grows by exactly one per placement', () => {
    expect(visibleLabels(newGame(NGA_KOR))).toHaveLength(2)
    expect(visibleLabels(play(['NER']))).toHaveLength(3)
    expect(visibleLabels(play(['NER', 'TCD']))).toHaveLength(4)
  })

  it('gains nothing from a miss, which teaches the player no name', () => {
    const missed = place(newGame(NGA_KOR), 'FRA').state
    expect(visibleLabels(missed)).toHaveLength(2)
  })
})

describe('exploring once the round is over', () => {
  const midRound = play(['NER'])
  const finished: GameState = { ...midRound, status: 'won' }
  const explored = new Set(['FRA'])

  it('ignores names asked for while the round is still being played', () => {
    // The gate lives here rather than in the caller, so a renderer that passes
    // the set unconditionally cannot leak a name the player has not earned.
    expect(visibleLabels(midRound, false, explored).map((l) => l.code)).not.toContain('FRA')
    expect(roleOf(midRound, 'FRA', false, explored)).toBe('unknown')
  })

  it('names a country the player pointed at after winning', () => {
    const label = visibleLabels(finished, false, explored).find((l) => l.code === 'FRA')
    expect(label).toBeDefined()
    expect(label!.name).toBe(GRAPH.FRA.name)
  })

  it('draws it as a known name, the same as one that was bought', () => {
    expect(roleOf(finished, 'FRA', false, explored)).toBe('known')
  })

  it('leaves the placed countries and endpoints as they were', () => {
    expect(roleOf(finished, 'NER', false, explored)).toBe('placed')
    expect(roleOf(finished, 'NGA', false, explored)).toBe('start')
    expect(roleOf(finished, 'KOR', false, explored)).toBe('end')
  })

  it('names nothing extra when the player has explored nothing', () => {
    expect(
      visibleLabels(finished)
        .map((l) => l.code)
        .sort(),
    ).toEqual(['KOR', 'NER', 'NGA'])
  })
})

describe('swapping direction', () => {
  it('swaps which endpoint reads as the origin', () => {
    const state = newGame(NGA_KOR)
    expect(origin(state, false)).toBe('NGA')
    expect(destination(state, false)).toBe('KOR')
    expect(origin(state, true)).toBe('KOR')
    expect(destination(state, true)).toBe('NGA')
  })

  it('swaps the two endpoint colours so the globe matches the header', () => {
    const state = newGame(NGA_KOR)
    expect(roleOf(state, 'NGA', true)).toBe('end')
    expect(roleOf(state, 'KOR', true)).toBe('start')
  })

  it("leaves every other country's role alone", () => {
    const state = play(['NER'])
    for (const code of CODES) {
      if (code === 'NGA' || code === 'KOR') continue
      expect(roleOf(state, code, true), code).toBe(roleOf(state, code, false))
    }
  })

  it('names exactly the same countries either way round', () => {
    const state = play(['NER', 'TCD'])
    const upright = visibleLabels(state, false)
      .map((l) => l.code)
      .sort()
    const swapped = visibleLabels(state, true)
      .map((l) => l.code)
      .sort()
    expect(swapped).toEqual(upright)
  })

  it('never turns a hidden country into a named one', () => {
    // The flip is presentation, so it must not be a way to learn anything.
    const state = play(['NER'])
    const named = new Set(visibleLabels(state, true).map((l) => l.code))
    for (const code of CODES) {
      expect(named.has(code), code).toBe(isNamed(state, code))
    }
  })

  it('does not touch the puzzle itself, which is what scoring reads', () => {
    const state = play(['NER'])
    origin(state, true)
    expect(state.puzzle.start).toBe('NGA')
    expect(state.puzzle.end).toBe('KOR')
  })
})

describe('roleOf', () => {
  it('marks terrain with no country behind it as inert', () => {
    expect(roleOf(newGame(NGA_KOR), null)).toBe('inert')
    expect(roleOf(newGame(NGA_KOR), 'ZZZ')).toBe('inert')
  })

  it('distinguishes the two endpoints', () => {
    expect(roleOf(newGame(NGA_KOR), 'NGA')).toBe('start')
    expect(roleOf(newGame(NGA_KOR), 'KOR')).toBe('end')
  })

  it('lights up the legal moves and nothing else', () => {
    const state = newGame(NGA_KOR)
    expect(roleOf(state, 'NER')).toBe('available') // borders Nigeria
    expect(roleOf(state, 'PRK')).toBe('available') // borders South Korea
    expect(roleOf(state, 'FRA')).toBe('unknown')
  })

  it('lights up a border that is invisible on a globe', () => {
    // Ceuta and Melilla make Spain a land neighbour of Morocco. Unlit, that is
    // a trick played on the player; lit, it is the game teaching the map.
    const state = play(['NER', 'DZA', 'MAR'])
    expect(roleOf(state, 'ESP')).toBe('available')
  })

  it('agrees with the rules about what is legal, for every country', () => {
    const state = play(['NER', 'DZA'])
    for (const code of CODES) {
      expect(roleOf(state, code) === 'available', code).toBe(isLegal(state, code))
    }
  })

  describe('a day with a border closed', () => {
    const SHUT: Puzzle = { ...NGA_KOR, best: 10, par: 12, closed: ['DZA'] }
    const shut = (codes: string[]) =>
      codes.reduce((state, code) => place(state, code).state, newGame(SHUT))

    it('draws a shut country as a hazard', () => {
      expect(roleOf(newGame(SHUT), 'DZA')).toBe('closed')
    })

    it('never lights a shut country as a legal move', () => {
      // Niger borders Algeria, so with Algeria open this is exactly the state
      // that would light it. The role has to outrank `available` or the whole
      // mechanic silently does not exist.
      const state = shut(['NER'])
      expect(validNextMoves(state)).not.toContain('DZA')
      expect(roleOf(state, 'DZA')).toBe('closed')
    })

    it('still agrees with the rules about what is legal, for every country', () => {
      const state = shut(['NER'])
      for (const code of CODES) {
        expect(roleOf(state, code) === 'available', code).toBe(isLegal(state, code))
      }
    })

    it('draws it without a name, exactly as a ruled-off region is drawn', () => {
      // A lone closure used to be labelled from the opening move, on the
      // reasoning that a grey shape you cannot identify is a trap. It is a
      // country's name for nothing, on a board where a name is the currency, so
      // one shut country and four now read the same: shapes, no words.
      const labels = visibleLabels(newGame(SHUT))
      expect(labels.some((label) => label.code === 'DZA')).toBe(false)
      expect(labels.map((label) => label.code).sort()).toEqual(['KOR', 'NGA'])
    })
  })

  describe('a day with a place ruled off', () => {
    /** Four countries, which is past the point of naming them one by one. */
    const BOUNDS = ['MAR', 'DZA', 'TUN', 'LBY']
    const OUT: Puzzle = { ...NGA_KOR, start: 'FRA', end: 'EGY', best: 8, par: 10, closed: BOUNDS }

    it('still draws every one of them as a hazard', () => {
      const state = newGame(OUT)
      for (const code of BOUNDS) expect(roleOf(state, code), code).toBe('closed')
    })

    it('leaks no name for any of them', () => {
      // The whole reason the naming rule has a limit. A greyed region reads as
      // one place without labels, and labelling it would hand back a reveal for
      // every country in it — which is what the game is priced around.
      const labels = visibleLabels(newGame(OUT))
      const named = new Set(labels.map((label) => label.code))
      for (const code of BOUNDS) expect(named.has(code), code).toBe(false)
    })

    it('names only the two endpoints, exactly as an open board would', () => {
      const labels = visibleLabels(newGame(OUT))
      expect(labels.map((label) => label.code).sort()).toEqual(['EGY', 'FRA'])
    })

    it('agrees with the rules about every country on the globe', () => {
      const state = newGame(OUT)
      for (const code of CODES) {
        expect(roleOf(state, code) === 'available', code).toBe(isLegal(state, code))
        expect(
          visibleLabels(state).some((label) => label.code === code),
          code,
        ).toBe(isNamed(state, code))
      }
    })
  })

  it('prefers what the player earned over merely being legal', () => {
    const state = play(['NER'])
    expect(roleOf(state, 'NER')).toBe('placed')
  })

  it('gives every country in the graph a role', () => {
    const state = play(['NER'])
    for (const code of CODES) {
      expect(roleOf(state, code), code).toBeTruthy()
    }
  })
})

describe('draftRoleResolver', () => {
  const role = (draft: Draft) => draftRoleResolver(draft)

  it('leaves a country nobody has picked anonymous', () => {
    expect(role({ ...EMPTY_DRAFT, start: null, end: null, closed: [] })('FRA')).toBe('unknown')
  })

  it('marks terrain with no country behind it as inert', () => {
    const of = role({ ...EMPTY_DRAFT, start: 'NGA', end: 'KOR', closed: [] })
    expect(of(null)).toBe('inert')
    expect(of('ZZZ')).toBe('inert')
  })

  it('draws the ends and the closures the way the round will', () => {
    const of = role({ ...EMPTY_DRAFT, start: 'NGA', end: 'KOR', closed: ['DZA'] })
    expect(of('NGA')).toBe('start')
    expect(of('KOR')).toBe('end')
    expect(of('DZA')).toBe('closed')
  })

  it('colours one end before the other is chosen', () => {
    // The state `newGame` cannot represent, and the reason this exists at all.
    expect(role({ ...EMPTY_DRAFT, start: 'NGA', end: null, closed: [] })('NGA')).toBe('start')
  })

  it('never claims a country is placed, known or available', () => {
    // Nothing has been played, so the roles a round earns cannot arise — and a
    // shape lit blue would say a move was legal in a builder that has no moves.
    const of = role({ ...EMPTY_DRAFT, start: 'NGA', end: 'KOR', closed: ['DZA'] })
    for (const code of CODES) {
      expect(['inert', 'start', 'end', 'closed', 'unknown'], code).toContain(of(code))
    }
  })
})

describe('which crossings are worth drawing', () => {
  // Serbia to Lithuania: entirely inland Europe, so no crossing anywhere can
  // bear on it.
  const INLAND: Puzzle = { id: 7, date: '2026-01-07', start: 'SRB', end: 'LTU', best: 4, par: 5 }

  it('hides a crossing to a dead end the round never visits', () => {
    // Iceland hangs off Denmark by one link, so unless the round starts or ends
    // there, no route can use it.
    expect(crossingMatters(newGame(INLAND), 'DNK', 'ISL')).toBe(false)
  })

  it('draws that same crossing when the round ends there', () => {
    const toIceland: Puzzle = { ...INLAND, start: 'SRB', end: 'ISL', best: 5, par: 6 }
    expect(crossingMatters(newGame(toIceland), 'DNK', 'ISL')).toBe(true)
  })

  it('hides the Bering Strait unless the round actually changes hemisphere', () => {
    expect(crossingMatters(newGame(INLAND), 'RUS', 'USA')).toBe(false)
    const crossWorld: Puzzle = { ...INLAND, start: 'SRB', end: 'BRA', best: 9, par: 11 }
    expect(crossingMatters(newGame(crossWorld), 'RUS', 'USA')).toBe(true)
  })

  it('hides a crossing when both ends of the round are past it', () => {
    // Both endpoints sit on the far side of Bering, so a route between them
    // never crosses back. This is the case a naive "is either endpoint an
    // island" check would get wrong.
    const americas: Puzzle = { ...INLAND, start: 'BRA', end: 'CUB', best: 6, par: 7 }
    expect(crossingMatters(newGame(americas), 'RUS', 'USA')).toBe(false)
    expect(crossingMatters(newGame(americas), 'CUB', 'MEX')).toBe(true)
  })

  it('draws a crossing the player has already reached', () => {
    // Wandering onto an island is a detour, but the crossing explains the
    // stroke it cost, so it stops being hidden once it is on the board.
    const puzzle: Puzzle = { id: 8, date: '2026-01-08', start: 'MEX', end: 'GTM', best: 3, par: 4 }
    expect(crossingMatters(newGame(puzzle), 'CUB', 'MEX')).toBe(true)
    expect(crossingMatters(newGame(puzzle), 'CUB', 'JAM')).toBe(false)
    const wandered = place(place(newGame(puzzle), 'CUB').state, 'JAM').state
    expect(crossingMatters(wandered, 'CUB', 'JAM')).toBe(true)
  })

  it('agrees with whether the shortest route actually uses the crossing', () => {
    // The claim underneath the rule, checked rather than asserted: for a spread
    // of puzzles, every crossing on the cheapest route is one we draw.
    const rounds: Array<[string, string]> = [
      ['SRB', 'LTU'],
      ['SRB', 'ISL'],
      ['SRB', 'BRA'],
      ['BRA', 'CUB'],
      ['CHN', 'JPN'],
      ['MEX', 'JAM'],
    ]
    for (const [start, end] of rounds) {
      const state = newGame({ id: 9, date: '2026-01-09', start, end, best: 3, par: 4 })
      const route = shortestPath(start, end)!
      for (let step = 1; step < route.length; step++) {
        if (!isSea(route[step - 1], route[step])) continue
        expect(
          crossingMatters(state, route[step - 1], route[step]),
          `${start}->${end} uses ${route[step - 1]}-${route[step]}`,
        ).toBe(true)
      }
    }
  })
})

describe('railView', () => {
  /** Hungary touches neither end, so it is reached rather than given. */
  const VIA_HUNGARY: Puzzle = {
    id: 20,
    date: '2026-01-20',
    start: 'FRA',
    end: 'POL',
    best: 4,
    par: 5,
    required: ['HUN'],
  }
  const build = (codes: string[]) =>
    codes.reduce((state, code) => place(state, code).state, newGame(VIA_HUNGARY))

  it('states the hole as the places it has to run through', () => {
    // France — ? — ⚑ — ? — Poland. The waypoint is a station on the chain
    // rather than a note under it, and it is now literally what `best`
    // measures: the cheapest route in one border of it and out another.
    const view = railView(build([]))
    expect(view.anchors).toEqual([
      { code: 'FRA', hidden: false },
      { code: 'HUN', hidden: true },
      { code: 'POL', hidden: false },
    ])
    expect(view.links).toEqual([
      { gap: { fromLeft: [], fromRight: [] } },
      { gap: { fromLeft: [], fromRight: [] } },
    ])
  })

  it('keeps a stretch open while the ends are already joined', () => {
    // The bug this exists to stop. Germany joins France to Poland in one move,
    // so the rail used to draw a finished round — and then the game refused to
    // agree, with nothing on screen saying why.
    const view = railView(build(['DEU']))
    expect(view.anchors.map((one) => one.code)).toEqual(['FRA', 'HUN', 'POL'])
    for (const link of view.links) expect(link).toHaveProperty('gap')
  })

  it('fills a stretch in as the countries arrive', () => {
    const view = railView(build(['DEU', 'AUT']))
    // Austria draws level with Hungary but has not been played into it yet, so
    // the near stretch shows the run and the gap still to close.
    expect(view.links[0]).toEqual({ gap: { fromLeft: ['DEU', 'AUT'], fromRight: [] } })
    expect(view.links[1]).toEqual({ gap: { fromLeft: [], fromRight: [] } })
  })

  it('calls nothing spare until the round is actually over', () => {
    // A country off the route may yet be the way to the waypoint, so "didn't
    // need" is a claim the rail is not entitled to make yet.
    expect(railView(build(['DEU', 'CHE'])).spareLabel).toBe('aside')
  })

  it('draws every placed country exactly once', () => {
    // Germany borders both France and Poland, so it is reachable from either
    // side of the same gap and was drawn twice before the stretches started
    // claiming what they had already taken.
    const view = railView(build(['DEU', 'CHE', 'AUT']))
    const drawn = view.links.flatMap((link) =>
      'joined' in link ? link.joined : [...link.gap.fromLeft, ...link.gap.fromRight],
    )
    expect(new Set([...drawn, ...view.spare]).size).toBe(drawn.length + view.spare.length)
    expect([...drawn, ...view.spare].sort()).toEqual(['AUT', 'CHE', 'DEU'])
  })

  it('keeps the chain open on a board that only reaches the waypoint', () => {
    // Germany joins the ends and Hungary is on the board, which used to be a
    // finished round. It is a dead-end arm now, and the rail has to go on
    // saying so rather than drawing two stretches both closed.
    const view = railView(build(['DEU', 'AUT', 'HUN']))
    expect(view.anchors.map((one) => one.code)).toEqual(['FRA', 'HUN', 'POL'])
    for (const link of view.links) expect(link).toHaveProperty('gap')
    expect(view.spareLabel).toBe('aside')
  })

  it('becomes the route once the round is over, waypoint inline and named', () => {
    const won = railView(build(['DEU', 'AUT', 'HUN', 'SVK']))
    expect(won.anchors).toEqual([
      { code: 'FRA', hidden: false },
      { code: 'POL', hidden: false },
    ])
    expect(won.spareLabel).toBe('wasted')
    // The waypoint is on the route now, so there is no arm to excuse and
    // nothing is spare.
    expect(won.links).toEqual([{ joined: ['DEU', 'AUT', 'HUN', 'SVK'] }])
    expect(won.spare).toEqual([])
  })

  it('leaves an ordinary hole with the two ends it always had', () => {
    const view = railView(play(['NER']))
    expect(view.anchors.map((one) => one.code)).toEqual(['NGA', 'KOR'])
    expect(view.links).toHaveLength(1)
  })

  it('reads the other way round when the ends are swapped', () => {
    const view = railView(build([]), true)
    expect(view.anchors[0].code).toBe('POL')
    expect(view.anchors.at(-1)!.code).toBe('FRA')
  })
})

describe('waypointLabel', () => {
  /** Hungary touches neither end, so it is reached rather than given. */
  const VIA_HUNGARY: Puzzle = {
    id: 21,
    date: '2026-01-21',
    start: 'FRA',
    end: 'POL',
    best: 4,
    par: 5,
    required: ['HUN'],
  }
  const fresh = newGame(VIA_HUNGARY)

  it('marks the waypoint without naming it', () => {
    const mark = waypointLabel(fresh)
    expect(mark).not.toBeNull()
    expect(mark!.code).toBe('HUN')
    // Empty rather than a `?`. The stake is the whole of what is drawn, and a
    // name here is the one thing that would give the round away.
    expect(mark!.name).toBe('')
    expect(mark!.role).toBe('required')
  })

  /**
   * The reason this is a second function rather than a few lines inside
   * `visibleLabels`. That one means "names the player has earned" and is held
   * to exactly `isNamed` over the whole graph; a waypoint entry appended there
   * would make the identity false, and — the part that matters — no existing
   * test would have gone red to say so.
   */
  it('leaves visibleLabels holding only the names that were earned', () => {
    expect(
      visibleLabels(fresh)
        .map((l) => l.code)
        .sort(),
    ).toEqual(['FRA', 'POL'])
  })

  it('never spells the waypoint out before it is bought', () => {
    const states = [fresh, place(fresh, 'DEU').state, place(place(fresh, 'DEU').state, 'AUT').state]
    for (const state of states) {
      const drawn = [...visibleLabels(state), waypointLabel(state)].filter(Boolean)
      for (const label of drawn) expect(label!.name).not.toBe(GRAPH.HUN.name)
    }
  })

  /**
   * Bought but not yet reached. `visibleLabels` takes the country over, and the
   * role has to still be `required` — that is what keeps the marker on the
   * shape, and it is the whole reason one element covers all three states.
   */
  it('hands the country over once its name is bought, marker and all', () => {
    const bought = attemptReveal(fresh, 'HUN').state
    expect(waypointLabel(bought)).toBeNull()

    const label = visibleLabels(bought).find((l) => l.code === 'HUN')
    expect(label).toBeDefined()
    expect(label!.name).toBe(GRAPH.HUN.name)
    expect(label!.role).toBe('required')
  })

  it('drops the marker once the dogleg is turned', () => {
    const state = ['DEU', 'AUT', 'HUN'].reduce((at, code) => place(at, code).state, fresh)
    expect(waypointLabel(state)).toBeNull()
    expect(visibleLabels(state).find((l) => l.code === 'HUN')!.role).toBe('placed')
  })

  it('marks nothing on a hole with no bend in it', () => {
    expect(waypointLabel(newGame(NGA_KOR))).toBeNull()
  })
})
