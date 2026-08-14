/**
 * Scoring. Golf-like: the number to beat is par, and lower is better.
 *
 * Both penalties are tuning knobs. The reveal cost in particular is sharp —
 * a reveal that turns out to be illegal is charged twice, once here and once
 * through the miss it also produces.
 */
import type { GameState } from './rules'
import { crossings, detours, isSea, requiredIn, roughIn, roughPlaced, solutionPath } from './rules'
import { ROUGH_COST, SEA_COST } from './graph'

/** Misses needed to add one to the score. */
export const MISS_DIVISOR = 2

/** What learning one country's name adds to the score. */
export const REVEAL_COST = 1

export type Scorecard = {
  /** Countries the player put on the board. */
  countries: number
  /** Sea crossings in play, each charged its premium over a land border. */
  crossings: number
  /** Countries placed in the rough, each charged its premium over open ground. */
  rough: number
  misses: number
  reveals: number
  /** Score contribution from misses alone. */
  missPenalty: number
  /** Score contribution from reveals alone. */
  revealPenalty: number
  /** Score contribution from sea crossings alone. */
  crossingPenalty: number
  /** Score contribution from the rough alone. */
  roughPenalty: number
  /** countries + crossings + rough + missPenalty + revealPenalty. Lower is better. */
  score: number
  /** The shortest route that exists. No round can score below it. */
  best: number
  par: number
  /** score - par. Negative is under par, which is the point of playing well. */
  delta: number
  /** score - best. How much was wasted. Never negative. */
  waste: number
}

export function scorecard(state: GameState): Scorecard {
  const countries = state.placed.length
  const missPenalty = Math.floor(state.misses.length / MISS_DIVISOR)
  const revealPenalty = state.revealed.length * REVEAL_COST
  // A crossing costs SEA_COST where a border costs 1, and a country in the
  // rough costs ROUGH_COST where open ground costs 1, so each adds exactly one
  // over an ordinary move. That is what makes `score` come out as the route's
  // cost minus one, the same identity the pool's `best` is built on: a route
  // with k intermediates, s crossings and r rough countries costs (k + 1) +
  // s + r, and a flawless round places k of them and pays s + r premiums.
  const crossingPenalty = crossings(state) * (SEA_COST - 1)
  const roughPenalty = roughPlaced(state) * (ROUGH_COST - 1)
  const score = countries + crossingPenalty + roughPenalty + missPenalty + revealPenalty
  return {
    countries,
    crossings: crossings(state),
    rough: roughPlaced(state),
    misses: state.misses.length,
    reveals: state.revealed.length,
    missPenalty,
    revealPenalty,
    crossingPenalty,
    roughPenalty,
    score,
    best: state.puzzle.best,
    par: state.puzzle.par,
    delta: score - state.puzzle.par,
    waste: score - state.puzzle.best,
  }
}

/** "+3", "E" for level par. Golf notation, since the scoring is golf-like. */
export function formatDelta(delta: number): string {
  if (delta === 0) return 'E'
  return delta > 0 ? `+${delta}` : `${delta}`
}

/**
 * Golf's name for a round, by how it landed against par. Empty past the point
 * where the names stop being ones people use — nobody says "quadruple bogey"
 * about a geography puzzle.
 */
export function term(delta: number): string {
  const names: Record<number, string> = {
    [-3]: 'Albatross',
    [-2]: 'Eagle',
    [-1]: 'Birdie',
    0: 'Level par',
    1: 'Bogey',
    2: 'Double bogey',
    3: 'Triple bogey',
  }
  return names[delta] ?? ''
}

/**
 * What to say about a finished round.
 *
 * Par is named every time, including when it was matched — that is exactly the
 * moment a player wants to see the number they beat.
 *
 * It reads `waste` rather than `delta`, because since par carries an allowance
 * the two questions came apart: "did you beat par" and "was anything wasted"
 * now have different answers. A single miss still carries no penalty, so it can
 * sit on the card beneath a round that wasted nothing, and calling that round
 * perfect would be a lie the card itself disproves.
 */
export function verdict(card: Scorecard): string {
  const par = `Par is ${card.par}.`
  const name = term(card.delta)

  if (card.waste === 0) {
    const how = card.misses > 0 ? 'the miss was free' : 'nothing wasted'
    return `${name || formatDelta(card.delta)} — ${how}. ${par}`
  }
  return name ? `${name}. ${par}` : par
}

/**
 * The best and worst deltas the chart gives a row of their own. The floor is
 * the largest allowance any day grants, since a flawless round scores exactly
 * that far under par and nothing can beat it.
 */
export const HISTOGRAM_MIN = -2
export const HISTOGRAM_MAX = 4

/** Rows in the results histogram: -2 through +4, plus the aggregated tail. */
export const HISTOGRAM_ROWS = HISTOGRAM_MAX - HISTOGRAM_MIN + 2

export type HistogramRow = {
  /** "-2", "-1", "E", "+1" … "+4", then "5+". */
  label: string
  count: number
  /** The exact delta, or `null` for the aggregated tail. */
  delta: number | null
}

/**
 * The record as a fixed set of rows: eagles through +4, then everything worse
 * in one bucket.
 *
 * Fixed rather than sized to the data, because a chart that changes shape as
 * you play cannot show you improving. Only the tail is aggregated — delta has
 * no upper bound, and a bad round on a par-12 puzzle could be +14 — while the
 * head needs no aggregation, since the allowance puts a hard floor under how
 * far below par a round can land.
 */
export function histogram(distribution: Record<string, number>): HistogramRow[] {
  const rows: HistogramRow[] = Array.from({ length: HISTOGRAM_ROWS - 1 }, (_, index) => {
    const delta = HISTOGRAM_MIN + index
    return { label: formatDelta(delta), count: 0, delta }
  })
  const tail: HistogramRow = { label: `${HISTOGRAM_MAX + 1}+`, count: 0, delta: null }

  for (const [key, count] of Object.entries(distribution)) {
    const delta = Number(key)
    if (!Number.isFinite(delta) || !Number.isFinite(count)) continue
    const index = rowFor(Math.trunc(delta))
    if (index < rows.length) rows[index].count += count
    else tail.count += count
  }

  return [...rows, tail]
}

/**
 * Which histogram row a given round belongs in. Rounds past either end fold
 * into the nearest row rather than being dropped — a delta below the floor can
 * only mean a raised allowance or corrupt data, and neither is worth losing a
 * round over.
 */
export function rowFor(delta: number): number {
  if (delta <= HISTOGRAM_MIN) return 0
  if (delta > HISTOGRAM_MAX) return HISTOGRAM_ROWS - 1
  return delta - HISTOGRAM_MIN
}

/**
 * The share grid: one square per country on the route the player built, framed
 * by the two endpoint flags.
 *
 * Green squares are countries their final route uses, brown ones are the
 * countries it took through the rough, and yellow ones are detours they paid
 * for and did not need. Intermediate countries are never named, so the grid
 * gives nothing away — brown says a stroke was spent on ground, not which.
 *
 * One purple square is the waypoint, drawn where the route turned. It used to
 * be a run of them trailing the card — the arm out to a waypoint the route
 * never used — and there is no such arm now, because the only route that wins
 * is the one that goes through. Keeping the colour keeps a dogleg card reading
 * as a dogleg, and it gives away no more than the blue crossings already do:
 * where the bend was, never which country it is.
 */
export function shareGrid(state: GameState): string {
  const route = solutionPath(state)
  if (!route) return ''
  const rough = roughIn(state.puzzle)
  const required = requiredIn(state.puzzle)

  // Walked rather than counted, so a crossing shows up where it happened. That
  // is the interesting part of the card and it still names nothing.
  let middle = ''
  for (let step = 1; step < route.length; step++) {
    if (isSea(route[step - 1], route[step])) middle += '🟦'
    if (step === route.length - 1) continue
    // Ahead of the rough, which a waypoint can never be anyway — `newGame`
    // refuses that — so the order settles nothing and states the intent.
    if (required.has(route[step])) middle += '🟪'
    else middle += rough.has(route[step]) ? '🟫' : '🟩'
  }

  return middle + '🟨'.repeat(detours(state).length)
}
