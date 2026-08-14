/**
 * What the globe is allowed to show.
 *
 * Kept out of the renderer so the rule that matters most can actually be
 * tested: a country's name is drawn only once the player has earned it. A leak
 * here would hand away the reveals the whole game is priced around, and it
 * would be invisible in a screenshot — you would have to already know the
 * answer to notice.
 */
import { GRAPH, beyond, links, type CountryCode } from './graph'
import type { Draft } from './freeplay'
import {
  closedIn,
  detours,
  inPlay,
  isNamed,
  requiredIn,
  roughIn,
  solutionPath,
  validNextMoves,
  viaOf,
  type GameState,
} from './rules'

export type Role =
  /** Not a playable country: a dependency, disputed territory, Antarctica. */
  | 'inert'
  | 'start'
  | 'end'
  /** On the board. */
  | 'placed'
  /** Name bought, but it could not be played. */
  | 'known'
  /** Shut for the day: named, drawn as a hazard, and never playable. */
  | 'closed'
  /** The dogleg: named from the opening move, and the round must take it in. */
  | 'required'
  /** Casual mode only: legal to play right now. */
  | 'available'
  /** An anonymous shape. */
  | 'unknown'

export type Label = {
  code: CountryCode
  name: string
  lat: number
  lng: number
  role: Role
}

/**
 * Whether a shape costs extra to set foot in. Deliberately *not* a `Role`.
 *
 * `Role` is one-of and answers "what is this country to the round" — an end, a
 * placement, a closure. Rough is none of those: a rough country is also
 * unknown, or also available, or also placed, and folding it into `Role` would
 * mean either hiding the legal-move lighting that `roleResolver`'s ordering
 * exists to protect, or a `rough-available`/`rough-placed`/`rough-unknown`
 * cross-product of every role there is.
 *
 * So it rides its own channel. On the globe that is the polygon's stroke, which
 * survives every fill the role table can produce.
 */
export type Terrain = 'rough' | 'plain'

/**
 * Which endpoint the player is currently treating as their origin.
 *
 * Purely how the puzzle is presented. The two endpoints are interchangeable —
 * a placement is legal against either, and the score counts neither — so which
 * one reads as "from" is the player's preference, and flipping it changes no
 * rule and no score.
 */
export function origin(state: GameState, flipped: boolean): CountryCode {
  return flipped ? state.puzzle.end : state.puzzle.start
}

export function destination(state: GameState, flipped: boolean): CountryCode {
  return flipped ? state.puzzle.start : state.puzzle.end
}

const NOTHING: ReadonlySet<CountryCode> = new Set()

/**
 * Whether a sea crossing could possibly bear on this puzzle.
 *
 * Most cannot. Denmark to Iceland is only ever worth drawing if the round
 * starts or ends in Iceland — no route between two other countries can use it,
 * because Iceland is a dead end hanging off that one link. Drawing all fourteen
 * on every puzzle is thirteen distractions and one that matters.
 *
 * Exact rather than a rule of thumb: every crossing is a bridge, so a route
 * uses it precisely when the two endpoints sit on opposite sides of it. A
 * crossing already touching the board is drawn too — the player has been there,
 * and it explains the stroke it cost them.
 */
export function crossingMatters(state: GameState, from: CountryCode, to: CountryCode): boolean {
  const board = inPlay(state)
  if (board.has(from) || board.has(to)) return true
  const far = beyond(from, to)
  return far.has(state.puzzle.start) !== far.has(state.puzzle.end)
}

/**
 * One stretch of the rail between two of its anchors.
 *
 * `joined` is the countries the player put between them, in order. `gap` is the
 * two runs growing towards each other with the unknown still between.
 */
export type RailLink =
  { joined: CountryCode[] } | { gap: { fromLeft: CountryCode[]; fromRight: CountryCode[] } }

/**
 * What the chain rail has to say, worked out here rather than in the component.
 *
 * It lives here because getting it wrong was a real bug rather than a
 * hypothetical one. The rail used to treat "the two ends are joined" as "the
 * round is over", which they were the same thing until a dogleg arrived — and
 * then it drew a finished round, labelled the spare countries "didn't need",
 * and left the player looking at a complete chain wondering why the game
 * disagreed. Both of those are judgements about the rules, and no rule belongs
 * in a component.
 */
export type RailView = {
  /**
   * The places the round has to run through, in order: the origin, the waypoint
   * if there is one, then the destination. A hole with no dogleg has the two it
   * always had.
   *
   * `hidden` is the waypoint before the player has named it. The chip draws as
   * an anonymous `⚑` — the round is told where its bend is by the globe, and
   * asked for the name. It stops being hidden the moment the country is placed,
   * or the moment the round is over and everything is free to be named.
   */
  anchors: { code: CountryCode; hidden: boolean }[]
  /** One fewer than the anchors: what lies between each neighbouring pair. */
  links: RailLink[]
  /** Placed countries none of the stretches use. */
  spare: CountryCode[]
  /**
   * Nothing is spare until the round is over: with a waypoint still to reach, a
   * country off the route may yet turn out to be the way to it.
   */
  spareLabel: 'wasted' | 'aside'
}

/**
 * Placed countries reachable from `origin` without passing through any other
 * anchor, ordered outward. The two runs either side of a gap.
 */
function runFrom(
  state: GameState,
  origin: CountryCode,
  anchors: readonly CountryCode[],
  claimed: ReadonlySet<CountryCode>,
): CountryCode[] {
  const board = inPlay(state)
  const placed = new Set(state.placed)
  const order: CountryCode[] = []
  // Already spoken for by an earlier stretch. Without this a country between
  // two anchors is reachable from both and is drawn twice — Germany borders
  // France and Poland, so it would sit on either side of the same gap.
  const seen = new Set<CountryCode>([origin, ...anchors, ...claimed])
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

/**
 * The rail as a chain through every place the round must run.
 *
 * `Portugal — ? — ⚑ — ? — Finland` is the hole stated as the player has to
 * solve it, and it is now *literally* what `best` measures: the cheapest route
 * from one end to the other that goes in one border of the waypoint and out
 * another. It used to be an analogy for a tree, which is what let the chain look
 * finished while the game disagreed.
 *
 * The waypoint anchor is drawn without its name. The globe says where the bend
 * is; the chain says a bend is owed and has not been named yet.
 */
export function railView(state: GameState, flipped = false): RailView {
  const route = solutionPath(state)
  const won = state.status === 'won'
  const via = viaOf(state.puzzle)
  // Once the round is over nothing is anonymous — the globe stops charging for
  // names too, and a chain still holding a `?` over a settled score would be
  // withholding the one answer the player came back for.
  const named = new Set([...state.placed, ...(won ? (via ? [via] : []) : [])])
  const anchor = (code: CountryCode) => ({ code, hidden: code === via && !named.has(code) })

  if (route) {
    // Joined up: the chain is the route the player came to, waypoint inline on
    // it, because there is no longer any other kind of winning board. Reversed
    // whole rather than per stretch, so the bend stays where it happened.
    const ordered = flipped ? [...route].reverse() : route
    return {
      anchors: [anchor(ordered[0]), anchor(ordered[ordered.length - 1])],
      links: [{ joined: ordered.slice(1, -1) }],
      spare: detours(state),
      spareLabel: won ? 'wasted' : 'aside',
    }
  }

  const places = [origin(state, flipped), ...(via ? [via] : []), destination(state, flipped)]
  const board = inPlay(state)
  // Claimed left to right, so every placed country is drawn exactly once. Which
  // stretch gets it is reading order and nothing deeper — a country beside two
  // anchors genuinely belongs to both, and Germany borders France and Poland.
  const claimed = new Set<CountryCode>(places)
  const rails: RailLink[] = []

  for (let step = 0; step + 1 < places.length; step++) {
    const [left, right] = [places[step], places[step + 1]]
    // Never asked whether these two are *separately* joined, which the old rail
    // did and which is now the wrong question: two stretches both closed would
    // mean the ends meet and the waypoint is on the board, and that is exactly
    // the board this change stopped calling a win. `solutionPath` above is the
    // only thing entitled to say the chain is complete.
    const fromLeft = board.has(left) ? runFrom(state, left, places, claimed) : []
    fromLeft.forEach((code) => claimed.add(code))
    const fromRight = board.has(right) ? runFrom(state, right, places, claimed) : []
    fromRight.forEach((code) => claimed.add(code))
    rails.push({ gap: { fromLeft, fromRight } })
  }

  return {
    anchors: places.map(anchor),
    links: rails,
    spare: state.placed.filter((code) => !claimed.has(code)),
    spareLabel: 'aside',
  }
}

/**
 * Names the player asked for after the round was already over. Nothing costs
 * anything once the score is settled, so these are free — but the gate lives
 * here rather than in the caller, so that the one rule that matters is enforced
 * in the module that is tested for it: before the win, this set is ignored.
 */
function free(state: GameState, explored: ReadonlySet<CountryCode>): ReadonlySet<CountryCode> {
  return state.status === 'won' ? explored : NOTHING
}

/**
 * How to draw every shape on the globe, with the legal-move set worked out
 * once rather than per polygon.
 */
export function roleResolver(
  state: GameState,
  flipped = false,
  explored: ReadonlySet<CountryCode> = NOTHING,
): (code: CountryCode | null) => Role {
  const available = new Set(validNextMoves(state))
  const closed = closedIn(state.puzzle)
  const required = requiredIn(state.puzzle)
  const named = free(state, explored)

  return (code) => {
    if (!code || !(code in GRAPH)) return 'inert'
    if (code === origin(state, flipped)) return 'start'
    if (code === destination(state, flipped)) return 'end'
    if (state.placed.includes(code)) return 'placed'
    // Ahead of everything a player could act on. A closure that read as
    // available would light up as a legal move and the hazard would silently
    // not exist.
    if (closed.has(code)) return 'closed'
    // Above `available` for the same reason a closure is: a waypoint is lit
    // long before it is reachable, and reading as an ordinary legal move would
    // lose the one thing the player has to be told about the hole. Below
    // `placed`, because once it is on the board the dogleg is turned and it is
    // just another country on the route.
    if (required.has(code)) return 'required'
    if (state.revealed.includes(code) || named.has(code)) return 'known'
    // Legal moves are always lit. Some real borders are invisible on a globe —
    // Spain meets Morocco at Ceuta and Melilla — and hiding those turns a fact
    // of geography into a trick. Lighting them teaches the map instead, and
    // costs nothing away: a lit country is still anonymous until you name it.
    if (available.has(code)) return 'available'
    return 'unknown'
  }
}

/**
 * Which shapes cost extra, worked out once rather than per polygon.
 *
 * Unlike a closure, rough is *marked but not named*. The rule that forces a
 * name onto a closure — an unnamed shape you cannot play is a trap, since the
 * player has no way to reason about what they are routing around — does not
 * reach here, because a rough country is one you may still play. The marking
 * carries the whole cost, and the name stays for sale like any other.
 *
 * That distinction is worth defending: naming the rough would refund a reveal
 * for every country in the region, and the region is the point.
 */
export function terrainResolver(state: GameState): (code: CountryCode | null) => Terrain {
  const rough = roughIn(state.puzzle)
  return (code) => (code && rough.has(code) ? 'rough' : 'plain')
}

/** The same, for a round being built rather than played. */
export function draftTerrainResolver(draft: Draft): (code: CountryCode | null) => Terrain {
  const rough = new Set(draft.rough)
  return (code) => (code && rough.has(code) ? 'rough' : 'plain')
}

/**
 * How to draw every shape while a round is being built rather than played.
 *
 * A half-built draft is exactly what `newGame` refuses to make a `GameState`
 * out of — one end chosen and not the other — so the builder cannot borrow
 * `roleResolver`. It borrows the vocabulary instead, which is the part that
 * matters: the two ends and a closure look the same on the picker as they will
 * in the round it is about to start. The roles a round earns — placed, known,
 * available — cannot arise here, because nothing has been played yet.
 */
export function draftRoleResolver(draft: Draft): (code: CountryCode | null) => Role {
  const closed = new Set(draft.closed)
  const required = new Set(draft.required)

  return (code) => {
    if (!code || !(code in GRAPH)) return 'inert'
    if (code === draft.start) return 'start'
    if (code === draft.end) return 'end'
    if (closed.has(code)) return 'closed'
    if (required.has(code)) return 'required'
    return 'unknown'
  }
}

/** How one shape should be drawn. `null` is terrain with no country behind it. */
export function roleOf(
  state: GameState,
  code: CountryCode | null,
  flipped = false,
  explored: ReadonlySet<CountryCode> = NOTHING,
): Role {
  return roleResolver(state, flipped, explored)(code)
}

/**
 * Every name the globe may draw, and nothing else. Deriving this from
 * `isNamed` rather than from a separate list is deliberate: there is one
 * definition of "the player knows this", and both the rules and the renderer
 * read it. `explored` is the one addition, and it only ever applies once the
 * round is won — see `free`.
 */
export function visibleLabels(
  state: GameState,
  flipped = false,
  explored: ReadonlySet<CountryCode> = NOTHING,
): Label[] {
  const named = free(state, explored)
  const labels: Label[] = []
  for (const code of Object.keys(GRAPH)) {
    if (!isNamed(state, code) && !named.has(code)) continue
    const country = GRAPH[code]
    labels.push({
      code,
      name: country.name,
      lat: country.latlng[0],
      lng: country.latlng[1],
      role: roleOf(state, code, flipped, explored),
    })
  }
  return labels
}

/**
 * The waypoint's marker: where the round has to bend, never what it is called.
 *
 * Deliberately not folded into `visibleLabels`. That function means "names the
 * player has earned", and three tests hold its output to exactly `isNamed` over
 * every country in the graph — the single rule this module exists to protect.
 * An entry appended there would force all three to be loosened, and the next
 * real leak would walk through the gap. A marker is not a name, so it comes
 * from somewhere else.
 *
 * What it carries is no name at all — an empty one, which is the whole point:
 * it gives away nothing the globe was not already saying. The shape is bone and
 * lifted, and the notice over it says a route has to run through the marked
 * country. This only says which one is marked. A `?` stood here first and was
 * removed as a third way of saying the same thing, after the stake and the
 * fill.
 *
 * `null` once the name has been earned, because `visibleLabels` is then drawing
 * that country itself — and drawing it with the `required` role still on it,
 * since `roleResolver` checks `required` before `known`. That is what keeps the
 * marker on a bought waypoint without a second element sitting exactly on top
 * of the first. Once the country is *placed* the role becomes `placed`, the
 * marker goes, and the dogleg has been turned.
 */
export function waypointLabel(
  state: GameState,
  flipped = false,
  explored: ReadonlySet<CountryCode> = NOTHING,
): Label | null {
  const via = viaOf(state.puzzle)
  if (!via) return null
  if (isNamed(state, via) || free(state, explored).has(via)) return null

  const country = GRAPH[via]
  return {
    code: via,
    name: '',
    lat: country.latlng[0],
    lng: country.latlng[1],
    role: roleOf(state, via, flipped, explored),
  }
}
