/**
 * Record what the live site is serving right now, so that rebuilding the pool
 * cannot change it.
 *
 * The day's puzzle is `digest mod pool[difficulty].length` over an array in
 * file order, so any insertion, removal or reorder reshuffles every date. That
 * is fine for a date nobody can reach and not fine for one somebody is part-way
 * through, and the only way to tell the difference is to write down what went
 * out. `functions/data/served.json` is that record; `pickPuzzle` reads it
 * before it reads the pool.
 *
 * It asks production rather than recomputing, and that is the point rather than
 * a shortcut. `PUZZLE_SALT` is a Cloudflare secret and secrets cannot be read
 * back, so recomputing would need a salt this machine does not have — and the
 * salt in `.dev.vars` is a development one that answers a different question
 * entirely. What the site says it is serving is the only authority there is.
 *
 * Only two or three dates are ever reachable: `?date=` is gated on a flag
 * production does not carry, and `isPlausibleToday` bounds `?d=` to the dates
 * somewhere on Earth is currently on. Everything older is already unreachable
 * by construction and needs no protection. So this stays a handful of entries
 * rather than growing with the calendar, and asking for a date outside the
 * window is not an error — the site simply answers with today, which is why
 * every reply is filed under the date it says it is rather than the one asked
 * for.
 *
 * The rule is not "run this before `build:data`". It is "run this while the old
 * pool is still live", and the two come apart because the window moves: at
 * 09:00 UTC the reachable dates are the 11th and the 12th, and by 11:00 UTC
 * they are the 11th, 12th and 13th. Pin at 09:00, deploy at noon, and the 13th
 * went out from the old pool to anyone on UTC+14 for two hours without ever
 * being recorded.
 *
 * Since it asks production rather than the working tree, it is safe at any
 * point up to the deploy, and re-running only appends. So run it last, however
 * many times it has already been run:
 *
 *     npm run pin:served
 *     npm run build:data
 *     # commit both, merge promptly — and if hours pass, pin again first
 *
 * Skipping that is the one remaining way a day somebody is playing can still
 * move.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Restated rather than imported from `src/game/daily.ts`, for the reason
 * `src/game/difficulty.ts` gives at length: anything with a relative import
 * pulls the whole graph into this project along with it, and `daily.ts` reaches
 * `rules.ts` and then `graph.ts`. `daily.test.ts` type-checks the two against
 * each other, which is where a disagreement would surface.
 */
type ServedPuzzle = {
  start: string
  end: string
  best: number
  par: number
  closed?: string[]
  rough?: string[]
  required?: string[]
}

type Served = Record<string, ServedPuzzle>

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, 'functions/data/served.json')

const DEFAULT_ORIGIN = 'https://borderline.golf'

/** The span of real UTC offsets, as `isPlausibleToday` measures it. */
const MIN_OFFSET_MS = -12 * 3_600_000
const MAX_OFFSET_MS = 14 * 3_600_000

function fail(message: string): never {
  throw new Error(`pin-served: ${message}`)
}

function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10)
}

const origin = process.argv.includes('--from')
  ? process.argv[process.argv.indexOf('--from') + 1]
  : DEFAULT_ORIGIN

/**
 * Every date the site could currently be asked for: the near edge of the world
 * to the far one, inclusive. Two dates most of the time, three for the couple
 * of hours the offsets straddle two midnights.
 */
function reachableDates(now: Date): string[] {
  const first = utcDate(new Date(now.getTime() + MIN_OFFSET_MS))
  const last = utcDate(new Date(now.getTime() + MAX_OFFSET_MS))
  const dates: string[] = []
  for (let day = new Date(`${first}T00:00:00Z`); utcDate(day) <= last;) {
    dates.push(utcDate(day))
    day = new Date(day.getTime() + 86_400_000)
  }
  return dates
}

/** What the site is serving for a date, filed under the date it answered. */
async function ask(date: string): Promise<{ date: string; puzzle: ServedPuzzle }> {
  const url = `${origin}/api/daily?v=pin&d=${date}`
  const response = await fetch(url)
  if (!response.ok) fail(`${url} answered ${response.status}`)

  const body = (await response.json()) as ServedPuzzle & { date?: string }
  if (typeof body.date !== 'string') fail(`${url} answered without a date`)

  // Copied field by field rather than spread. `id` and `date` are derived from
  // the calendar and have no business in the record, and picking explicitly
  // means a later build adding something to the reply cannot quietly widen what
  // gets pinned. `date` here is the site's answer, which is not always the
  // question: a date outside the window comes back as today.
  const puzzle: ServedPuzzle = {
    start: body.start,
    end: body.end,
    best: body.best,
    par: body.par,
    ...(body.closed ? { closed: body.closed } : {}),
    ...(body.rough ? { rough: body.rough } : {}),
    ...(body.required ? { required: body.required } : {}),
  }
  return { date: body.date, puzzle }
}

const existing: Served = JSON.parse(readFileSync(FILE, 'utf8'))
const pinned: Served = { ...existing }

const now = new Date()
const added: string[] = []

for (const date of reachableDates(now)) {
  const { date: answered, puzzle } = await ask(date)

  const before = pinned[answered]
  if (before) {
    // Append-only, and this is the assertion that makes it mean something: if
    // the site now serves something else for a day already recorded, that day
    // has already moved and no amount of writing it down will move it back.
    const [was, is] = [JSON.stringify(before), JSON.stringify(puzzle)]
    if (was !== is) fail(`${answered} was served as ${was} and is now ${is}`)
    continue
  }

  pinned[answered] = puzzle
  added.push(answered)
}

const ordered = Object.fromEntries(Object.entries(pinned).sort(([a], [b]) => a.localeCompare(b)))
// Indented rather than minified like the pool, because this one is meant to be
// read by whoever is wondering what a given day actually was. It is in
// `.prettierignore` for the ordinary reason a written file is: prettier folds a
// short array onto one line and this does not, so the two would take turns
// rewriting it.
writeFileSync(FILE, JSON.stringify(ordered, null, 2) + '\n')

console.log(`origin         ${origin}`)
console.log(`reachable      ${reachableDates(now).join(', ')} (as of ${now.toISOString()})`)
console.log(`added          ${added.length ? added.join(', ') : 'nothing new'}`)
console.log(`pinned         ${Object.keys(ordered).length} days total`)
console.log('')
console.log('Run this again right before the new pool goes live. The window above moves,')
console.log('and a date that enters it after this ran is not in the record — so it is the')
console.log('one that will move under whoever is playing it.')
