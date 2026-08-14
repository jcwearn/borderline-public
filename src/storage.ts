/**
 * Local persistence: today's game in progress, and the running record.
 *
 * Everything lives in one localStorage key. Nothing is sent anywhere — there is
 * no account and no server-side state, so a cleared browser is a fresh start.
 */
import type { Mechanic } from './game/mechanics'
import type { GameState, Puzzle } from './game/rules'
import { newGame } from './game/rules'
import { scorecard } from './game/score'

const KEY = 'borderline:v1'

/**
 * Bumped when a stored `distribution` stops meaning what it meant. Version 2
 * is the move to a beatable par: every delta before it was measured against the
 * shortest route rather than against par, and since the difficulty of a past
 * round is not stored there is no way to convert one into the other.
 */
export const STATS_VERSION = 2

export type Stats = {
  /** Which scoring era `distribution` was recorded under. */
  version: number
  /**
   * Rounds finished. There is no way to lose Borderline — only to walk away —
   * so this counts completions, and a win rate would be 100% by construction.
   */
  rounds: number
  currentStreak: number
  maxStreak: number
  /** Score relative to par -> how many times it happened. */
  distribution: Record<string, number>
  /** Puzzle id of the last completed game, to keep streaks honest. */
  lastWonId: number | null
}

type Saved = {
  /** The in-progress or finished game, keyed by its puzzle date. */
  game: { date: string; state: SerializedState } | null
  stats: Stats
  /** Whether the player has been shown the rules. */
  howToPlaySeen: boolean
  /** Whether the player has been told what buying a name costs. */
  revealNoticeSeen: boolean
  /**
   * Barriers whose one-time explanation the player has already read.
   *
   * A list rather than a flag apiece, which is what let the rough, the bounds
   * and the closure join the dogleg here without touching the stored shape — and
   * what will let a fifth barrier do the same. Unknown names are ignored on
   * read, so a build that drops a mechanic does not have to migrate anything
   * either, and one that adds a name does not strand a player who downgrades.
   */
  mechanicsSeen: string[]
  /** Whether the player has waved away the ask for a coffee. */
  supportDismissed: boolean
  /** Which endpoint the player reads as their origin. Presentation only. */
  flipped: boolean
  muted: boolean
}

/** GameState with Puzzle inlined — it is already plain JSON. */
type SerializedState = {
  puzzle: Puzzle
  placed: string[]
  revealed: string[]
  misses: string[]
  status: 'playing' | 'won'
}

export const EMPTY_STATS: Stats = {
  version: STATS_VERSION,
  rounds: 0,
  currentStreak: 0,
  maxStreak: 0,
  distribution: {},
  lastWonId: null,
}

const BLANK: Saved = {
  game: null,
  stats: EMPTY_STATS,
  howToPlaySeen: false,
  revealNoticeSeen: false,
  mechanicsSeen: [],
  supportDismissed: false,
  flipped: false,
  muted: false,
}

/**
 * Built field by field rather than spread over the defaults, so that a record
 * written by an older version carries forward its history under the new name
 * instead of silently reading as zero — and so the retired fields stop being
 * rewritten on every save.
 */
function readStats(saved: unknown): Stats {
  const stats = (saved ?? {}) as Partial<Stats> & { played?: number }
  // A record from an older scoring era keeps everything except the chart. The
  // streak is what a player has actually been building; the histogram is the
  // one part that cannot be honestly recomputed, so it starts again rather than
  // being shifted by a guessed allowance.
  const stale = (stats.version ?? 1) < STATS_VERSION
  return {
    version: STATS_VERSION,
    rounds: stats.rounds ?? stats.played ?? 0,
    currentStreak: stats.currentStreak ?? 0,
    maxStreak: stats.maxStreak ?? 0,
    distribution: stale ? {} : (stats.distribution ?? {}),
    lastWonId: stats.lastWonId ?? null,
  }
}

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return BLANK
    const parsed = JSON.parse(raw) as Partial<Saved>
    return {
      game: parsed.game ?? null,
      stats: readStats(parsed.stats),
      howToPlaySeen: parsed.howToPlaySeen ?? false,
      revealNoticeSeen: parsed.revealNoticeSeen ?? false,
      mechanicsSeen: Array.isArray(parsed.mechanicsSeen) ? parsed.mechanicsSeen : [],
      supportDismissed: parsed.supportDismissed ?? false,
      flipped: parsed.flipped ?? false,
      muted: parsed.muted ?? false,
    }
  } catch {
    // Corrupt or unavailable storage should never stop someone playing.
    return BLANK
  }
}

function write(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    // Private browsing, quota, or storage disabled. The game still works; it
    // just will not be there tomorrow.
  }
}

export function loadStats(): Stats {
  return read().stats
}

/**
 * Whether the player has been shown the rules. Both this and the reveal notice
 * default to unseen when storage is unavailable, so a private window gets the
 * explanation rather than being dropped into an unlabeled globe with none.
 */
export function howToPlaySeen(): boolean {
  return read().howToPlaySeen
}

export function markHowToPlaySeen(): void {
  write({ ...read(), howToPlaySeen: true })
}

/**
 * Whether the player already knows that clicking a shape costs a point. Until
 * they do, the globe refuses to sell them anything — the first round should not
 * be the one that teaches you, by charging you seven times.
 */
export function revealNoticeSeen(): boolean {
  return read().revealNoticeSeen
}

export function markRevealNoticeSeen(): void {
  write({ ...read(), revealNoticeSeen: true })
}

/**
 * Whether the player has already had this barrier explained. `Mechanic` and the
 * order they are explained in are `src/game/mechanics.ts`.
 *
 * Defaults to *unseen* when storage is unavailable, like the rules and the
 * reveal notice and for the same reason: a private window should get the
 * explanation rather than be dropped into a mechanic with none.
 */
export function mechanicSeen(mechanic: Mechanic): boolean {
  return read().mechanicsSeen.includes(mechanic)
}

export function markMechanicSeen(mechanic: Mechanic): void {
  const saved = read()
  if (saved.mechanicsSeen.includes(mechanic)) return
  write({ ...saved, mechanicsSeen: [...saved.mechanicsSeen, mechanic] })
}

/**
 * Whether the player has waved away the ask for a coffee. The ask waits until
 * the record shows somebody keeps coming back, and once they have said no it is
 * never put to them again — an ask that returns every round is an advert with
 * better manners, and the game is meant to be worth playing without paying.
 *
 * Unavailable storage reads as not-dismissed, which sounds like the wrong
 * direction until you remember what gates the ask: the round count comes out of
 * the same record, so a player whose storage is gone is on round zero and is
 * asked nothing.
 */
export function supportDismissed(): boolean {
  return read().supportDismissed
}

export function markSupportDismissed(): void {
  write({ ...read(), supportDismissed: true })
}

/**
 * Which endpoint the player reads as their origin. Remembered so a reload does
 * not quietly reverse the board under someone mid-game.
 */
export function loadFlipped(): boolean {
  return read().flipped
}

export function saveFlipped(flipped: boolean): void {
  write({ ...read(), flipped })
}

export function loadMuted(): boolean {
  return read().muted
}

export function saveMuted(muted: boolean): void {
  write({ ...read(), muted })
}

/**
 * The saved game for this puzzle, or a fresh one. A saved game is only restored
 * when it is the same puzzle — yesterday's progress never bleeds into today.
 */
export function resumeOrStart(puzzle: Puzzle): GameState {
  const { game } = read()
  if (game?.date === puzzle.date && game.state.puzzle.id === puzzle.id) {
    return { ...game.state, puzzle }
  }
  return newGame(puzzle)
}

export function saveGame(state: GameState): void {
  // There is one game slot, and it belongs to the daily. A free round would
  // overwrite it with something that can never be resumed, and the daily's
  // progress would be gone for good.
  if (state.puzzle.free) return
  const saved = read()
  write({ ...saved, game: { date: state.puzzle.date, state } })
}

/**
 * Fold a completed game into the record. Idempotent by puzzle id, so a reload
 * on the results screen cannot inflate the streak.
 */
export function recordWin(state: GameState): Stats {
  const saved = read()
  const { stats } = saved
  // A free round is not a round. Counting one would inflate `rounds`, file a
  // delta against a par nobody else played, and — because the streak resets
  // whenever the last win was not yesterday's puzzle — end a real streak.
  if (state.puzzle.free) return stats
  if (stats.lastWonId === state.puzzle.id) return stats

  const card = scorecard(state)
  const consecutive = stats.lastWonId === state.puzzle.id - 1
  const currentStreak = consecutive ? stats.currentStreak + 1 : 1
  const key = String(card.delta)

  const next: Stats = {
    version: STATS_VERSION,
    rounds: stats.rounds + 1,
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
    distribution: { ...stats.distribution, [key]: (stats.distribution[key] ?? 0) + 1 },
    lastWonId: state.puzzle.id,
  }

  write({ ...saved, stats: next })
  return next
}
