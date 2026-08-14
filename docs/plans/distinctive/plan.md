# Plan: Make Borderline stop asking Travle's question

## Context

Borderline shares Travle's premise — name countries forming a land route between two
points. The four things that differ today (unlabeled globe, both-ends building, paid
reveals, golf scoring) are all presentation and cost accounting: the underlying puzzle is
still *find the shortest land path*. Same question, better chrome.

Three structural weaknesses motivated this plan:

1. **Nobody could beat par.** `par = distance - 1` was the theoretical floor, so the best
   round anyone could play was `E`. Golf without birdies isn't golf — skill had no upside,
   only the absence of error.
2. **Exactly one right answer**, known in advance, with no tradeoff between options.
3. **Nineteen countries permanently benched** — the islanded components can never appear.

## Phases

### Phase 1: Par you can beat — **complete**
Split `Puzzle.par` into `best` (the floor) and `par` (`best` + a difficulty allowance:
easy +1, medium +1, hard +2). A flawless round now scores under par; a flawless hard round
is an eagle. Allowance lives in `src/game/daily.ts`, not the data, so it retunes without a
rebuild.

Files: `src/game/{daily,graph,rules,score,share}.ts`, `src/storage.ts`,
`src/daily-client.ts`, `src/components/HowToPlay.tsx`, `scripts/build-data.ts`.
Acceptance: a flawless medium round reads `-1`; the histogram spans `-2 … 5+`; a v1 stats
record keeps its streaks and loses only its distribution.

### Phase 2: Hazards — closed borders
Each daily closes one country: unplaceable, drawn as a hazard, excluded from pathfinding,
so the shortest path stops being the answer.

Build: for each pair take candidates where `d_start(x) + d_end(x) === D`, re-run BFS on the
graph minus `x`, and emit the closure with the largest gain as a second pool entry
re-bucketed by its effective `best`. Measured 5,050 of 5,704 pairs have a viable closure;
the pool grows to ~11,000 entries / ~209 KB, with hazard days at easy 28% / medium 38% /
hard 59%.

Rules: only `isLegal`, `validNextMoves`, `why`, `newGame` and `stepsFromBoard` change.
`isWon`, `solutionPath`, `sides` and `detours` need **no change** — they search with
`within: inPlay(state)`, and a closed country can never enter `inPlay`. Add a `without()`
helper to `graph.ts`; no signature changes.

The hazard is **named from the start** — a closed shape with no label is a trap rather
than a hazard, and it also avoids the double charge for revealing an unplaceable country.

### Phase 3: Weighted search — a pure refactor
Replace BFS with Dijkstra behind unchanged `distance`/`shortestPath` signatures, with
`cost()` returning 1 for now. Exists so Phase 4's correctness risk is isolated from its
data and UI risk. **Preserve the by-code tie-break**, or `solutionPath` → `detours` →
`shareGrid` all shift and the share card changes. Add `src/game/graph.test.ts`, which does
not exist today.

Acceptance: `npm test` green with zero changes to any existing test file.

### Phase 4: Sea crossings
With land = 1 and sea = 2, a route with `k` intermediates and `s` sea legs costs
`k + 1 + s`, so `score = cost - 1` exactly as today. Running score becomes
`placed + crossings + floor(misses/2) + reveals`, where `crossings` counts curated links
with both ends in play — which charges the closing leg a placement-time charge would miss.

`data/sea-links.json`, hand-maintained, with a required `basis` per link. `Country.sea`
stays separate from `borders` so `borders` keeps meaning land-only.

**Open decision.** A minimal list where every link touches an island and no land component
gets two berths forms a *forest* over the contracted components, which provably changes
zero existing pars (10 countries unlocked). Adding the Bering Strait and a two-berth
Caribbean gives one world of 161 but creates cycles, so existing pars can shift and buckets
need re-checking — and rests on weaker ground: there is no scheduled international
passenger ferry in the Greater Antilles, and none at all across Bering. Re-decide with
those numbers in hand. Assert whichever property the final list has.

**Biggest risk is invisibility**: the globe draws no edges, so a sea link is unreadable.
Draw crossings as dashed `arcsData` before building the scoring.
