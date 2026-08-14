/**
 * Fetching the day's puzzle from the Pages Function.
 *
 * There is deliberately no local fallback. Deriving a puzzle in the browser
 * would need the salt, and a puzzle derived without it would differ from
 * everyone else's — quietly turning a shared score into a meaningless one. If
 * the API cannot be reached, the game says so and offers to retry.
 */
import { localDate } from './game/daily'
import { connectable, costVia, distance, exists, without } from './game/graph'
import type { Puzzle } from './game/rules'

/** Replaced at build time — see the `define` in vite.config.ts. */
declare const __BUILD_ID__: string

/**
 * Two things go in the query string, and neither is decoration.
 *
 * `d` is our own date. Only the browser knows what zone it is in, so the server
 * cannot work out when the player's day turns over unless we say — it bounds
 * what we send rather than trusting it, and falls back to UTC if we are wrong.
 *
 * `v` is the build. The response is cached publicly and that cache outlives a
 * deployment: without this, a client shipped at noon can be handed the payload
 * some earlier build left at the edge that morning, and the checks below reject
 * it as a broken puzzle. The query string is part of the cache key, so stamping
 * the build into it retires every entry the old one made.
 *
 * Built per call rather than once at module load, because a tab left open would
 * otherwise go on asking for the date it was opened on.
 */
function endpoint(): string {
  const build = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
  return `/api/daily?v=${build}&d=${localDate()}`
}

export async function fetchDailyPuzzle(signal?: AbortSignal): Promise<Puzzle> {
  const response = await fetch(endpoint(), { signal })

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null)
    throw new Error(detail ?? `Could not reach the daily puzzle (${response.status}).`)
  }

  const puzzle = (await response.json()) as Puzzle
  assertPlayable(puzzle)
  return puzzle
}

/**
 * The server should never send an unplayable puzzle, but the whole game rests
 * on the two endpoints being joinable — so check rather than trust, and fail
 * with something legible instead of an empty board.
 */
function assertPlayable(puzzle: Puzzle): void {
  const bad = (why: string) => new Error(`The daily puzzle looks wrong: ${why}.`)

  if (!puzzle || typeof puzzle.id !== 'number') throw bad('it has no puzzle number')
  if (!exists(puzzle.start)) throw bad(`${puzzle.start} is not a country we know`)
  if (!exists(puzzle.end)) throw bad(`${puzzle.end} is not a country we know`)
  if (puzzle.start === puzzle.end) throw bad('it starts and ends in the same place')
  if (!connectable(puzzle.start, puzzle.end)) throw bad('there is no land route between the two')
  if (!Number.isInteger(puzzle.best) || puzzle.best < 1)
    throw bad('its shortest route makes no sense')

  const closed = puzzle.closed ?? []
  const rough = puzzle.rough ?? []
  const required = puzzle.required ?? []

  for (const code of closed) {
    if (!exists(code)) throw bad(`it closes ${code}, which is not a country we know`)
    if (code === puzzle.start || code === puzzle.end)
      throw bad('it closes one of its own endpoints')
  }
  for (const code of rough) {
    if (!exists(code)) throw bad(`it roughens ${code}, which is not a country we know`)
    // The premium is charged on arriving, so a rough endpoint makes the hole
    // cost different amounts measured from either end — and the pool serves
    // half its pairs backwards.
    if (code === puzzle.start || code === puzzle.end)
      throw bad('it roughens one of its own endpoints')
  }
  if (required.length > 1) throw bad('it asks for more than one country to pass through')
  for (const code of required) {
    if (!exists(code)) throw bad(`it asks for ${code}, which is not a country we know`)
    if (code === puzzle.start || code === puzzle.end)
      throw bad('it asks for one of its own endpoints')
  }

  // The graph is already here, so the claimed route length is checkable rather
  // than merely plausible — a pool built against a different map fails loudly.
  //
  // Measured around the closures, priced through the rough, and on a dogleg
  // routed *through* the waypoint rather than merely reaching it. `costVia`
  // returning null is the same refusal as a floor that disagrees: a hole nobody
  // can play through is not one this build can set.
  const within = without(closed)
  const priced = new Set(rough)
  const floor =
    required.length === 1
      ? costVia(puzzle.start, puzzle.end, required[0], within, priced)
      : distance(puzzle.start, puzzle.end, within, priced)
  if (floor !== puzzle.best + 1) {
    throw bad('its shortest route does not match the map')
  }
  if (!Number.isInteger(puzzle.par) || puzzle.par < puzzle.best) {
    throw bad('par is below the shortest route')
  }
}
