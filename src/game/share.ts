/**
 * The share card.
 *
 * Names the two endpoints and nothing else. The route itself is a row of
 * coloured squares, so posting a result cannot spoil the puzzle for anyone who
 * has not played it yet.
 */
import { entryQuery } from '../freeplay-url'
import { GRAPH } from './graph'
import { recipeOfPuzzle } from './freeplay'
import type { GameState } from './rules'
import { formatDelta, scorecard, shareGrid, term } from './score'

/**
 * The `www.` is doing real work. iMessage's data detector does not recognise a
 * bare `borderline.golf` as a link — `.golf` is new enough that it is not in the
 * TLD list — so the card pasted as plain text and got no preview at all. Both a
 * scheme and a `www.` prefix force the match; `www.` is the one that still looks
 * like something a person would write.
 */
export const SITE = 'www.borderline.golf'

export function shareText(state: GameState): string {
  const card = scorecard(state)
  const start = GRAPH[state.puzzle.start]
  const end = GRAPH[state.puzzle.end]
  const free = Boolean(state.puzzle.free)

  // The golf word only goes on a round that went under par. That is the newly
  // expressible thing, and it is a word rather than a badge because the card is
  // plain text that gets pasted into clients with their own ideas about emoji.
  const under = card.delta < 0 ? ` ${term(card.delta)}` : ''

  // A free round has no number to quote, and naming it as free play is what
  // stops the card reading as a claim about a day everyone else played.
  const title = free ? 'Borderline · free play' : `Borderline #${state.puzzle.id}`

  const lines = [
    `${title}  ${start.flag}→${end.flag}`,
    `Par ${card.par} · ${card.score} (${formatDelta(card.delta)})${under}`,
    `${start.flag}${shareGrid(state)}${end.flag}`,
  ]

  // Only mention the penalties that actually happened, plus the hazard if the
  // hole played closed — that is context for the score rather than a penalty,
  // and it names nothing, so it cannot spoil the route.
  const tally = [
    card.misses > 0 ? `❌${card.misses}` : null,
    card.reveals > 0 ? `💡${card.reveals}` : null,
    state.puzzle.closed?.length ? '⛔' : null,
  ].filter(Boolean)
  if (tally.length > 0) lines.push(tally.join(' '))

  // A free round links to itself rather than to the front page, so whoever it
  // is sent to gets the same two countries, the same borders shut, the same
  // ground in the rough and the same bend in the route — the card is only worth
  // comparing against a round somebody else can actually play. `recipeOfPuzzle`
  // rather than a recipe assembled here, because assembling one here is exactly
  // how the rough and the dogleg fell out of it.
  lines.push(free ? `${SITE}/${entryQuery(recipeOfPuzzle(state.puzzle))}` : SITE)
  return lines.join('\n')
}

/**
 * Put the result somewhere the player can paste it. Prefers the native share
 * sheet on mobile, falls back to the clipboard, and finally to a hidden
 * textarea for browsers that will not do either without a secure context.
 */
export async function shareResult(text: string): Promise<'shared' | 'copied'> {
  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (error) {
      // The player dismissing the sheet is not a failure worth reporting, but
      // anything else should still get a clipboard attempt.
      if ((error as Error).name === 'AbortError') return 'shared'
    }
  }

  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    legacyCopy(text)
    return 'copied'
  }
}

function legacyCopy(text: string): void {
  const scratch = document.createElement('textarea')
  scratch.value = text
  scratch.setAttribute('readonly', '')
  scratch.style.position = 'fixed'
  scratch.style.opacity = '0'
  document.body.appendChild(scratch)
  scratch.select()
  document.execCommand('copy')
  document.body.removeChild(scratch)
}
