/**
 * The rules of Borderline. Pure functions over an immutable state — no React,
 * no DOM, no storage. Every state transition returns a new state plus an
 * outcome describing what the player should be told.
 */
import {
  type CountryCode,
  borders,
  connectable,
  costVia,
  country,
  distance,
  exists,
  isSea,
  links,
  routeVia,
  searchVia,
  shortestPath,
  without,
} from './graph'

export type Puzzle = {
  /** Sequential day number, used in the share text. */
  id: number
  /**
   * The calendar date this puzzle belongs to, as YYYY-MM-DD — the player's own,
   * so the round turns over at their midnight. UTC where the browser did not
   * say, or said something no one on Earth is on.
   */
  date: string
  start: CountryCode
  end: CountryCode
  /**
   * Intermediate countries a perfect solve needs. The floor, not the target —
   * nobody can finish below it.
   */
  best: number
  /**
   * The number to beat: `best` plus the day's allowance. Unlike `best` this is
   * beatable, which is the whole point of scoring a round rather than tallying
   * mistakes against it.
   */
  par: number
  /**
   * Countries shut for the day. They cannot be played and no route may run
   * through one, so the shortest path stops being the answer and `best` is the
   * shortest route that goes *around* them.
   *
   * Plural although the daily shuts one, so that shutting a second later is a
   * change to the data rather than to the code.
   */
  closed?: CountryCode[]
  /**
   * Ground that costs an extra stroke to set foot in. Playable, unlike a
   * closure, and that is the whole mechanic: the short way through the rough
   * and the long way round it are both open, and only one of them is cheaper.
   *
   * Never an endpoint. `search` charges the premium on arriving, so cost is
   * symmetric only while neither end carries one — and `pickPuzzle` runs half
   * the pool's pairs backwards on a coin, so a rough endpoint would give one
   * pool entry two different `best` values depending on the flip.
   *
   * In practice always a whole region, because one rough country is worth
   * exactly one stroke and can never be worth more: you can always walk through
   * it for +1. Only a region makes going round worth considering. The type
   * stays a plain list so the rules never have to know what a region is.
   */
  rough?: CountryCode[]
  /**
   * The one country the round has to *run through* — the dogleg. In one border
   * and out another; reaching it is not enough.
   *
   * A list, and at most one long. The wire format has always been a list and
   * every link already shared spells it as one, so the type stays; what changed
   * is that routing through several at once is a different and much harder
   * question than routing through one, and no round has ever asked it.
   * `newGame` refuses a second.
   *
   * `best` is therefore the cheapest route *through* it — see `searchVia`. It
   * used to be the cheapest tree joining both ends and the waypoint, which is
   * what let the cheapest board hang the waypoint off the side as a dead end and
   * route past it. That was the dogleg's whole weakness.
   *
   * **Marked but not named.** The globe paints it and raises it, so the player
   * is told where; naming it is the hole. That is the opposite of a closure,
   * which is named precisely because a shut country you cannot see is a trap —
   * here you *can* see it, and there is a name to recall or to buy.
   *
   * Never an endpoint, never shut, and never rough — the last because the route
   * leaves the waypoint rather than arriving at it, so its premium would go
   * uncharged. Never *next to* an endpoint: the hole would open with half its
   * bend already made. And never a country with only one way in and out, which
   * is not a further rule so much as the same one — `searchVia` returns nothing
   * for a country a route cannot pass through.
   */
  required?: CountryCode[]
  /**
   * Built by the player rather than served as the day's puzzle.
   *
   * Read by `saveGame` and `recordWin`, which both refuse it: a free round must
   * not evict the daily's saved game from the one slot there is, and must not
   * touch the record — `recordWin` resets the streak whenever the id is not
   * yesterday's, so a made-up id would quietly end a real streak.
   */
  free?: boolean
}

export type GameState = {
  puzzle: Puzzle
  /** Countries the player has put on the board, in the order they did it. */
  placed: CountryCode[]
  /** Names the player has bought by clicking an unnamed shape. */
  revealed: CountryCode[]
  /** Every illegal placement attempt, including repeats. */
  misses: CountryCode[]
  status: 'playing' | 'won'
}

/**
 * What came of an attempt. `reveal` says whether the player paid to learn the
 * name; `placed` says whether the country actually went on the board.
 */
export type Outcome = {
  state: GameState
  code: CountryCode
  reveal: boolean
  placed: boolean
  miss: boolean
  won: boolean
  /**
   * Why the country did not go on the board. Set on a miss, and also on a
   * refusal — an attempt that cost nothing because the board would not
   * entertain it at all. `miss` is what says whether it was charged for.
   */
  reason?: 'already-in-play' | 'not-adjacent' | 'unreachable' | 'closed'
}

const NONE: ReadonlySet<CountryCode> = new Set()

/** The countries this puzzle has shut for the day. */
export function closedIn(puzzle: Puzzle): ReadonlySet<CountryCode> {
  return puzzle.closed?.length ? new Set(puzzle.closed) : NONE
}

/** Whether this country is shut, and so unplayable however well it fits. */
export function isClosed(state: GameState, code: CountryCode): boolean {
  return closedIn(state.puzzle).has(code)
}

/** The ground this puzzle charges extra to set foot in. */
export function roughIn(puzzle: Puzzle): ReadonlySet<CountryCode> {
  return puzzle.rough?.length ? new Set(puzzle.rough) : NONE
}

/** Whether this country costs an extra stroke to be in. */
export function isRough(state: GameState, code: CountryCode): boolean {
  return roughIn(state.puzzle).has(code)
}

/** The countries this puzzle insists the route runs through. */
export function requiredIn(puzzle: Puzzle): ReadonlySet<CountryCode> {
  return puzzle.required?.length ? new Set(puzzle.required) : NONE
}

/** Whether this country is one the round must run through. */
export function isRequired(state: GameState, code: CountryCode): boolean {
  return requiredIn(state.puzzle).has(code)
}

/**
 * The one country this round has to run through, or `null` where it has none.
 *
 * The single accessor, because everything that measures a route needs the
 * waypoint as a country rather than as a set of them, and `requiredIn` — which
 * the globe and the rail still want as a set — would have every caller reaching
 * into it the same way and getting the cap wrong somewhere.
 */
export function viaOf(puzzle: Puzzle): CountryCode | null {
  return puzzle.required?.length ? puzzle.required[0] : null
}

export function roughPlaced(state: GameState): number {
  const rough = roughIn(state.puzzle)
  return state.placed.filter((code) => rough.has(code)).length
}

export function newGame(puzzle: Puzzle): GameState {
  if (!exists(puzzle.start) || !exists(puzzle.end)) {
    throw new Error(`puzzle references an unknown country: ${puzzle.start} -> ${puzzle.end}`)
  }

  const closed = closedIn(puzzle)
  for (const code of closed) {
    if (!exists(code)) throw new Error(`puzzle closes a country we do not know: ${code}`)
    if (code === puzzle.start || code === puzzle.end) {
      throw new Error(`puzzle closes one of its own endpoints: ${code}`)
    }
  }

  const rough = roughIn(puzzle)
  for (const code of rough) {
    if (!exists(code)) throw new Error(`puzzle roughens a country we do not know: ${code}`)
    // Not taste, and not a copy of the closure rule: the premium is charged on
    // arriving, so a rough endpoint makes the hole cost different amounts
    // measured from either end, and the daily runs half its pairs backwards.
    if (code === puzzle.start || code === puzzle.end) {
      throw new Error(`puzzle roughens one of its own endpoints: ${code}`)
    }
    if (closed.has(code)) {
      throw new Error(`puzzle both shuts and roughens ${code}, which cannot both be true`)
    }
  }

  // Routing through two at once is a different question from routing through
  // one, and a much harder one; no round has ever asked it. Refused here rather
  // than quietly played as the first, because a link that names two waypoints
  // describes a puzzle this build cannot set, and setting a different one is
  // exactly the failure `freeplay-url.ts` refuses an unknown section for.
  const required = requiredIn(puzzle)
  if (required.size > 1) {
    throw new Error(`puzzle requires more than one country to pass through: ${[...required]}`)
  }
  for (const code of required) {
    if (!exists(code)) throw new Error(`puzzle requires a country we do not know: ${code}`)
    if (code === puzzle.start || code === puzzle.end) {
      throw new Error(`puzzle requires one of its own endpoints: ${code}`)
    }
    if (closed.has(code)) throw new Error(`puzzle both shuts and requires ${code}`)
    // The route leaves the waypoint rather than arriving at it — see `searchVia`
    // — so a premium charged on arrival would go uncharged on the one country
    // that never gets arrived at.
    if (rough.has(code)) throw new Error(`puzzle both roughens and requires ${code}`)
    // A waypoint next door to an endpoint is not a dogleg. The bend is already
    // half made before the player has done anything, and the hole opens with a
    // barrier that costs it nothing.
    if (links(code).includes(puzzle.start) || links(code).includes(puzzle.end)) {
      throw new Error(`puzzle requires ${code}, which already touches an endpoint`)
    }
    // The whole of the third rule, and it is the same computation the floor is
    // measured with: a country a route cannot go in one border and out another
    // of is not a waypoint, it is a cul-de-sac. Nineteen countries have a single
    // link and can never be one.
    if (
      searchVia(puzzle.start, puzzle.end, code, closed.size > 0 ? without(closed) : undefined) ===
      null
    ) {
      throw new Error(`puzzle requires ${code}, which no route can pass through`)
    }
  }

  if (!connectable(puzzle.start, puzzle.end)) {
    throw new Error(`puzzle is unsolvable: no route from ${puzzle.start} to ${puzzle.end}`)
  }
  // A closure that severs the only route would leave a board nobody can finish,
  // so it is worth the second search to refuse it here rather than let someone
  // discover it by exhausting the map.
  if (closed.size > 0 && distance(puzzle.start, puzzle.end, without(closed)) === null) {
    throw new Error(
      `puzzle is unsolvable: the closures cut every route from ${puzzle.start} to ${puzzle.end}`,
    )
  }

  return { puzzle, placed: [], revealed: [], misses: [], status: 'playing' }
}

/** The endpoints plus everything the player has placed. */
export function inPlay(state: GameState): Set<CountryCode> {
  return new Set([state.puzzle.start, state.puzzle.end, ...state.placed])
}

/**
 * Whether this country's name is visible: in play, or already paid for.
 *
 * The whole of it, and the list is meant to be read as short. When the board
 * opens, exactly two countries on it have names — the two ends — and every other
 * name is bought or earned. A shut country used to be named here as well, on the
 * reasoning that a shape you cannot play and cannot identify is a trap; it is
 * greyed and sunk, which is enough to route around, and the name it was given
 * away for free was a name the round is in the business of charging for.
 *
 * The other half of that reasoning — that naming a closure spares the player
 * paying twice to discover it was never available — died earlier, in
 * `attemptReveal`: pressing a shut shape is refused outright, sold nothing and
 * charged nothing.
 */
export function isNamed(state: GameState, code: CountryCode): boolean {
  return (
    code === state.puzzle.start ||
    code === state.puzzle.end ||
    state.placed.includes(code) ||
    // A waypoint is deliberately not here, and neither is a closure. Both are
    // marked on the globe, which is where the player is told they exist; what
    // neither gets is the name, because the name is the only thing the game
    // ever asks for.
    state.revealed.includes(code)
  )
}

/**
 * How many countries may be shut before the closure stops being a handful of
 * borders and becomes a place.
 *
 * Nothing to do with naming any more — nothing shut is named at either size.
 * It is which *mechanic* the player is looking at: one or two grey shapes are
 * borders that happen to be closed today, and eight greyed and sunk together
 * read as "the whole of that is out", which is a different thing to be told and
 * gets a different explanation.
 *
 * A threshold rather than a guess at contiguity: the rule has to be one a test
 * can state, and "is this shape part of a mass" is not.
 */
export const LONE_CLOSURE_LIMIT = 2

/** Whether this round's closures are few enough to read as shut borders. */
export function closuresAreFew(puzzle: Puzzle): boolean {
  return (puzzle.closed?.length ?? 0) <= LONE_CLOSURE_LIMIT
}

/**
 * Past this, the closure stops being even a place and becomes the course: the
 * few open countries are the story, and the shut ones are just where the world
 * ends. The same kind of line as `LONE_CLOSURE_LIMIT`, one size up.
 *
 * Forty is nowhere near anything real on either side: the largest curated
 * region shuts five countries, and the smallest fairway closure the pool may
 * file is asserted by the build to sit above this. A round can only wander into
 * the gap by hand, and a hand-built round with sixty closures reads as a course
 * however it was meant.
 */
export const FAIRWAY_LIMIT = 40

/**
 * Whether this round shuts so much of the world that what remains is a course.
 *
 * The band is part of the question and not merely a thing courses happen to
 * have: what the mechanic's one sentence, its modal and the rules card's fourth
 * step all say is that the fairway runs between rough and out of bounds, and
 * on a round with nothing in the rough that is not tonally off but false. Only
 * a hand-built round can be shut that wide with no band — the generator derives
 * one and the build refuses a course without it — and such a round is a very
 * large closure, which `bounds` describes truthfully.
 */
export function fairwayRound(puzzle: Puzzle): boolean {
  return (puzzle.closed?.length ?? 0) > FAIRWAY_LIMIT && (puzzle.rough?.length ?? 0) > 0
}

/**
 * A placement is legal when the country is open, not already on the board, and
 * is joined to something that is — by a land border or by a sea crossing.
 */
export function isLegal(state: GameState, code: CountryCode): boolean {
  if (!exists(code)) return false
  if (isClosed(state, code)) return false
  const board = inPlay(state)
  if (board.has(code)) return false
  return links(code).some((link) => board.has(link))
}

/** Every country that could legally be played next. Drives Casual mode. */
export function validNextMoves(state: GameState): CountryCode[] {
  const board = inPlay(state)
  const closed = closedIn(state.puzzle)
  const moves = new Set<CountryCode>()
  for (const placed of board) {
    for (const link of links(placed)) {
      if (!board.has(link) && !closed.has(link)) moves.add(link)
    }
  }
  return [...moves].sort()
}

/**
 * Whether start and end are joined by countries the player has placed — and, on
 * a dogleg, joined by a route that runs *through* the waypoint.
 *
 * Deliberately never given the rough: a premium is finite, so it can change what
 * a route costs but never whether one exists. Passing it here would be work for
 * an answer that cannot differ.
 *
 * The waypoint is a change to the search rather than a second condition, which
 * is the reverse of how it used to read. "Is it on the board" was the whole
 * question, and it is what let a board win with the waypoint hanging off the
 * side on a dead-end spur while the route went past it. Being on the board is
 * kept only as the cheap way to say no first.
 */
export function isWon(state: GameState): boolean {
  const via = viaOf(state.puzzle)
  const board = inPlay(state)
  if (via === null) return distance(state.puzzle.start, state.puzzle.end, board) !== null
  if (!board.has(via)) return false
  return costVia(state.puzzle.start, state.puzzle.end, via, board) !== null
}

/**
 * The route the player actually built, cheapest-first through their own
 * placements. `null` until the two sides meet.
 *
 * Weighted by the rough as well as by the crossings, because this is the route
 * the share grid draws and the one `detours` measures against. Left unweighted
 * it could prefer a line through the rough that the score says was the dearer
 * one, and the card would disagree with the number printed above it.
 *
 * Asking through the waypoint is load-bearing rather than tidy. The plain
 * cheapest path across a winning board can perfectly well skip the waypoint —
 * Hungary borders Ukraine, so a board holding both plus Romania has a shorter
 * line that misses the bend entirely — and everything downstream reads this one
 * answer. Left as `shortestPath` the rail would draw a route the round was not
 * won by, and `detours` would print the waypoint under "didn't need".
 */
export function solutionPath(state: GameState): CountryCode[] | null {
  const via = viaOf(state.puzzle)
  const board = inPlay(state)
  const rough = roughIn(state.puzzle)
  if (via === null) return shortestPath(state.puzzle.start, state.puzzle.end, board, rough)
  return routeVia(state.puzzle.start, state.puzzle.end, via, board, rough)
}

/**
 * The player's placements split by which endpoint they hang off, each ordered
 * outward from that endpoint. A country reachable from both — which only
 * happens once the route closes — is listed on the start side alone.
 *
 * This is what the chain rail draws: two runs growing towards each other.
 */
export function sides(state: GameState): {
  fromStart: CountryCode[]
  fromEnd: CountryCode[]
  floating: CountryCode[]
} {
  const board = inPlay(state)
  const placed = new Set(state.placed)

  /** Placed countries reachable from `origin` without routing via `blocked`. */
  const reach = (origin: CountryCode, blocked: CountryCode): CountryCode[] => {
    const order: CountryCode[] = []
    const seen = new Set([origin, blocked])
    let frontier = [origin]
    while (frontier.length > 0) {
      const next: CountryCode[] = []
      for (const current of frontier) {
        for (const neighbour of links(current)) {
          if (seen.has(neighbour) || !board.has(neighbour)) continue
          seen.add(neighbour)
          next.push(neighbour)
          if (placed.has(neighbour)) order.push(neighbour)
        }
      }
      frontier = next.sort()
    }
    return order
  }

  const fromStart = reach(state.puzzle.start, state.puzzle.end)
  const claimed = new Set(fromStart)
  const fromEnd = reach(state.puzzle.end, state.puzzle.start).filter((c) => !claimed.has(c))
  const attached = new Set([...fromStart, ...fromEnd])

  return {
    fromStart,
    fromEnd,
    floating: state.placed.filter((code) => !attached.has(code)),
  }
}

/**
 * Countries the player placed that their final route does not use. These are
 * the detours — paid for, but wasted.
 *
 * Once the only route that can win runs through the waypoint, this is the whole
 * of it. It used to need a second list — the arm out to a waypoint the route
 * never reached, which was paid for and *not* wasted — and that arm no longer
 * exists to be excused.
 */
export function detours(state: GameState): CountryCode[] {
  const route = solutionPath(state)
  if (!route) return []
  const used = new Set(route)
  return state.placed.filter((code) => !used.has(code))
}

/**
 * Why a miss was a miss. Never asked about a country already in play: `place`
 * turns that away before it gets here, and free.
 */
function why(state: GameState, code: CountryCode): Outcome['reason'] {
  if (isClosed(state, code)) return 'closed'
  if (!connectable(code, state.puzzle.start)) return 'unreachable'
  return 'not-adjacent'
}

/**
 * Play a country the player named themselves — by typing it, or by clicking one
 * whose name they already know. Always free; an illegal attempt is just a miss.
 */
export function place(state: GameState, code: CountryCode): Outcome {
  if (state.status === 'won') {
    return { state, code, reveal: false, placed: false, miss: false, won: true }
  }
  // Already on the board — one of the two ends, or something the player put
  // there — and so a question rather than a claim. Refused free, for the reason
  // a shut country is: the board has already answered, in a chip on the rail
  // and a shape lit up on the globe, and charging for reading that back
  // punishes the reading. It is also the commonest mis-tap there is.
  //
  // Nothing changes, so a repeat cannot be worn down into a stroke either. What
  // this deliberately does not cover is a name bought off the globe that never
  // went on the board: naming that again is a fresh claim about a board which
  // has since grown, and it still costs.
  if (inPlay(state).has(code)) {
    return {
      state,
      code,
      reveal: false,
      placed: false,
      miss: false,
      won: false,
      reason: 'already-in-play',
    }
  }
  if (!isLegal(state, code)) {
    return {
      state: { ...state, misses: [...state.misses, code] },
      code,
      reveal: false,
      placed: false,
      miss: true,
      won: false,
      reason: why(state, code),
    }
  }

  const next: GameState = { ...state, placed: [...state.placed, code] }
  const won = isWon(next)
  return {
    state: { ...next, status: won ? 'won' : 'playing' },
    code,
    reveal: false,
    placed: true,
    miss: false,
    won,
  }
}

/**
 * Click a country on the globe. If its name is already known this is identical
 * to typing it — buying a name is a one-time cost. Otherwise the player pays to
 * learn the name, and the country is played in the same motion when legal.
 *
 * Paying for a name that turns out to be illegal costs twice: the reveal and
 * the miss. That is deliberate — in strict mode, pointing at a shape you cannot
 * place is a real gamble.
 */
export function attemptReveal(state: GameState, code: CountryCode): Outcome {
  if (state.status === 'won' || !exists(code)) {
    return { state, code, reveal: false, placed: false, miss: false, won: state.status === 'won' }
  }
  // Refused outright, before anything else, and this is the whole of the fix
  // for pointing at a shut country: it is neither sold nor charged for.
  //
  // Pressing a shape on the globe is how a player *asks* about it. A country
  // that is shut has already answered — greyed and sunk — so charging a miss
  // for touching it punishes them for reading the board. Typing its name is
  // different and still costs: that is a claim that it can be played, and it
  // cannot.
  //
  // It is also the whole of the answer to the double charge, and now the only
  // one. Naming a closure used to be half of it, which held while a closure was
  // small enough to be named and reopened the moment one was not.
  if (isClosed(state, code)) {
    return { state, code, reveal: false, placed: false, miss: false, won: false, reason: 'closed' }
  }
  if (isNamed(state, code)) return place(state, code)

  const revealed: GameState = { ...state, revealed: [...state.revealed, code] }
  return { ...place(revealed, code), reveal: true }
}

/**
 * How far this country sits from joining the two sides up — used to describe a
 * miss ("that one is nowhere near") without giving the route away.
 */
export function stepsFromBoard(state: GameState, code: CountryCode): number | null {
  if (!exists(code)) return null
  const open = without(closedIn(state.puzzle))
  if (!open.has(code)) return null
  let best: number | null = null
  for (const placed of inPlay(state)) {
    // Counted around the closures, since a route through one is not a route the
    // player could take.
    const steps = distance(code, placed, open)
    if (steps !== null && (best === null || steps < best)) best = steps
  }
  return best
}

/**
 * Sea crossings with both ends on the board, which is what a crossing costs.
 *
 * Counted from the board rather than from the finished route, for two reasons:
 * the score has to be right while the round is still being played, and the last
 * leg into the far endpoint is never a placement, so charging at placement time
 * would let the closing crossing go free.
 *
 * A crossing reached by a country that turns out to be a detour is still
 * charged, which is the same bargain the rest of the scoring makes: you pay for
 * what you put on the board, not for what the route ends up using.
 */
export function crossings(state: GameState): number {
  const board = inPlay(state)
  let count = 0
  for (const code of board) {
    for (const other of country(code).sea) {
      // Once per crossing rather than once per end.
      if (code < other && board.has(other)) count++
    }
  }
  return count
}

/** Whether these two countries share a land border. Re-exported for the UI. */
export { borders, country, isSea }
