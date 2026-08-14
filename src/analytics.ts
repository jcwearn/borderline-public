/**
 * What we can learn about how the game is actually played.
 *
 * PostHog, reached through our own `/ingest` path — see
 * `functions/ingest/[[path]].ts`. Everything here is a no-op unless
 * `VITE_POSTHOG_KEY` is set at build time, which it is only for production: `npm
 * run dev`, vitest and the layout suite make no network calls at all, and a
 * preview deployment cannot file events against the real game.
 *
 * Nothing here identifies anybody. There is no account to attach to, the id
 * PostHog keeps is a random one in localStorage rather than a cookie, and every
 * property below is about the round: which puzzle, what it scored, what was
 * pressed. Do Not Track is honoured. Cookieless is not the same as exempt,
 * though — storing anything on someone's device is the act that would need
 * consenting to, which is why the gate in `allowed()` runs before the library
 * loads rather than after: whole countries never have the id written at all.
 *
 * Call sites stay one line long. Anything that has to be read off game state is
 * assembled here, where it can be tested without a browser.
 */
import type { PostHog } from 'posthog-js'
import type { Source } from './game/actions'
import { scorecard } from './game/score'
import type { GameState, Outcome } from './game/rules'
import { readEntry } from './freeplay-url'
import type { Stats } from './storage'
import { isCoarsePointer } from './useCoarsePointer'

type Props = Record<string, unknown>

/** Set in the Cloudflare Pages build environment, and nowhere else. */
const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined

let client: PostHog | null = null
let loading = false
/** Calls made while the chunk was still in flight. */
const pending: Array<(client: PostHog) => void> = []

function run(action: (client: PostHog) => void): void {
  if (!KEY) return
  if (client) action(client)
  else pending.push(action)
}

export function track(event: string, props?: Props): void {
  run((posthog) => posthog.capture(event, props))
}

/**
 * An event sent on the way out of the page. A normal capture is a fetch the
 * browser is entitled to cancel as the tab closes, which is exactly when the
 * one event about giving up would be sent.
 */
export function trackOnExit(event: string, props?: Props): void {
  run((posthog) => posthog.capture(event, props, { transport: 'sendBeacon' }))
}

/** The record, so that streaks and coming back tomorrow are answerable. */
export function setRecord(stats: Stats): void {
  run((posthog) =>
    posthog.setPersonProperties({
      rounds: stats.rounds,
      current_streak: stats.currentStreak,
      max_streak: stats.maxStreak,
    }),
  )
}

export function init(): void {
  if (!KEY || loading) return
  loading = true

  // The globe is a megabyte of topology and the puzzle is the whole point of the
  // page; both get the network first. The timeout is the ceiling, not the wait —
  // a player who leaves in the first seconds still gets their events sent.
  whenIdle(() => {
    void allowed().then((yes) => {
      if (!yes) {
        // Nothing loads, so nothing is written to this device — see
        // src/privacy-region.ts for who this is and why.
        pending.length = 0
        return
      }
      load(KEY)
    })
  })
}

/**
 * Whether this visitor is measured at all, asked of the edge because only the
 * edge knows where they are. Fail closed: a question we could not get an answer
 * to is answered no, since the cost of being wrong that way is one uncounted
 * player rather than one measured who should not have been.
 */
async function allowed(): Promise<boolean> {
  try {
    const response = await fetch('/api/region')
    if (!response.ok) return false
    const body = (await response.json()) as { analytics?: boolean }
    return body.analytics === true
  } catch {
    return false
  }
}

function load(key: string): void {
  void import('posthog-js').then(
    ({ default: posthog }) => {
      posthog.init(key, {
        // Ours, not theirs — the reason anything arrives from a browser with a
        // blocklist in it.
        api_host: '/ingest',
        ui_host: 'https://us.posthog.com',
        // No cookie, so no banner over the globe.
        persistence: 'localStorage',
        respect_dnt: true,
        // The globe is one canvas: an autocaptured click on it records that a
        // canvas was clicked and nothing whatever about the country. Every
        // event here is named on purpose instead.
        autocapture: false,
        // Recording someone's session is a different thing from counting what
        // they did, and needs a different sort of permission. The `guess`
        // events answer what a replay would have been watched for, so this
        // stays off here rather than in a project setting somebody could flip
        // without noticing what it changes.
        disable_session_recording: true,
        // Whether anyone comes back tomorrow is the question, and retention
        // needs a profile — anonymous, and never identified.
        person_profiles: 'always',
      })
      posthog.register({
        // On every event, because "is the touch layout costing us rounds?" is
        // a question about all of them rather than one.
        pointer: isCoarsePointer() ? 'coarse' : 'fine',
        entry_mode: entryMode(location.search),
      })
      client = posthog
      for (const action of pending) action(posthog)
      pending.length = 0
    },
    () => {
      // Analytics is not worth an unhandled rejection, still less a queue that
      // grows for the rest of the session.
      pending.length = 0
    },
  )
}

function whenIdle(load: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(load, { timeout: 3000 })
  else setTimeout(load, 1500)
}

/**
 * How the player got here. A shared round and the builder are both `?free` to
 * the URL and nothing alike to us: one is somebody acting on a link, which is
 * the only measure of a share that means anything.
 */
export function entryMode(search: string): 'daily' | 'free_link' | 'free_builder' {
  const entry = readEntry(search)
  if (entry.mode === 'daily') return 'daily'
  return entry.recipe ? 'free_link' : 'free_builder'
}

/** Which hole is being played. Free rounds have an id, but not a shared one. */
export function roundProps(state: GameState): Props {
  const { puzzle } = state
  const free = Boolean(puzzle.free)
  return {
    mode: free ? 'free' : 'daily',
    puzzle_id: free ? null : puzzle.id,
    start: puzzle.start,
    end: puzzle.end,
    par: puzzle.par,
    best: puzzle.best,
    // Counts, never the codes. What a hole carries is the shape of the puzzle
    // and is the thing worth knowing when a day plays badly; which countries
    // they were is already answerable from `start`, `end` and the date.
    closed_count: puzzle.closed?.length ?? 0,
    rough_count: puzzle.rough?.length ?? 0,
    required_count: puzzle.required?.length ?? 0,
  }
}

/** A finished round, broken down the way the results card breaks it down. */
export function resultProps(state: GameState): Props {
  const card = scorecard(state)
  return {
    ...roundProps(state),
    score: card.score,
    delta: card.delta,
    countries: card.countries,
    crossings: card.crossings,
    // What the round actually spent on the rough, which is the only way to tell
    // a hole where people crossed it from one where they went round: both cost
    // the same par and only one of them charges a premium.
    rough: card.rough,
    misses: card.misses,
    reveals: card.reveals,
    miss_penalty: card.missPenalty,
    reveal_penalty: card.revealPenalty,
    crossing_penalty: card.crossingPenalty,
    rough_penalty: card.roughPenalty,
    waste: card.waste,
  }
}

/**
 * One attempt. `guess_index` counts moves rather than events, so a reveal that
 * places a country is the one move it looks like — which is what makes "how far
 * in do people stop?" a number rather than an impression.
 *
 * `refused` is the fourth outcome and not a kind of miss: the board turned it
 * away without charging, either because the country is already on it or because
 * it is shut. `reason` is what tells those two apart, and keeping them out of
 * `miss` is what stops a mis-tap reading as somebody wrong about the map.
 */
export function guessProps(outcome: Outcome, source: Source): Props {
  const { state } = outcome
  return {
    ...roundProps(state),
    result: outcome.placed
      ? outcome.reveal
        ? 'revealed'
        : 'placed'
      : outcome.miss
        ? 'miss'
        : 'refused',
    source,
    reason: outcome.reason ?? null,
    guess_index: state.placed.length + state.misses.length,
    placed_count: state.placed.length,
    reveal_count: state.revealed.length,
  }
}
