/**
 * The on-screen keyboard's layout, and the rules for typing on it.
 *
 * Kept out of the component because the interesting part is not the grid, it is
 * that twenty-seven keys have to be provably enough to name any country on the
 * board. Only letters and spaces survive `normalize`, and the hyphens in
 * Guinea-Bissau and Timor-Leste fold to spaces there for exactly this reason —
 * `search.test.ts` holds that invariant against the data.
 */

export const BACKSPACE = 'backspace'
export const SPACE = ' '

/** Longest name anyone can type is "central african republic", at 24. */
export const MAX_QUERY = 32

/** The width of a row, in half-key units. Ten letters, two units each. */
export const ROW_UNITS = 20

export type Key = {
  /** What the player sees. */
  label: string
  /** What `applyKey` is handed. */
  value: string
  /** Width in half-key units. */
  span: number
}

export type KeyRow = {
  /** Blank units before the first key — what indents the home row. */
  offset: number
  keys: readonly Key[]
}

function letters(values: string): Key[] {
  return [...values].map((value) => ({ label: value, value, span: 2 }))
}

/**
 * Three rows and no Enter key: nothing here can submit, because a raw string is
 * never an answer — `search` has to turn it into a country first, and the
 * suggestion chips above the keys are where that choice gets made.
 *
 * Widths are whole units against a fixed twenty-column grid rather than flex
 * ratios, so a key lands on the same pixel column on every phone and the two
 * wide keys can't drift half a pixel out of line with the letters above them.
 */
export const KEY_ROWS: readonly KeyRow[] = [
  { offset: 0, keys: letters('qwertyuiop') },
  { offset: 1, keys: letters('asdfghjkl') },
  {
    offset: 0,
    keys: [
      { label: '␣', value: SPACE, span: 3 },
      ...letters('zxcvbnm'),
      // Right-hand end, where every phone keyboard puts it.
      { label: '⌫', value: BACKSPACE, span: 3 },
    ],
  },
]

/**
 * The query after one keystroke.
 *
 * Returns the very same string when a key changes nothing, so React can skip
 * the search and the re-render behind a dead press.
 */
export function applyKey(query: string, value: string): string {
  if (value === BACKSPACE) return query.slice(0, -1)
  if (value === SPACE) {
    // A leading or doubled space can only ever make the query match less.
    return query === '' || query.endsWith(' ') ? query : query + ' '
  }
  if (!/^[a-z]$/.test(value)) return query
  if (query.length >= MAX_QUERY) return query
  return query + value
}
