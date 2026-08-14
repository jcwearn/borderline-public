/**
 * The shape of the daily pool, stated once.
 *
 * A leaf away from the graph, like `./difficulty` and `./terrain` and for the
 * same reason: `scripts/build-data.ts` writes this file's format and
 * `src/data/data.test.ts` checks what got written, and neither can import
 * anything that reaches the graph. Three restatements of a wire format is three
 * chances for the pool to mean something different to the thing reading it.
 * The one import is `../link-codes.ts`, itself a leaf of pure data.
 *
 * A hole is a pair of countries, a floor, and whichever barriers it carries.
 * The barriers are what makes it a hole rather than a search, and a day may
 * carry two of them — so the pool is split by *combination*, not by variant.
 * That split is doing two jobs:
 *
 * 1. It lets the day choose what kind of hole it wants before it chooses which
 *    hole, which is what turns barrier frequency from an accident of pool
 *    composition into something `src/game/daily.ts` decides.
 * 2. It names the shape of every entry in it, so the entries stay tuples. The
 *    same holes written as objects run to about four megabytes; the key that
 *    says which lists an entry carries is not worth repeating fifty thousand
 *    times.
 *
 * `TAIL` is therefore the format. Position within an entry means nothing on its
 * own — the combo it is filed under says what each list is.
 */
// The extension is load-bearing: `scripts/build-data.ts` imports this module,
// which pulls it into the Node project, where resolution is `nodenext` and a
// relative import without one is an error. See the same note in `./graph`.
import { LINK_CODES } from '../link-codes.ts'

/** Which barriers a hole carries. `open` carries none. */
export type Combo =
  | 'open'
  | 'closed'
  | 'bounds'
  | 'rough'
  | 'dogleg'
  | 'closed+rough'
  | 'closed+dogleg'
  | 'rough+dogleg'
  | 'bounds+dogleg'
  | 'fairway'

/** Which barrier field each list after `best` fills, per combo. */
export const TAIL: Record<Combo, ReadonlyArray<'closed' | 'rough' | 'required' | 'fairway'>> = {
  open: [],
  // One country shut, against a whole region shut. The payload is the same
  // field either way — `Puzzle.closed` has always been a list — but they are
  // different holes to play and to draw, so they are counted and rationed
  // apart. `LONE_CLOSURE_LIMIT` is where one becomes the other.
  closed: ['closed'],
  bounds: ['closed'],
  rough: ['rough'],
  dogleg: ['required'],
  'closed+rough': ['closed', 'rough'],
  'closed+dogleg': ['closed', 'required'],
  'rough+dogleg': ['rough', 'required'],
  'bounds+dogleg': ['closed', 'required'],
  // Stored as its complement: the wire carries the open ground — the fairway
  // corridor, then the rough band — and the closed list is everything else,
  // derived in `holeOf`. A fairway shuts most of the world, and ~140 closed
  // codes written out per hole is megabytes of pool; the corridor is a tenth
  // the size. There is no `fairway` field on a `Hole` — decoded, it is closed
  // and rough like anything else.
  fairway: ['fairway', 'rough'],
}

/** Every combo, in the order the build reports them. */
export const COMBOS = Object.keys(TAIL) as Combo[]

/** Combos that carry no barrier at all, or exactly one. */
export const SINGLES: Combo[] = COMBOS.filter((combo) => TAIL[combo].length <= 1)

/**
 * A hole: start, end, the shortest route that exists, then one list per barrier
 * the combo names.
 */
export type Entry = [start: string, end: string, best: number, ...tail: string[][]]

export type PuzzlePool = Record<string, Record<string, Entry[]>>

/** What an entry says, once the combo it is filed under has explained it. */
export type Hole = {
  start: string
  end: string
  best: number
  closed?: string[]
  rough?: string[]
  required?: string[]
}

/**
 * Everything in the world that is not on the given lists, sorted.
 *
 * `LINK_CODES` stands in for "the world" because it is the one full country
 * list a graph-free module can read; the build fails rather than file a
 * fairway hole while that table and the graph disagree, so the complement here
 * is the complement there. Sorted because the share invariant is deep equality
 * over the rebuilt puzzle, order included — every closed list a fairway hole
 * produces has to come out the same way every time.
 *
 * Exported for `src/freeplay-url.ts`, which expands the same complement out of
 * a share link. Deep equality over the rebuilt puzzle is exactly a claim that
 * the pool's spelling of a closure and the link's are one spelling, and two
 * hand-written copies of "the world minus these, sorted" is how that stops
 * being true — silently, and only across builds, where no test here can see it.
 */
export function complementOf(...open: string[][]): string[] {
  const named = new Set(open.flat())
  return LINK_CODES.filter((code) => !named.has(code)).sort()
}

/**
 * Read an entry against the combo it was filed under.
 *
 * Throws rather than guessing on a tail that does not match: an entry whose
 * lists have been read as the wrong barrier is a puzzle that prices the wrong
 * ground, and that is worth failing loudly for in the one place it can be
 * caught.
 */
export function holeOf(combo: Combo, entry: Entry): Hole {
  const fields = TAIL[combo]
  if (!fields) throw new Error(`pool has an entry filed under an unknown combo "${combo}"`)

  const [start, end, best, ...tail] = entry
  if (tail.length !== fields.length) {
    throw new Error(
      `${combo} entry ${start}->${end} carries ${tail.length} lists, not ${fields.length}`,
    )
  }

  // The fairway is the one combo whose wire shape is not its played shape: the
  // open ground is what is written, the closure is what is meant.
  if (combo === 'fairway') {
    const [fairway, rough] = tail
    return { start, end, best, closed: complementOf(fairway, rough), rough }
  }

  const hole: Hole = { start, end, best }
  fields.forEach((field, at) => {
    if (field !== 'fairway') hole[field] = tail[at]
  })
  return hole
}

/** The inverse, for the build: a hole written as the combo's tuple. */
export function entryOf(combo: Combo, hole: Hole): Entry {
  if (combo === 'fairway') {
    return [
      hole.start,
      hole.end,
      hole.best,
      complementOf(hole.closed ?? [], hole.rough ?? []),
      hole.rough ?? [],
    ]
  }
  return [
    hole.start,
    hole.end,
    hole.best,
    ...TAIL[combo].map((field) => (field === 'fairway' ? [] : (hole[field] ?? []))),
  ]
}

/**
 * Every hole in the pool, with the difficulty and combination it was filed
 * under. For the tests, which have to walk what got committed rather than trust
 * the shape it was written in.
 */
export function* holes(
  pool: PuzzlePool,
): Generator<{ difficulty: string; combo: Combo; hole: Hole }> {
  for (const [difficulty, combos] of Object.entries(pool)) {
    for (const [name, entries] of Object.entries(combos)) {
      const combo = name as Combo
      for (const entry of entries) yield { difficulty, combo, hole: holeOf(combo, entry) }
    }
  }
}
