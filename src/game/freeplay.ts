/**
 * Building a puzzle instead of being handed one.
 *
 * The daily is chosen on the server from a pool the browser never sees, which
 * makes every feature built on top of it — a closed border, a sea crossing, an
 * eagle — something you can only look at when the calendar offers it. Here the
 * player picks the pair themselves.
 *
 * No server involved and none needed: the whole graph ships, so a puzzle can be
 * built and checked in the browser. What matters is that it is checked the
 * *same way* — `best` comes out of the same identity the pool is built on and
 * the daily is validated against, and par out of the same table. Free play and
 * the daily must never disagree about the same two countries.
 *
 * Pure, so it can be tested. The React side is a form over these three
 * functions and nothing more.
 */
import {
  CODES,
  type CountryCode,
  costVia,
  distance,
  exists,
  isSea,
  links,
  shortestPath,
  without,
} from './graph'
import { difficultyOf, parFor } from './difficulty'
import { FAIRWAY_LIMIT, newGame, type Puzzle } from './rules'

/** What the player chose. Everything else is derived. */
export type Recipe = {
  start: CountryCode
  end: CountryCode
  closed?: CountryCode[]
  /**
   * Ground charged an extra stroke. Chosen a whole region at a time in the
   * builder, but stored as the countries themselves — the rules have no notion
   * of a region, and a link that named one would break the day a region's
   * membership was corrected.
   */
  rough?: CountryCode[]
  /** Countries the round must take in. */
  required?: CountryCode[]
}

/** Which of the six fields the next pick fills. */
export type Slot = 'start' | 'end' | 'closed' | 'rough' | 'required' | 'fairway'

/**
 * A recipe part-way through being built. Distinct from `Recipe` because the
 * whole middle of building one is a state `Recipe` cannot express: one end
 * chosen and not the other.
 *
 * `fairway` is the one field a `Recipe` never carries: it is the corridor the
 * player painted, and `recipeOfDraft` compiles it down to the closed and rough
 * lists the rules actually read. Kept in the draft rather than compiled on
 * every tap so the player edits what they chose, not what it derived to.
 */
export type Draft = {
  start: CountryCode | null
  end: CountryCode | null
  closed: CountryCode[]
  rough: CountryCode[]
  required: CountryCode[]
  fairway: CountryCode[]
}

export const EMPTY_DRAFT: Draft = {
  start: null,
  end: null,
  closed: [],
  rough: [],
  required: [],
  fairway: [],
}

/**
 * Nothing chosen yet — the state clearing the form returns to. Every field,
 * not just the two ends: a draft with only a closed border in it is still
 * something a player would expect a clear to take away.
 */
export function isEmptyDraft(draft: Draft): boolean {
  return (
    !draft.start &&
    !draft.end &&
    draft.closed.length === 0 &&
    draft.rough.length === 0 &&
    draft.required.length === 0 &&
    draft.fairway.length === 0
  )
}

/**
 * The course a painted fairway implies: everything with a link into the
 * corridor (or an endpoint) is the rough band, and everything further is out
 * of bounds. One band exactly — the derivation is what makes painting a
 * course nine taps instead of a hundred and fifty. Sorted, because every
 * closed list a fairway produces anywhere in the codebase is sorted, and the
 * share invariant is deep equality over the rebuilt puzzle.
 *
 * **The waypoint is course ground, not something the carve may bury.** It is
 * an ask on top of the course rather than part of its shape, and the rules
 * refuse a waypoint that is shut and refuse one in the rough — so a carve that
 * swallowed it made every fairway-with-a-dogleg draft unbuildable, which is
 * the whole combination the builder offers a Via field for. Held open here, its
 * neighbours become band like any other course country's, and the round has to
 * be routed out to it.
 *
 * The ends are nullable because the builder draws this live: a corridor painted
 * before both ends are chosen still carves the world, and greying it is the
 * only feedback a corridor tap has — see `previewOf`.
 */
export function deriveFairway(
  start: CountryCode | null,
  end: CountryCode | null,
  fairway: readonly CountryCode[],
  required: readonly CountryCode[] = [],
): { rough: CountryCode[]; closed: CountryCode[] } {
  const course = new Set([start, end, ...fairway, ...required].filter((code) => code !== null))
  const rough: CountryCode[] = []
  const closed: CountryCode[] = []
  for (const code of CODES) {
    if (course.has(code)) continue
    if (links(code).some((other) => course.has(other))) rough.push(code)
    else closed.push(code)
  }
  return { rough: rough.sort(), closed: closed.sort() }
}

/**
 * The draft as the globe should draw it: a painted fairway shown as the closed
 * and rough it will play as, so the world greys and the band hatches live with
 * every corridor tap.
 *
 * Here rather than in the component that wants it, and through the same
 * derivation `recipeOfDraft` compiles with, because the preview and the round
 * must be one carve. Drawn from the first corridor tap rather than from the
 * first tap after both ends are chosen: the corridor gets no colour of its own —
 * open ground among the grey is the whole statement — so until the grey is
 * there, painting and un-painting a country look exactly like doing nothing.
 */
export function previewOf(draft: Draft): Draft {
  if (draft.fairway.length === 0) return draft
  return { ...draft, ...deriveFairway(draft.start, draft.end, draft.fairway, draft.required) }
}

/** The recipe a finished draft names, or null while it is still half-built. */
export function recipeOfDraft(draft: Draft): Recipe | null {
  if (!draft.start || !draft.end) return null
  // A painted fairway supersedes the hand-picked lists — `assign` empties them
  // the moment the first corridor country goes down, so there is nothing here
  // to merge, only to derive. The waypoint survives: an ask on top of the
  // course, not part of its shape.
  if (draft.fairway.length > 0) {
    return {
      start: draft.start,
      end: draft.end,
      ...deriveFairway(draft.start, draft.end, draft.fairway, draft.required),
      required: draft.required,
    }
  }
  return {
    start: draft.start,
    end: draft.end,
    closed: draft.closed,
    rough: draft.rough,
    required: draft.required,
  }
}

/** Whether two lists hold the same countries, whatever order they arrived in. */
function sameCountries(one: readonly CountryCode[], other: readonly CountryCode[]): boolean {
  if (one.length !== other.length) return false
  const held = new Set(other)
  return one.every((code) => held.has(code))
}

/**
 * The corridor a fairway round was painted from, recovered by running the
 * derivation backwards: everything the round left open is the candidate, and it
 * is the corridor only if carving it reproduces exactly the lists that arrived.
 *
 * A `Recipe` never carried the corridor — the rules have no notion of one — so
 * without this a shared fairway link reopened in the builder came back as the
 * ~130 closures and ~15 rough countries it compiled to, which the panel draws
 * as a wall of anonymous chips in which removing any single one silently breaks
 * the carve. Nothing before the fairway could put that many countries in a
 * draft, so this is the size at which the honest lossy answer stopped being one.
 *
 * Gated on the closure being big enough to read as a course at all, so every
 * hand-built round with a handful of borders shut takes the literal path it
 * always has, and checked rather than assumed: a round that merely has a lot
 * shut is not a carve, and is left as the lists it is.
 */
function corridorOf(recipe: Recipe): CountryCode[] | null {
  const closed = recipe.closed ?? []
  if (closed.length <= FAIRWAY_LIMIT) return null

  const rough = recipe.rough ?? []
  const required = recipe.required ?? []
  const outside = new Set([...closed, ...rough, recipe.start, recipe.end, ...required])
  const fairway = CODES.filter((code) => !outside.has(code))
  if (fairway.length === 0) return null

  const derived = deriveFairway(recipe.start, recipe.end, fairway, required)
  return sameCountries(derived.closed, closed) && sameCountries(derived.rough, rough)
    ? fairway
    : null
}

export function draftOf(recipe: Recipe): Draft {
  const fairway = corridorOf(recipe)
  return {
    start: recipe.start,
    end: recipe.end,
    // A carve comes back as the corridor that made it, and the two derived
    // fields come back empty — they are `recipeOfDraft`'s to fill again, and a
    // draft carrying both would be saying the same course twice.
    closed: fairway ? [] : (recipe.closed ?? []),
    rough: fairway ? [] : (recipe.rough ?? []),
    required: recipe.required ?? [],
    fairway: fairway ?? [],
  }
}

/**
 * The recipe a built round came from — what the address bar and the share card
 * both want back out of a `Puzzle`.
 *
 * Here rather than beside the one caller that needed it first, and beside the
 * other two converters, because the thing that went wrong was a copy of this
 * list kept somewhere else: the share card rebuilt a recipe from `start`, `end`
 * and `closed` alone, so every round with rough in it or a dogleg shared a link
 * to a different and easier puzzle. A field list that has to be remembered
 * twice is one that will be remembered once.
 *
 * A `Puzzle` omits an empty barrier rather than carrying `[]`, so passing the
 * fields straight through cannot lengthen the link of a round that has none.
 */
export function recipeOfPuzzle(puzzle: Puzzle): Recipe {
  return {
    start: puzzle.start,
    end: puzzle.end,
    closed: puzzle.closed,
    rough: puzzle.rough,
    required: puzzle.required,
  }
}

/**
 * Put a country into one of the three fields.
 *
 * The picker on the globe and the three text fields both come through here, so
 * that pointing at a country and typing its name cannot disagree — and so that
 * the one interesting question, what a second tap on the same country means,
 * has a single tested answer.
 *
 * A country lands in exactly one field: the last tap wins, and whichever other
 * field held it gives it up. That is what keeps this from handing `buildPuzzle`
 * a draft only the tap made invalid — a country that is both an endpoint and
 * closed, or a round that starts and ends in the same place. The one exception
 * is closing an endpoint, which is refused rather than granted: the shape is
 * already amber or pink, which says why nothing happened, and dropping an end
 * the player spent a tap choosing to honour a tap on a different control is the
 * wrong way round.
 */
export function assign(draft: Draft, slot: Slot, code: CountryCode): Draft {
  const SETS = ['closed', 'rough', 'required', 'fairway'] as const
  if (slot !== 'start' && slot !== 'end') {
    if (code === draft.start || code === draft.end) return draft
    // Once a corridor is painted the closed and rough lists are derived ground,
    // so a pick aimed at either is refused outright rather than kept somewhere
    // `recipeOfDraft` will drop on the way past. The panel takes the two fields
    // away at the same moment, but the mark can still be sitting on one — App
    // advances it to `closed` after the second endpoint — and a tap that
    // vanishes with no chip and no reason is the worst of the three answers.
    if (draft.fairway.length > 0 && (slot === 'closed' || slot === 'rough')) return draft
    const taken = {
      // A country lands in exactly one of the four, because no two of them can
      // be true together: shut says you may not go there, rough prices going
      // there, required says you must, and the fairway is where the round is
      // meant to run. The last tap wins and the others give it up, which is
      // what stops `buildPuzzle` ever seeing a draft only the tap made
      // contradictory.
      ...Object.fromEntries(
        SETS.filter((field) => field !== slot).map((field) => [
          field,
          draft[field].filter((one) => one !== code),
        ]),
      ),
      // `required` replaces where the others accumulate, because a round runs
      // through one country and `buildPuzzle` refuses two. Left to accumulate, a
      // second tap on the globe would build a draft that can only ever come back
      // as an error, which is a builder arguing with itself.
      [slot]: draft[slot].includes(code)
        ? draft[slot].filter((one) => one !== code)
        : slot === 'required'
          ? [code]
          : [...draft[slot], code],
    }
    // The first corridor country retires the hand-picked hazards outright
    // rather than leaving them to be silently ignored: once there is a
    // fairway, the closed and rough lists are derived from it, and a chip
    // that no longer means anything is worse than one that visibly went.
    if (slot === 'fairway') {
      taken.closed = []
      taken.rough = []
    }
    return { ...draft, ...taken }
  }

  // A second tap on the country already in this field clears it, which is the
  // only way to empty a field from the globe — there is no shape for "nothing".
  const chosen = draft[slot] === code ? null : code
  const freed = Object.fromEntries(
    SETS.map((field) => [
      field,
      chosen === null ? draft[field] : draft[field].filter((one) => one !== chosen),
    ]),
  ) as Pick<Draft, (typeof SETS)[number]>

  return slot === 'start'
    ? { start: chosen, end: draft.end === chosen ? null : draft.end, ...freed }
    : { start: draft.start === chosen ? null : draft.start, end: chosen, ...freed }
}

/**
 * Put a whole region into a field, or take it out again.
 *
 * How the builder actually offers the rough, because one rough country is
 * worth exactly one stroke and can never be worth more — the decision the
 * mechanic exists for only appears when the region is big enough that going
 * round is a real alternative. Tapping countries one at a time still works and
 * goes through `assign`; this is the door that leads anywhere interesting.
 *
 * All-or-nothing: a region already wholly in the field comes out, and anything
 * short of that goes fully in. Toggling country by country would leave the
 * player halfway between two regions with no name for where they were.
 */
export function assignRegion(draft: Draft, slot: 'closed' | 'rough', region: CountryCode[]): Draft {
  const usable = region.filter((code) => code !== draft.start && code !== draft.end)
  const held = new Set(draft[slot])
  const already = usable.length > 0 && usable.every((code) => held.has(code))
  return usable.reduce(
    (so_far, code) =>
      already === so_far[slot].includes(code) ? assign(so_far, slot, code) : so_far,
    draft,
  )
}

export type Built = { puzzle: Puzzle } | { error: string }

/**
 * Free play has no puzzle number and no date, but `Puzzle` carries both for the
 * share card and the save slot. Zero is the honest answer for a round that is
 * not the day's, and `free` is what actually keeps it out of the record.
 */
const NO_DAY = { id: 0, date: '' }

/**
 * Turn a recipe into a playable puzzle, or say why it is not one.
 *
 * Validation is mostly `newGame`'s, deliberately: it already refuses unknown
 * countries, a closure sitting on an endpoint, a pair with no route between
 * them, and closures that cut every route. Restating those here would be a
 * second set of rules to keep in agreement with the first. Only the two checks
 * `newGame` does not make are added.
 */
export function buildPuzzle(recipe: Recipe): Built {
  const { start, end } = recipe
  const closed = recipe.closed ?? []
  const rough = recipe.rough ?? []
  const required = recipe.required ?? []

  // Before anything measures a route: the search walks the graph by name and
  // throws on a country that is not in it, so an unknown code has to be caught
  // here rather than left to `newGame`.
  if (!exists(start) || !exists(end)) return { error: 'That is not a country we know.' }
  for (const code of closed) {
    if (!exists(code)) return { error: 'One of the closed countries is not one we know.' }
  }
  for (const code of rough) {
    if (!exists(code)) return { error: 'One of the rough countries is not one we know.' }
  }
  for (const code of required) {
    if (!exists(code)) return { error: 'The country you must pass through is not one we know.' }
  }
  // Ahead of anything measuring a route, because with two of them there is no
  // single figure to measure — see `Puzzle.required`.
  if (required.length > 1) {
    return { error: 'A round can only be sent through one country. Pick just the one.' }
  }

  // `newGame` allows this — nothing in the daily can produce it — and it would
  // otherwise present as a puzzle already won, with a route length of -1.
  if (start === end) return { error: 'Pick two different countries.' }

  const within = closed.length > 0 ? without(closed) : undefined
  const priced = rough.length > 0 ? new Set(rough) : undefined
  // With a waypoint the floor is the cheapest route *through* it, which is a
  // dearer figure than the cheapest route between the ends and a dearer one
  // again than the tree this used to measure. `null` here is not only "no route
  // exists" but "no route can pass through that country", which is the message
  // `legible` has to be able to tell apart.
  const via = required.length === 1 ? required[0] : null
  const cost =
    via === null ? distance(start, end, within, priced) : costVia(start, end, via, within, priced)
  const puzzle: Puzzle = {
    ...NO_DAY,
    free: true,
    start,
    end,
    // The identity the pool is built on and the daily is checked against. `cost`
    // is a cost and not a hop count: a sea crossing counts two and a country in
    // the rough counts two, so a route over water or through the rough scores
    // one more than the countries on it, per crossing and per rough country.
    best: cost === null ? 0 : cost - 1,
    par: 0,
    ...(closed.length > 0 ? { closed } : {}),
    ...(rough.length > 0 ? { rough } : {}),
    ...(required.length > 0 ? { required } : {}),
  }
  puzzle.par = parFor(puzzle.best, difficultyOf(puzzle.best))

  try {
    newGame(puzzle)
  } catch (error) {
    return { error: legible((error as Error).message) }
  }

  // Only reachable when the two are neighbours, which `newGame` is happy with
  // and which is not a puzzle: there would be nothing to place.
  if (puzzle.best < 1)
    return { error: 'Those two already touch — there would be nothing to place.' }

  return { puzzle }
}

/**
 * `newGame`'s messages are written for a puzzle that should never have been
 * built, so they read as faults. In a builder they are ordinary feedback about
 * something the player just typed.
 */
function legible(message: string): string {
  if (message.includes('unknown country')) return 'That is not a country we know.'
  if (message.includes('do not know')) return 'One of the closed countries is not one we know.'
  if (message.includes('roughens one of its own endpoints')) {
    return 'An endpoint cannot be in the rough — it would cost different amounts from either end.'
  }
  if (message.includes('shuts and roughens')) {
    return 'A country cannot be both shut and rough.'
  }
  if (message.includes('requires one of its own endpoints')) {
    return 'An endpoint is already where the round goes — it cannot also be a waypoint.'
  }
  if (message.includes('shuts and requires')) return 'A shut country cannot also be a waypoint.'
  if (message.includes('roughens and requires')) {
    return 'A waypoint cannot be in the rough.'
  }
  if (message.includes('already touches an endpoint')) {
    return 'That waypoint borders an end, so the round would open with the bend half made.'
  }
  if (message.includes('more than one country to pass through')) {
    return 'A round can only be sent through one country. Pick just the one.'
  }
  if (message.includes('no route can pass through')) {
    return 'There is no way into that country and out again without doubling back, so a route cannot pass through it.'
  }
  if (message.includes('endpoint')) return 'A closed country cannot also be an endpoint.'
  if (message.includes('cut every route')) return 'Those closures leave no way through.'
  if (message.includes('no route')) return 'There is no route between those two at all.'
  return message
}

export type RandomOptions = {
  /** Insist the cheapest route uses water. */
  crossing?: boolean
  /** Injectable so a test can be deterministic. */
  random?: () => number
}

/** How many pairs to try before falling back to something guaranteed. */
const ATTEMPTS = 400

/**
 * A random pair worth playing — long enough to be a puzzle, short enough not to
 * be a slog, which is the same range the daily pool is drawn from.
 *
 * With `crossing`, pairs are sampled until one whose cheapest route actually
 * crosses water turns up. Sampling rather than picking an island outright keeps
 * the crossing anywhere along the route instead of always at an end: an island
 * with one berth is a dead end, but Cuba has three, so a route can pass through
 * it. The island fallback only runs if sampling somehow finds nothing.
 */
export function randomRecipe(options: RandomOptions = {}): Recipe {
  const random = options.random ?? Math.random
  const pick = () => CODES[Math.floor(random() * CODES.length)]

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const start = pick()
    const end = pick()
    if (start === end) continue

    const cost = distance(start, end)
    if (cost === null) continue
    const best = cost - 1
    if (best < 3 || best > 10) continue
    if (options.crossing && !crossesWater(start, end)) continue

    return { start, end }
  }

  return options.crossing ? overWater(random) : { start: 'FRA', end: 'POL' }
}

function crossesWater(start: CountryCode, end: CountryCode): boolean {
  const route = shortestPath(start, end)
  if (!route) return false
  for (let step = 1; step < route.length; step++) {
    if (isSea(route[step - 1], route[step])) return true
  }
  return false
}

/**
 * A pair that has to cross water, by construction: one end is an island with no
 * land border at all, so every route off it starts with a crossing.
 */
function overWater(random: () => number): Recipe {
  const islands = CODES.filter((code) => crossesWater(code, 'FRA'))
  const start = islands[Math.floor(random() * islands.length)] ?? 'JPN'
  for (const end of CODES) {
    const cost = distance(start, end)
    if (cost !== null && cost - 1 >= 3 && cost - 1 <= 10 && crossesWater(start, end)) {
      return { start, end }
    }
  }
  return { start, end: 'FRA' }
}
