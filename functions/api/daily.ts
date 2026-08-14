/**
 * GET /api/daily — today's puzzle.
 *
 * Stateless. The puzzle is derived from a calendar date under a server-side
 * salt, so there is nothing to store and everyone playing a given date gets the
 * same one. The salt is the only reason someone cannot read the bundle and
 * precompute the rest of the year.
 *
 * Which date is the player's own: the browser sends `?d=`, because it is the
 * only thing that knows the zone. That is untrusted, so it is honoured only if
 * the calendar agrees it is current somewhere — see `isPlausibleToday`. A date
 * that fails, or a request that sends none, falls back to UTC rather than
 * erroring; a wrong clock should cost you the right rollover, not the game.
 *
 * Caching turns on whether the URL says which day it is answering. When it
 * does, the body is a pure function of that date and the CDN can hold it: the
 * query string is part of the cache key, so an entry can never be served for
 * the wrong day. When it does not, the entry has to die at the next UTC
 * midnight, as it always did. A rejected `?d=` is `no-store` — caching the
 * fallback under the key of the date it refused would poison that date for
 * everyone who legitimately reaches it.
 *
 * A cache that long outlives deployments, so the client asks under `?v=<build>`
 * and ignores anything it did not ask for — see src/daily-client.ts. That
 * parameter is not read here; being in the URL is the whole of its job.
 */
// No `with { type: 'json' }` here, unlike everywhere else in the repo: the
// Cloudflare Pages build image bundles Functions with wrangler 3, whose esbuild
// cannot parse import attributes and fails the build outright. Bundler
// resolution does not need the attribute anyway — see tsconfig.functions.json.
import pool from '../data/pairs.json'
import served from '../data/served.json'
import {
  isPlausibleToday,
  pickPuzzle,
  secondsUntilNextUtcDay,
  utcDate,
  type PuzzlePool,
  type Served,
} from '../../src/game/daily'

type Env = {
  /** Set with `wrangler pages secret put PUZZLE_SALT`. */
  PUZZLE_SALT?: string
  /**
   * Any truthy value unlocks ?date= for local development. Not to be confused
   * with ?d=, which every browser sends and the server bounds to the two or
   * three dates the world is actually on. This one reads any date at all, which
   * is why it must never ship — see the note in wrangler.toml.
   */
  ALLOW_DATE_OVERRIDE?: string
}

/**
 * The slice of Cloudflare's Pages Function context this handler uses. Declared
 * here rather than pulled from @cloudflare/workers-types, whose globals
 * conflict with the Node types the build scripts need.
 */
type RequestContext = { request: Request; env: Env }

const POOL = pool as unknown as PuzzlePool

/**
 * Days already served, which the pool no longer gets a say in. Server-side
 * only, like the pool itself — the browser is told the one day it asked for.
 */
const SERVED = served as unknown as Served

const DAY_SECONDS = 86_400

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
  })
}

export async function onRequestGet({ request, env }: RequestContext): Promise<Response> {
  const salt = env.PUZZLE_SALT
  if (!salt) {
    // Refuse rather than fall back to a default: a silent default would hand
    // everybody a puzzle anyone could have precomputed.
    return json({ error: 'PUZZLE_SALT is not configured' }, { status: 500 })
  }

  const params = new URL(request.url).searchParams

  const override = params.get('date')
  if (override && !env.ALLOW_DATE_OVERRIDE) {
    return json({ error: 'date override is not available here' }, { status: 403 })
  }

  const claimed = params.get('d')
  const local = claimed && isPlausibleToday(claimed) ? claimed : null

  // The date the URL itself carries, and so the one the cache key distinguishes.
  // The development override wins where both are present, which is the only way
  // it can still override anything.
  const named = override ?? local
  const date = named ?? utcDate()

  let puzzle
  try {
    puzzle = await pickPuzzle(POOL, date, salt, SERVED)
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 })
  }

  return json(puzzle, {
    headers: {
      'cache-control': named
        ? // The URL names the date and the body is a pure function of it, so
          // this entry cannot go stale — only unwanted, which `?v=` handles.
          `public, max-age=${DAY_SECONDS}`
        : claimed
          ? // A date was sent and refused. Storing the fallback here would file
            // today's puzzle under the key of the date it refused, and serve it
            // to whoever reaches that date for real.
            'no-store'
          : // Nothing in the URL says which day this is, so it has to expire
            // when the day does.
            `public, max-age=${secondsUntilNextUtcDay()}`,
    },
  })
}
