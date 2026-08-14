/**
 * Where a guess came from, and what that costs.
 *
 * This is the whole economy of the game in one function, and it was wrong once:
 * the typed input was wired straight to `attemptReveal`, so naming a country
 * from memory bought its own name and a perfect round scored double par. The
 * rules were right and the call site was not, which is exactly the kind of
 * mistake that needs a name and a test rather than a comment.
 */
import { attemptReveal, place, type GameState, type Outcome } from './rules'

export type Source =
  /** The player produced the name themselves. Always free. */
  | 'typed'
  /**
   * The player pointed at a shape on the globe. Free if they already have the
   * name; otherwise they are buying it.
   */
  | 'globe'
  /**
   * Nobody asked: the board drew level with a waypoint and it played itself.
   *
   * Free in the same way typing is — there is no name to buy, since a waypoint
   * is named from the opening move. It is still a placement and still a stroke;
   * what it saves is the typing, not the shot.
   */
  | 'arrival'

export function apply(state: GameState, code: string, source: Source): Outcome {
  return source === 'globe' ? attemptReveal(state, code) : place(state, code)
}
