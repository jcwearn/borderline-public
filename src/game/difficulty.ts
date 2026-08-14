/**
 * How hard a route is, and what par it earns.
 *
 * Its own module, and deliberately a leaf with no imports: the browser needs
 * this (free play builds a puzzle client-side and has to arrive at the same par
 * the pool would) and so does `scripts/build-data.ts`, which is type-checked
 * under Node resolution. Anything with a relative import pulls the whole graph
 * into that project along with it.
 */
export type Difficulty = 'easy' | 'medium' | 'hard'

/**
 * A puzzle needs at least three intermediate countries to be worth playing, and
 * the graph's long tail is a slog rather than a daily. The pool is filtered to
 * this range; free play is not, which is why `difficultyOf` clamps.
 */
export const MIN_BEST = 3
export const MAX_BEST = 10

/** Shortest route (what a perfect solve costs) -> difficulty bucket. */
export const BUCKETS = { easy: [MIN_BEST, 3], medium: [4, 6], hard: [7, MAX_BEST] } as const

/**
 * How hard a route of this length plays.
 *
 * Clamps rather than refusing at the ends, because free play can hand this any
 * route the map allows — two neighbours, or a fifteen-country trek — and a par
 * has to come out of it either way. The pool keeps its own explicit range
 * filter, so the daily's bounds do not depend on this being strict.
 */
export function difficultyOf(best: number): Difficulty {
  if (best <= BUCKETS.easy[1]) return 'easy'
  if (best <= BUCKETS.medium[1]) return 'medium'
  return 'hard'
}

/**
 * Shots in hand over the shortest route that exists.
 *
 * Par used to *be* that shortest route, which made a flawless round the best
 * anyone could ever do and left every good card reading `E`. An allowance puts
 * the target above the floor, so playing well shows up as a number under it.
 *
 * Lives here rather than in the puzzle data so it can be retuned without
 * regenerating the pool. Easy and medium give one shot, which a single reveal or
 * two misses spends; hard gives two, so a flawless hard round is an eagle and
 * eagles stay rare.
 */
export const ALLOWANCE: Record<Difficulty, number> = { easy: 1, medium: 1, hard: 2 }

/** The number to beat, given the shortest route and how hard the day is. */
export function parFor(best: number, difficulty: Difficulty): number {
  return best + ALLOWANCE[difficulty]
}
