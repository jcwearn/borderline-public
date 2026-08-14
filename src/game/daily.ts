/**
 * Choosing the day's puzzle.
 *
 * Deterministic: the same date and salt always yield the same puzzle, so
 * everyone playing a given calendar date gets the same one with no stored state
 * anywhere. The salt is a server-side secret, which is the only thing stopping
 * someone from reading the bundle and precomputing the rest of the year.
 *
 * Which calendar date that is, is the player's own — the round turns over at
 * their midnight, not at UTC's. The browser is the only thing that knows the
 * zone, so it says; `isPlausibleToday` is what stops the server simply
 * believing it.
 *
 * Imported by both the Pages Function and its tests, so it sticks to Web Crypto
 * and holds no reference to the graph.
 */
import type { Puzzle } from './rules'
import { parFor, type Difficulty } from './difficulty'
import { holeOf, type Combo, type Entry } from './pool'

// Re-exported so the rest of the game can keep asking `daily` about difficulty
// and par. The definitions live in `./difficulty`, which the build script also
// imports — see the note there.
export {
  ALLOWANCE,
  BUCKETS,
  MAX_BEST,
  MIN_BEST,
  difficultyOf,
  parFor,
  type Difficulty,
} from './difficulty'

export type PuzzlePool = Record<Difficulty, Record<Combo, Entry[]>>

/**
 * A day that has already been served, recorded exactly as it went out.
 *
 * Everything but `id` and `date`, which are derivable. `par` is kept rather
 * than recomputed so that retuning `ALLOWANCE` cannot rewrite what a day was
 * worth after somebody has played it.
 */
export type ServedPuzzle = Omit<Puzzle, 'id' | 'date' | 'free'>

/** Served days by date, as YYYY-MM-DD. See `scripts/pin-served.ts`. */
export type Served = Record<string, ServedPuzzle>

/**
 * Day 1. Puzzle numbering counts from here, and the number goes out on every
 * share card — so moving this after launch renumbers everyone's history.
 */
export const EPOCH = '2026-08-10'

const DAY_MS = 86_400_000

/**
 * Difficulty by weekday, so the week ramps up and the weekend is the hard one.
 * The weekday is read off the date string, which is the player's own date — so
 * it is your Saturday that is hard, not Greenwich's. Indexed the way
 * `Date.getUTCDay` counts, from Sunday.
 */
const BY_WEEKDAY: Difficulty[] = [
  'hard', // Sunday
  'easy', // Monday
  'easy',
  'medium',
  'medium',
  'medium',
  'hard', // Saturday
]

/**
 * How often a day carries each kind of hole, as weights out of a hundred.
 *
 * Lives here rather than in the pool for the same reason `ALLOWANCE` does:
 * retuning how often a dogleg turns up should be a one-line change, not a data
 * rebuild that moves every puzzle. The pool holds every hole it can build; this
 * decides how often each is reached for.
 *
 * Before the pool split by combination this was not a decision at all — a
 * closure turned up whenever the digest happened to land on an entry that had
 * one, which was 44% of the time and nobody chose it.
 *
 * Two shapes to the table, both deliberate:
 *
 * - **Barriers are the norm.** Roughly two plain days a week; the rest carry
 *   something. Every mechanic turns up weekly, which is the only way anyone
 *   learns what a dogleg is.
 * - **Doubles are the weekend's.** Easy holds no doubled hole to draw — `easy`
 *   is exactly `best === 3` and two barriers cannot fit under it — and midweek
 *   gets a taste, but stacking is what the hard day is for. It is also where
 *   the holes are: 3,261 of the 3,865 `closed+rough` holes are hard.
 *
 * `bounds` is kept lighter than its siblings on easy, where only 86 holes
 * exist: at a heavier weight a Monday would start repeating itself inside a
 * year. That is a fact about the map rather than a preference.
 *
 * The fairway is the weekend's set piece and midweek's occasional surprise —
 * about thirty a year on hard and nineteen on medium, roughly weekly across
 * the two, and never easy: the pool holds none there, because a three-country
 * hop has no room to be a course. Its weight came out of everything else's
 * share rather than on top, with `open` held above the floor the test under
 * "keeps a plain hole a normal thing" enforces.
 */
const ROTATION: Record<Difficulty, ReadonlyArray<readonly [Combo, number]>> = {
  easy: [
    ['open', 30],
    ['closed', 20],
    ['bounds', 10],
    ['rough', 15],
    ['dogleg', 25],
  ],
  medium: [
    ['open', 26],
    ['closed', 12],
    ['bounds', 11],
    ['rough', 12],
    ['dogleg', 13],
    ['closed+rough', 4],
    ['closed+dogleg', 4],
    ['rough+dogleg', 3],
    ['bounds+dogleg', 3],
    ['fairway', 12],
  ],
  hard: [
    ['open', 16],
    ['closed', 8],
    ['bounds', 8],
    ['rough', 8],
    ['dogleg', 8],
    ['closed+rough', 6],
    ['closed+dogleg', 6],
    ['rough+dogleg', 6],
    ['bounds+dogleg', 4],
    ['fairway', 30],
  ],
}

/** What the rotation can ask a difficulty for. Read by the tests, and by nothing else. */
export function rotationFor(difficulty: Difficulty): ReadonlyArray<readonly [Combo, number]> {
  return ROTATION[difficulty]
}

/** Which kind of hole a day gets, from its own digest. */
function comboFrom(difficulty: Difficulty, draw: bigint): Combo {
  const menu = ROTATION[difficulty]
  const total = menu.reduce((sum, [, weight]) => sum + weight, 0)
  let ticket = Number(draw % BigInt(total))
  for (const [combo, weight] of menu) {
    ticket -= weight
    if (ticket < 0) return combo
  }
  // Unreachable while the weights are positive, and cheaper to state than to
  // convince a reader of.
  return menu[menu.length - 1][0]
}

/**
 * The UTC date, as YYYY-MM-DD. What the server falls back to when the browser
 * did not say which day it is on, and the instant the plausible window below is
 * measured from.
 */
export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * The player's own date, as YYYY-MM-DD. Read off the local getters rather than
 * `toISOString`, which would hand back the UTC day and put the rollover in the
 * middle of the evening for anyone west of Greenwich.
 *
 * For the browser. A Worker's local zone is UTC, so calling this server-side is
 * only ever an expensive `utcDate`.
 */
export function localDate(now: Date = new Date()): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const SHAPE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Reject anything that is not the exact date it claims to be. The shape alone
 * is not enough: `new Date` reads 2026-02-30 as the 2nd of March rather than
 * refusing it, which would let a crafted date name a day the window below was
 * meant to exclude. Round-tripping through `utcDate` is what catches it.
 */
function parseDate(date: string): Date {
  if (!SHAPE.test(date)) throw new Error(`bad date: ${date}`)
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) throw new Error(`bad date: ${date}`)
  if (utcDate(parsed) !== date) throw new Error(`bad date: ${date}`)
  return parsed
}

/**
 * The span of real UTC offsets: Baker Island keeps UTC-12, Kiritimati UTC+14.
 */
const MIN_OFFSET_MS = -12 * 3_600_000
const MAX_OFFSET_MS = 14 * 3_600_000

/**
 * Whether `date` is one somebody on Earth is really on right now.
 *
 * The browser tells the server its date and the server cannot verify it, so the
 * calendar does the verifying instead: at any instant the inhabited world spans
 * only two dates, three for the couple of hours the offsets straddle two
 * midnights. That is the whole of the trust extended — enough for a player in
 * Kiritimati, and nowhere near enough to read the rest of the year out of the
 * API, which is what the salt exists to prevent.
 *
 * Compared as strings, because YYYY-MM-DD sorts chronologically.
 */
export function isPlausibleToday(date: string, now: Date = new Date()): boolean {
  try {
    // Called for the refusal, not the value. A date we cannot read is one we
    // ignore rather than one we fail on — the player still gets a puzzle.
    parseDate(date)
  } catch {
    return false
  }
  return (
    date >= utcDate(new Date(now.getTime() + MIN_OFFSET_MS)) &&
    date <= utcDate(new Date(now.getTime() + MAX_OFFSET_MS))
  )
}

/** Sequential puzzle number — the "#142" in the share text. */
export function puzzleId(date: string): number {
  return Math.round((parseDate(date).getTime() - parseDate(EPOCH).getTime()) / DAY_MS) + 1
}

export function difficultyFor(date: string): Difficulty {
  return BY_WEEKDAY[parseDate(date).getUTCDay()]
}

/**
 * Seconds until the next UTC midnight. Only for the fallback response, whose
 * URL does not say which day it is answering and so must stop being served the
 * moment that day ends. A reply whose URL names its date needs no such limit.
 */
export function secondsUntilNextUtcDay(now: Date = new Date()): number {
  const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000))
}

/**
 * HMAC the date under the secret salt and read the digest as one big number.
 * Using the whole digest rather than a slice keeps the modulo bias far below
 * anything that could show up across a pool of a few thousand.
 */
async function digestToNumber(date: string, salt: string): Promise<bigint> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(date))
  let value = 0n
  for (const byte of new Uint8Array(signature)) value = (value << 8n) | BigInt(byte)
  return value
}

/**
 * The puzzle for a given date. Difficulty comes from the weekday; which puzzle
 * within that difficulty comes from the salted digest.
 *
 * Unless the date has already been served, in which case what it was is not a
 * question the pool gets to answer again. The index is `digest mod
 * pool[difficulty].length` over an array in file order, so regenerating the
 * pool reshuffles every date — the pool *is* the index, and no arrangement of
 * it can be made stable. `served` is the record that makes a rebuild safe: a
 * day somebody may be part-way through keeps the board they started on.
 *
 * Only dates the world is currently on can reach this at all — `?date=` is
 * gated on a flag production does not have, and `isPlausibleToday` bounds `?d=`
 * to two or three dates — so the record only ever needs those, and stays a
 * handful of entries rather than growing with the calendar.
 */
export async function pickPuzzle(
  pool: PuzzlePool,
  date: string,
  salt: string,
  served?: Served,
): Promise<Puzzle> {
  const pinned = served?.[date]
  // `id` and `date` last: they are derived here, and a record that disagreed
  // about which day it was would be a record of a different day.
  if (pinned) return { ...pinned, id: puzzleId(date), date }

  const difficulty = difficultyFor(date)

  // What kind of hole first, then which one. Its own digest, like the coin
  // below: drawing both from one would tie the kind of hole to its position in
  // the array, so a rare combination would always land on the same few entries.
  const combo = comboFrom(difficulty, await digestToNumber(`${date}:combo`, salt))
  const candidates = pool[difficulty]?.[combo]
  if (!candidates?.length) {
    throw new Error(`puzzle pool has nothing for "${difficulty}" "${combo}"`)
  }

  const index = Number((await digestToNumber(date, salt)) % BigInt(candidates.length))
  const hole = holeOf(combo, candidates[index])

  // Half the days run the pair backwards, so a given pair does not always
  // present from the same end. Sound only because cost is symmetric, which it
  // is exactly while no endpoint is rough — the build refuses one.
  const flipped = (await digestToNumber(`${date}:flip`, salt)) % 2n === 1n

  return {
    id: puzzleId(date),
    date,
    start: flipped ? hole.end : hole.start,
    end: flipped ? hole.start : hole.end,
    best: hole.best,
    par: parFor(hole.best, difficulty),
    // The barriers travel with the hole rather than being drawn separately, so
    // a barrier day is one the pool already knows is solvable through. Omitted
    // entirely otherwise, so the payload never carries an empty array — which
    // is also what keeps an open day's reply the same size it always was.
    ...(hole.closed?.length ? { closed: hole.closed } : {}),
    ...(hole.rough?.length ? { rough: hole.rough } : {}),
    ...(hole.required?.length ? { required: hole.required } : {}),
  }
}
