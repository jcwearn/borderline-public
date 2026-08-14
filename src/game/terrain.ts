/**
 * What the ground costs.
 *
 * Its own module, and deliberately a leaf with no imports, for the reason
 * `./difficulty` gives at length: the browser needs these, and so do
 * `scripts/build-data.ts` and `src/data/data.test.ts`, which are type-checked
 * under Node resolution and would drag the whole graph in behind any relative
 * import.
 *
 * They were stated in three places and were about to be stated in six, once the
 * pool learned about the rough. The pool is generated against these numbers and
 * the player is scored against them, so a disagreement does not surface as a
 * wrong answer — it surfaces as a par nobody can reach.
 *
 * `src/game/graph.ts` re-exports both, so the rest of the game goes on asking
 * the graph what things cost.
 */

/**
 * What a sea crossing costs against a land border's 1.
 *
 * The premium is the mechanic: without it a crossing is a free shortcut and
 * the Channel Tunnel quietly collapses half of Europe. With it, going for the
 * water is a decision you can get wrong.
 */
export const SEA_COST = 2

/**
 * What a country in the rough costs to enter, against open ground's 1.
 *
 * A premium on the *country* rather than on the link, which is what makes it a
 * different question from a sea crossing: water is a way in that costs more,
 * rough is a place that costs more however you arrive. Charged on entering, so
 * a route's cost stays `countries + premiums` and `best = cost - 1` survives
 * untouched — see `scorecard`. That identity is why no endpoint may be rough:
 * the far end is never a placement, so its premium would land in the cost and
 * never in the score.
 */
export const ROUGH_COST = 2
