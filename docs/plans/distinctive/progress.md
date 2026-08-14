# Progress: Make Borderline stop asking Travle's question

## Current Status: In Progress

| Phase | Status | Updated | Notes |
|-------|--------|---------|-------|
| 1. Par you can beat | Complete | 2026-08-10 | `best` + allowance shipped; 270 tests green; data unchanged |
| 2. Hazards | Complete | 2026-08-10 | Closed borders shipped; pool 5,704 → 11,008 entries; 293 tests green |
| 3. Weighted search | Complete | 2026-08-10 | Dijkstra behind unchanged signatures; no existing test touched |
| 4. Sea crossings | Complete | 2026-08-10 | 14 crossings, one world of 161; zero existing holes moved |

## Handoff Notes

**Phase 4 is done, and the trade-off the plan agonised over turned out to be false.**
The plan framed it as *one world and Cuba* versus *a provably untouched mainland*. Those
are not in tension: each island is its own land component, so Cuba can carry three
crossings without creating a cycle. The list is a forest over the landmasses **and**
gives one world of 161. Verified rather than argued — regenerating the pool moved zero of
the 11,008 existing holes and dropped none, and `data.test.ts` now asserts that count.

- **The forest property is the whole safety argument.** No landmass gets a second berth,
  so every crossing is a bridge, so none can offer a second route between two countries
  already joined, so no existing route can shorten. The build asserts it directly and
  names the offending link if it ever breaks. An earlier draft of the list gave the
  Bahamas a second berth and stranded the Caribbean; that is the failure mode.
- **`SEA_COST = 2` is duplicated** in `src/game/graph.ts` and `scripts/build-data.ts`, and
  a third time as a constant in `src/data/data.test.ts`. They must agree or the pool's
  par is not the par a player can reach. Worth collapsing if a shared module ever exists.
- **The scoring identity:** a route with `k` intermediates and `s` crossings costs
  `k + 1 + s`, so `score = cost - 1` exactly as before and `best` needs no special case.
  `crossings()` counts links with **both ends in play**, not legs of the finished route —
  the closing leg into the far endpoint is never a placement, so a placement-time charge
  would let it through free, and a route-time charge would leave the running score wrong
  all round.
- **Fiji, New Zealand, Solomon Islands and Vanuatu are still unplayable** and the build
  asserts exactly those four by name, so a crossing that accidentally reaches one fails
  loudly rather than silently changing the game.
- **Crossings are drawn between the centres of the regions they serve** — Chukotka to
  Alaska, Hauts-de-France to South East England — hand-placed in `data/sea-links.json` and
  shipped as `src/data/crossings.json`. This is the second attempt: country centroids ran
  Bering 9,007 km from Siberia to Kansas, and the two capes themselves are only 82 km apart
  and disappeared at any sensible zoom. The middle of the right region is 1,548 km, points
  at the right place, and can actually be seen. The build asserts every crossing is drawn
  shorter than its centroid line and under 2,000 km, and that neither end is nearer the far
  country than its own.
- **`npm test` takes about seven seconds, up from one.** Almost all of it is
  `data.test.ts` checking all 14,484 pool entries against an independent relax-until-stable
  search — 6,437 of them with a closure applied, so each is its own graph and none of the
  work is reusable. Caching the open half was tried and gained nothing measurable, so it
  was removed. Worth the wall clock: this is the check that stops an unsolvable daily
  shipping, and it is deliberately not the algorithm it is checking.
- **They arc above the globe, and this was tried both ways.** Drawn flat on the water
  (great-circle points at altitude 0.002) they were much harder to pick out, so the lift
  came back. The lift keeps a floor rather than scaling purely by length, so the shortest
  crossings do not sit flat against the globe. They are **finely dotted** and still:
  animated they were distracting, and at the first dash settings (0.5 length, 0.22 gap) a
  short crossing came out as a single stub and a gap that read as a rendering fault. Dash
  lengths are fractions of the arc, so 0.035/0.015 gives every crossing the same twenty-odd
  dots however long it is.
- **Only the crossings that could bear on the round are drawn.** `crossingMatters` in
  `presentation.ts`. This is exact, not a heuristic, and it falls straight out of the forest
  property: every crossing is a bridge, so a simple route uses one precisely when the two
  endpoints sit on opposite sides of it — crossing and coming back would mean using the same
  link twice. So Denmark–Iceland appears only when the round starts or ends in Iceland, and
  Bering only when the round actually changes hemisphere. A crossing already touching the
  board is drawn too, since it explains the stroke it cost. Note this correctly hides Bering
  for a Brazil→Cuba round, where "is either endpoint an island" would have got it wrong.
- **They can also be turned off entirely**, from the top bar, remembered in `borderline:v1`
  under `crossings`. Default on and it has to stay that way — they are how anyone learns crossings
  exist at all — but most rounds never touch one, so standing arcs over an unrelated puzzle
  are just clutter. `HowToPlay` names the mechanic too, since with the arcs hidden it is
  otherwise undiscoverable.
- **Greenland stays inert, and this was decided rather than defaulted.** It is
  `unMember: false` — an autonomous country inside the Kingdom of Denmark with no UN seat —
  so the membership filter drops it, and it draws as terrain alongside Western Sahara,
  Palestine, Taiwan, Puerto Rico, the Falklands, New Caledonia, the French Southern
  Territories and Antarctica. It is much the largest of the nine and leaves a visible gap
  beside Canada.

  The considered alternative was mapping its polygon to Denmark and adding a Denmark–Canada
  crossing over the Nares Strait — legally accurate, about 26 km, and Hans Island has been a
  shared land border since 2022. Measured rather than assumed: **all 5,704 original land-only
  holes stay exactly the same length**, and 54 cross-world holes get shorter and more
  sensible (France → Canada 6 → 4, instead of going round Siberia). So the real costs are
  narrower than they first look — the forest property drops from a guarantee to an empirical
  check, clicking Greenland would say "Denmark", and Denmark's label would sit in Europe
  while its territory is lit in the Arctic. Declined on those grounds; the numbers are here
  so it does not have to be re-derived.
- **The arcs are load-bearing, not decoration.** The globe draws no other edges because a
  land border is visible from orbit; a crossing is not. Without them nobody can know Japan
  is reachable from South Korea and the mechanic reads as a bug.
- **`data/sea-links.json` carries a required `basis` per link** — the justification *is*
  the inclusion rule, and the build rejects an empty one. Three links are honestly marked
  `dormant` (Cuba–Mexico, Cuba–Jamaica, Madagascar–Mozambique): real crossings with no
  scheduled service today. Bering is a `strait` with no service at all, included
  deliberately because it is the single link that makes the Americas reachable.
- **Cyprus–Türkiye was a deliberate choice**, not an oversight: it is the only reliable
  year-round service to the island, and it lands in Northern Cyprus. Cyprus–Greece is the
  neutral alternative and has been intermittent for decades. The reasoning is recorded in
  the link's own `basis` field.

**Phase 2 is done.** A daily may now shut one country: unplayable, drawn red and sunk on
the globe, named from the opening move, and excluded from every route. `pairs.json` grew
from 5,704 to 11,008 entries (205 KB, server-only) because a hazarded pair is a separate
hole, bucketed by how it actually plays rather than by its open route.

Things worth knowing before touching it:

- **`isWon`, `solutionPath`, `sides` and `detours` were not changed and must not be.** They
  search with `within: inPlay(state)`, and a closed country can never enter `inPlay`, so
  they exclude it for free. Only `isLegal`, `validNextMoves`, `why`, `newGame` and
  `stepsFromBoard` needed anything.
- **`closed` outranks `available` in `roleResolver`.** If that order is ever reversed a
  hazard adjacent to the board lights up as a legal move and the mechanic silently stops
  existing. `presentation.test.ts` checks it against every country in the graph.
- **A closure counts as named**, which is why pressing one is a plain miss rather than the
  double charge a failed reveal carries.
- **Short pairs are eligible for a hazard even though they are not puzzles open.** The easy
  bucket is the single route length 3, so without this it could never hold a hazard and
  Monday and Tuesday would never see one. That is where the easy 28% comes from.
- **`functions/api/daily.test.ts` no longer asserts an exact key set against today's
  puzzle.** `closed` is only present on a hazard day, so the old test would have passed on
  the day it was written and failed on some later Tuesday. It now walks 30 pinned dates and
  requires both shapes to occur.
- Hazard selection takes the **largest** gain that keeps the route length in range, tie-broken
  by code. Closures that sever the route are rejected in the build and again in `newGame`.

Spot-checked against the live API: `2026-08-15` is North Macedonia → Vietnam with **China**
shut, which turns a 5-country route through Russia into a 7-country route across Türkiye,
Iran, Pakistan, India, Myanmar and Laos. That is the mechanic doing exactly what it was
added to do.

**Phase 1 is done and self-contained.** `Puzzle` now carries both `best` (the shortest
route that exists — the old meaning of `par`) and `par` (`best` + allowance). The allowance
table lives in `src/game/daily.ts` beside `BY_WEEKDAY` rather than in the pool, so retuning
it needs no data rebuild. `npm run build:data` regenerates byte-identical output.

Things that moved and are easy to miss:

- **`graph.ts`'s `par()` was dead code** and is deleted. Nothing imported it.
- **`verdict()` was rewritten, not extended.** Its old reasoning ("countries can never be
  below par, so level par with a penalty is impossible") became false, and it would have
  printed *"Level par — the miss was free"* under a card showing four misses. It now reads
  `waste` (`score - best`) rather than `delta`, because "did you beat par" and "was
  anything wasted" came apart the moment par gained an allowance.
- **The histogram spans `-2 … +4` plus a `5+` tail**, eight rows where there were seven.
  Its old comment calling negative deltas corrupt data is now exactly backwards.
- **Stats gained a `version`.** A pre-v2 record keeps `rounds`, both streaks and
  `lastWonId` but loses `distribution`: those deltas were measured against the shortest
  route, and since the difficulty of a past round is not stored there is no honest way to
  convert them. The key stays `borderline:v1`.
- **`assertPlayable` now checks par against the graph** (`distance === best + 1`), which it
  never did before.

**Deliberate UI call worth revisiting:** the header shows par only, not `best`. Par is the
golf reference and the mobile header is already tight, but this does hide the floor that
the old "Par 9" implicitly showed. `HowToPlay` explains that par carries a shot in hand.

**Still not verified in a real browser.** `/api/daily` was confirmed by hand against
`npm run pages:dev` (day 2 returns `MNE → AZE`, `best 3`, `par 4` — Monday is an easy day),
but the Chrome extension was not connected, so nobody has yet seen a negative delta render
in the scorecard or the histogram draw eight rows. This compounds the pre-existing gap
noted in `docs/plans/borderline/progress.md`.

**Phase 2 next.** The hazard selection algorithm and its pool impact are already measured
against the committed data — see plan.md. Write the "solvable with the closure applied"
assertion in `daily.test.ts`'s 400-date sweep *first*, watch it fail against a deliberately
broken `hazardFor`, then implement; that sweep is the only thing standing between a bug
there and shipping an unsolvable daily.
