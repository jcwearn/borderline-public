/**
 * Which barriers a round carries, in what order, and what today's instance of
 * each is called.
 *
 * One table, because the same four facts are wanted in three places — the
 * banner over the board, the rules card's fourth step, and the one-time modal
 * each barrier gets — and written out three times they drift. They already had:
 * the rules card said the rough stood proud of the map, which it has never
 * done, and the closed list was joined one way in `App` and another in
 * `HowToPlay`.
 *
 * Pure, and deliberately so. The copy that goes with these lives in
 * `src/components/mechanics.tsx`, which cannot be here because it is JSX and
 * `src/game/` is free of React.
 */
import { type CountryCode } from './graph'
import { regionIsPlural, regionOf } from './regions'
import { type Puzzle, closuresAreFew, fairwayRound } from './rules'

export type Mechanic = 'fairway' | 'dogleg' | 'rough' | 'bounds' | 'closed'

/**
 * Priority order, stated once and meant three times: which barrier the rules
 * card's fourth step is about, which modal a doubled hole shows first, and
 * which one the card is taken to have covered on a first visit.
 *
 * The fairway comes first because on its day it is not one barrier among
 * several — it is the round's whole shape, and any card or modal that led with
 * something else would be explaining a detail of a course it had not shown.
 */
export const MECHANICS: readonly Mechanic[] = ['fairway', 'dogleg', 'rough', 'bounds', 'closed']

export type Barrier = {
  mechanic: Mechanic
  /**
   * Today's instance, as much of it as the player is allowed: a curated region
   * by name, or a count. Null on a dogleg, which is not even counted.
   */
  label: string | null
  /**
   * Whether that reads as more than one thing. The sentences it goes into are
   * JSX and no test here can run them, so the is/are agreement is decided in
   * this module — where one can — rather than at each of the four places the
   * label is written into a sentence.
   */
  plural: boolean
}

/**
 * Whether a round carries each barrier — by **how it is presented**, not by
 * which combination of barriers the pool used to build it.
 *
 * `closed` and `bounds` are the same payload field with `LONE_CLOSURE_LIMIT`
 * between them, and the line is not where the pool's own vocabulary puts it.
 * Two of the curated regions are exactly two countries, so a round the build
 * filed under `bounds` is two shut borders as far as the player can see, and
 * has to be explained as a closure — because a closure is what they are looking
 * at. The pool's `Combo` is in any case discarded before the puzzle reaches the
 * browser.
 *
 * `closuresAreFew` is true of a round with no closures at all, so the length
 * check in front of it is load-bearing rather than defensive.
 *
 * A fairway round *is* a huge closure and a rough band, and that is exactly why
 * `rough` and `bounds` stand down for it: "112 countries are out of bounds
 * today" and "14 countries are rough today" are both true and both the wrong
 * thing to say about a course. One barrier reads out, and it is the course.
 * The dogleg does not stand down — a waypoint is an ask on top of the course,
 * not part of its shape.
 */
const CARRIES: Record<Mechanic, (puzzle: Puzzle) => boolean> = {
  fairway: (puzzle) => fairwayRound(puzzle),
  dogleg: (puzzle) => Boolean(puzzle.required?.length),
  rough: (puzzle) => Boolean(puzzle.rough?.length) && !fairwayRound(puzzle),
  bounds: (puzzle) =>
    Boolean(puzzle.closed?.length) && !closuresAreFew(puzzle) && !fairwayRound(puzzle),
  closed: (puzzle) => Boolean(puzzle.closed?.length) && closuresAreFew(puzzle),
}

/** A label and whether it takes a plural verb. */
type Named = { label: string; plural: boolean }

/** "1 country", "2 countries". What is left when a name is not on offer. */
function counted(codes: CountryCode[]): Named {
  return {
    label: `${codes.length} ${codes.length === 1 ? 'country' : 'countries'}`,
    plural: codes.length > 1,
  }
}

/**
 * What to call a stretch of ground the round has done something to.
 *
 * A curated region by name, whatever size it is, which is the whole reason the
 * regions exist: "the Maghreb is rough today" is a mechanic, and four hatched
 * shapes with no name between them is a puzzle about the interface. A name for
 * a place is not a name for the countries in it, which is what separates this
 * from everything else the round withholds.
 *
 * Anything else is counted. `regionOf` is exact, so a set that is only nearly a
 * region is not called something it is not; and a lone country is counted too,
 * rather than named, because the name of a country you may cross is exactly
 * what the round is selling.
 */
function placeNamed(codes: CountryCode[]): Named {
  const region = regionOf(codes)
  // A region is one place and still takes a plural verb where its name is one:
  // the Alps are rough today, the Maghreb is.
  return region ? { label: region.name, plural: regionIsPlural(region) } : counted(codes)
}

const LABEL: Record<Mechanic, (puzzle: Puzzle) => Named | null> = {
  // Not counted, like the dogleg: the course is on the globe, drawn — and a
  // count of the shut world is the tonal failure this mechanic exists to
  // avoid.
  fairway: () => null,
  // Not even counted, and that is the hole: the globe marks the waypoint and
  // raises it, so the player is told where. Null by design, not by absence.
  dogleg: () => null,
  rough: (puzzle) => placeNamed(puzzle.rough ?? []),
  // The same rule at both sizes, though only one of them can be a region: a
  // closure is at most two countries, and two of the twelve regions are exactly
  // that. Those rounds are still explained as a closure — see `CARRIES` — and a
  // closure that happens to be a place may as well be called one.
  bounds: (puzzle) => placeNamed(puzzle.closed ?? []),
  closed: (puzzle) => placeNamed(puzzle.closed ?? []),
}

/**
 * Which barriers this round carries, in `MECHANICS` order.
 *
 * The label comes back with the mechanic rather than from a second lookup,
 * which is what makes the ambiguity inexpressible: a `labelOf(puzzle, 'closed')`
 * would return null both for a round with no closure and for a barrier that is
 * never named, and only one of those means anything.
 */
export function barriersIn(puzzle: Puzzle): Barrier[] {
  return MECHANICS.filter((mechanic) => CARRIES[mechanic](puzzle)).map((mechanic) => ({
    mechanic,
    ...(LABEL[mechanic](puzzle) ?? { label: null, plural: false }),
  }))
}
