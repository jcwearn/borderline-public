/**
 * Free play in the address bar.
 *
 * The app has no router and Pages has no SPA fallback, so a path like `/free`
 * would 404 on the real site. Query parameters are the only thing that works
 * everywhere, and they make a built puzzle something you can paste to someone.
 *
 *   ?free                        the builder
 *   ?g=h1oOLA                    a round — what we write, and what gets shared
 *   ?free=SRB-LTU                the same round, spelled out
 *   ?free=SRB-LTU&closed=BGR,EGY that round, with borders shut
 *   ?free=SRB-LTU&rough=BGR,ROU  that round, with ground charged extra
 *   ?free=SRB-LTU&via=BLR         that round, with somewhere it must reach
 *
 * Two forms, because they are wanted for different things. `?g=` is a country
 * per byte through `LINK_CODES`, base64url'd: `?free=IND-MKD&closed=BGR,GRC,SRB`
 * is 32 characters and `?g=RGEOPIc` is 10, and a closure costs about one
 * character rather than four — so the elaborate rounds, the ones worth sending
 * to someone, stop producing the worst links.
 *
 * The spelled-out form stays readable, which is the point of keeping it: it is
 * what you type by hand to try something (`?free=FRA-TUR`), and it is what
 * every round already shared is written in. Nothing writes it any more, and
 * everything still reads it.
 */
import type { Recipe } from './game/freeplay'
import type { CountryCode } from './game/graph'
import { complementOf } from './game/pool'
import { LINK_CODES } from './link-codes'

export type Entry = { mode: 'daily' } | { mode: 'free'; recipe: Recipe | null }

const INDEX = new Map(LINK_CODES.map((code, at) => [code, at]))

/**
 * The first byte of a v2 link, and a byte no v1 link can begin with.
 *
 * Not a convention — a fact about `LINK_CODES`. It holds 165 entries and is
 * capped at 256, so every value from its length upwards decodes to `undefined`
 * and already makes `decodeRecipe` return null. Taking the top of that range
 * means no `?g=` link anyone has ever shared can be read as a v2 link, and the
 * build asserts the table can never grow into it.
 */
const V2 = 0xff

/**
 * Which field a section carries. Position never decides; the tag does.
 *
 * `open` is the closed list written as its complement: every country that is
 * *not* shut. A fairway round closes most of the planet, and ~131 closures at
 * a byte apiece is a link four times the size of the ~34 countries left open.
 * The tag says which reading was meant, so a decoder never has to guess from
 * the count — and a build from before this tag existed refuses the link
 * outright, which is the failure mode the whole format is built around.
 */
const TAG = { closed: 1, rough: 2, required: 3, open: 4 } as const

/** Whether the closed list is big enough that its complement is the short form. */
function complementIsSmaller(closed: readonly CountryCode[] | undefined): boolean {
  const shut = closed?.length ?? 0
  return shut > LINK_CODES.length - shut
}

/**
 * A round with nothing but two ends and some closures still encodes exactly as
 * it always did, so the short links stay short and — the part that matters —
 * every link already in the wild round-trips unchanged. A closure past half
 * the world goes to v2 for the complement form, which no existing link does.
 */
function needsV2(recipe: Recipe): boolean {
  return (
    (recipe.rough?.length ?? 0) > 0 ||
    (recipe.required?.length ?? 0) > 0 ||
    complementIsSmaller(recipe.closed)
  )
}

function bytesOf(codes: readonly CountryCode[]): number[] | null {
  const bytes: number[] = []
  for (const code of codes) {
    const at = INDEX.get(code)
    if (at === undefined) return null
    bytes.push(at)
  }
  return bytes
}

function base64url(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * A recipe as base64url, or null if it names a country the table has not been
 * told about yet — see `src/link-codes.ts`. The build refuses to ship that, so
 * it is unreachable in practice; the caller falls back to the long form rather
 * than take a chance on the share button being the place it turns out to be
 * reachable after all.
 */
function encodeRecipe(recipe: Recipe): string | null {
  if (!needsV2(recipe)) {
    const bytes = bytesOf([recipe.start, recipe.end, ...(recipe.closed ?? [])])
    return bytes && base64url(bytes)
  }

  const ends = bytesOf([recipe.start, recipe.end])
  if (!ends) return null
  const bytes = [V2, ...ends]

  // Tag, then length, then payload. The length is what lets a reader that does
  // not know a tag say so precisely, rather than guess where the next section
  // starts — see `decodeRecipe`, which refuses rather than skips.
  for (const [field, tag] of [
    ['closed', TAG.closed],
    ['rough', TAG.rough],
    ['required', TAG.required],
  ] as const) {
    const codes = recipe[field] ?? []
    if (codes.length === 0) continue
    const payload = bytesOf(codes)
    if (!payload || payload.length > 255) return null

    // The closure goes out as whichever list is shorter — itself, or the world
    // minus itself. `bytesOf` has already refused a country the table does not
    // know, which matters doubly here: a complement that silently dropped an
    // unknown closure would decode to a round with that border open.
    if (field === 'closed' && complementIsSmaller(codes)) {
      const shut = new Set(codes)
      const open = LINK_CODES.flatMap((code, at) => (shut.has(code) ? [] : [at]))
      bytes.push(TAG.open, open.length, ...open)
      continue
    }

    bytes.push(tag, payload.length, ...payload)
  }

  return base64url(bytes)
}

/** The reverse, or null for anything we cannot read as a whole round. */
function decodeRecipe(code: string): Recipe | null {
  let raw: string
  try {
    raw = atob(code.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return null
  }

  const bytes = [...raw].map((character) => character.charCodeAt(0))
  return bytes[0] === V2 ? decodeV2(bytes) : decodeV1(bytes)
}

function decodeV1(bytes: number[]): Recipe | null {
  const codes: string[] = []
  for (const byte of bytes) {
    const country = LINK_CODES[byte]
    if (country === undefined) return null
    codes.push(country)
  }
  if (codes.length < 2) return null

  return { start: codes[0], end: codes[1], closed: codes.slice(2) }
}

/**
 * The tagged form: sentinel, two ends, then any number of length-prefixed
 * sections.
 *
 * An unrecognised tag is a hard refusal rather than a section to step over,
 * and that is the whole reason the lengths are there. A link written by a later
 * build describes a round this one cannot play; skipping the part it does not
 * understand would quietly hand the player a *different* round, which is
 * exactly the failure `link-codes.ts` exists to prevent.
 */
function decodeV2(bytes: number[]): Recipe | null {
  if (bytes.length < 3) return null
  const start = LINK_CODES[bytes[1]]
  const end = LINK_CODES[bytes[2]]
  if (start === undefined || end === undefined) return null

  const recipe: Recipe = { start, end }
  // Which fields have been spoken for, so a second section naming one is
  // refused rather than left to overwrite the first. Same reasoning as the
  // unknown tag and the two-country `required`: a link that says a round is
  // both these things describes a round this build cannot set, and quietly
  // keeping whichever section came last would hand over a *different* puzzle.
  // `closed` and `open` are two spellings of one field and collide as one —
  // which is the pairing that made this reachable, since the winner of that
  // argument decides whether ~130 countries are shut or open.
  const spoken = new Set<keyof Recipe>()
  let at = 3
  while (at < bytes.length) {
    const tag = bytes[at]
    const length = bytes[at + 1]
    if (length === undefined) return null
    const payload = bytes.slice(at + 2, at + 2 + length)
    if (payload.length !== length) return null

    const codes: string[] = []
    for (const byte of payload) {
      const country = LINK_CODES[byte]
      if (country === undefined) return null
      codes.push(country)
    }

    const field =
      tag === TAG.closed || tag === TAG.open
        ? 'closed'
        : tag === TAG.rough
          ? 'rough'
          : tag === TAG.required
            ? 'required'
            : null
    if (field === null || spoken.has(field)) return null
    spoken.add(field)

    if (tag === TAG.closed) recipe.closed = codes
    // The complement, expanded by the same function the pool expands its own
    // with: the sort is load-bearing, since the share invariant is deep
    // equality over the rebuilt puzzle — order included — and a fairway link
    // and the fairway hole it names must spell one closure one way.
    else if (tag === TAG.open) recipe.closed = complementOf(codes)
    else if (tag === TAG.rough) recipe.rough = codes
    // Refused rather than truncated, and for the reason an unknown tag is: a
    // link naming two countries to pass through describes a round this build
    // cannot set, and playing the first of them would quietly hand over a
    // *different* puzzle. The format is unchanged — a length-prefixed list, as
    // it has always been — so every link ever shared still decodes.
    else {
      if (codes.length !== 1) return null
      recipe.required = codes
    }

    at += 2 + length
  }

  return recipe
}

/** What the current URL asks for. */
export function readEntry(search: string): Entry {
  const params = new URLSearchParams(search)

  if (params.has('g')) {
    return { mode: 'free', recipe: decodeRecipe(params.get('g') ?? '') }
  }

  if (!params.has('free')) return { mode: 'daily' }

  const pair = (params.get('free') ?? '').split('-')
  if (pair.length !== 2 || !pair[0] || !pair[1]) return { mode: 'free', recipe: null }

  const list = (name: string) =>
    (params.get(name) ?? '')
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean)

  // `rough` appears only when there is some, where `closed` has always been
  // present. Same discipline as `pickPuzzle`, which omits `closed` entirely on
  // an open day rather than carrying an empty array — and here it also means a
  // link written before the rough existed still reads as exactly what it did.
  const rough = list('rough')
  const required = list('via')

  return {
    mode: 'free',
    recipe: {
      start: pair[0].toUpperCase(),
      end: pair[1].toUpperCase(),
      closed: list('closed'),
      ...(rough.length > 0 ? { rough } : {}),
      ...(required.length > 0 ? { required } : {}),
    },
  }
}

/** The query string for a round, so it can be shared or reloaded. */
export function entryQuery(recipe: Recipe | null): string {
  if (!recipe) return '?free'

  const code = encodeRecipe(recipe)
  if (code) return `?g=${code}`

  const closed = recipe.closed?.length ? `&closed=${recipe.closed.join(',')}` : ''
  const rough = recipe.rough?.length ? `&rough=${recipe.rough.join(',')}` : ''
  const via = recipe.required?.length ? `&via=${recipe.required.join(',')}` : ''
  return `?free=${recipe.start}-${recipe.end}${closed}${rough}${via}`
}

/**
 * Point the address bar at a round without reloading. `replaceState` rather
 * than `pushState`: the back button should leave the game, not walk backwards
 * through every puzzle built in it.
 */
export function showEntry(recipe: Recipe | null): void {
  history.replaceState(null, '', entryQuery(recipe))
}

export function showDaily(): void {
  history.replaceState(null, '', location.pathname)
}
