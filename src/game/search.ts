/**
 * Matching what the player typed to a country.
 *
 * Autocomplete forgives spelling, not knowledge: it will find Türkiye from
 * "turkiye" and the Netherlands from "Holland", but the player still has to
 * come up with a country. Not knowing the name is what reveals are for.
 */
import { CODES, GRAPH, type CountryCode } from './graph'

export const MAX_SUGGESTIONS = 6

/**
 * Lowercase, strip accents and punctuation, collapse whitespace.
 *
 * Hyphens fold to spaces because the on-screen keyboard has no hyphen key, and
 * a name the player can read off the suggestion strip has to be reachable with
 * the keys we hand them. Guinea-Bissau and Timor-Leste are the only two common
 * names that need it — every other one is already letters and spaces.
 */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every name a country answers to, normalized once at module load. */
const INDEX = CODES.map((code) => ({
  code,
  name: GRAPH[code].name,
  terms: [GRAPH[code].name, ...GRAPH[code].alt].map(normalize),
}))

export type Match = { code: CountryCode; name: string }

/**
 * Best matches, strongest first: an exact name beats a prefix, which beats a
 * substring, and the common name outranks an alternate spelling of equal
 * quality. Ties break alphabetically so the list never jitters.
 */
export function search(query: string, limit = MAX_SUGGESTIONS): Match[] {
  const needle = normalize(query)
  if (!needle) return []

  const scored: Array<Match & { rank: number }> = []
  for (const entry of INDEX) {
    let rank = Infinity
    for (const [position, term] of entry.terms.entries()) {
      const penalty = position * 0.01
      if (term === needle) rank = Math.min(rank, penalty)
      else if (term.startsWith(needle)) rank = Math.min(rank, 1 + penalty)
      else if (term.includes(needle)) rank = Math.min(rank, 2 + penalty)
    }
    if (rank < Infinity) scored.push({ code: entry.code, name: entry.name, rank })
  }

  return scored
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ code, name }) => ({ code, name }))
}

/** The single country a query names, if it names one unambiguously. */
export function resolve(query: string): CountryCode | null {
  return search(query, 1)[0]?.code ?? null
}
