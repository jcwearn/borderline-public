# Plan: Three more barriers, and a course to play them on

## Context

Borderline has one barrier: a closed country. It works, but it only ever does one thing —
it lengthens the single right answer. Every hole still asks *find the shortest route*, and
the player's only job is to find it. Nothing in the game yet asks **"is the short way
through worth what it costs?"** — there is no decision, only a search.

This plan adds barriers that do ask that, and then a place to play them.

- **The rough** — ground that costs an extra stroke to set foot in. The short way through
  and the long way round are both open, and only one of them is cheaper.
- **Doglegs** — a country the round must take in, wherever the route ends up going.
- **Out of bounds** — a whole region shut rather than a lone country.
- **Play conditions** — a reveal budget, so a hole can test recall directly rather than
  only through its price.

Then **the course**: 18 authored holes, a front nine that teaches one mechanic at a time
and a back nine that combines them, scored as one cumulative card against course par.

All of it reaches the daily, not only the course.

## What the measurements refuted

Three things that looked obvious were measured and turned out to be wrong. Each is the
reason a phase below is shaped the way it is.

**A single rough country is worth exactly one stroke, and never more.** Over all 9,848
connectable pairs, roughening one country on a cheapest route lengthened 7,637 of them —
and the gain histogram is `[[1, 7637]]`. Every single one gained exactly one. That is
forced rather than incidental: you can always still walk through the rough for +1, so no
lone rough country can cost more than that. **A tradeoff between going through and going
round is unreachable with a one-country rough.** Rough has to be a region, which is why
Phase 2 exists and why rough shares its data layer with out of bounds.

**Rough makes cost directional, and that is the real reason no endpoint may be rough.**
`cost(u → v)` charges the premium on arriving at `v`, so `d(a,b) − d(b,a) = rough(b) −
rough(a)`. With clean endpoints, cost was symmetric in 1,754 of 1,754 trials; with a rough
endpoint, 1,336 of 1,429 pairs disagreed depending on direction. `pickPuzzle` runs half the
pool's pairs backwards on a coin, so a rough endpoint would give **one pool entry two
different `best` values**. Sharper than "closures do it too", and it is what
`graph.test.ts`'s symmetry pair now pins.

**Copying the hazard rule for doglegs puts every dogleg in `hard`.** Hazard gains are
bounded by topology, so "largest gain wins" lands anywhere. Dogleg gains are unbounded up
to `MAX_BEST`, so largest-gain saturates at 10 every time: 9,135 eligible pairs, **0 easy,
0 medium, 9,135 hard**. Monday and Tuesday would never see one — the same failure the
hazard work hit on short pairs, in reverse. Taking the *smallest positive* gain instead
gives 1,799 / 3,181 / 4,155.

## Decisions taken

| | |
|---|---|
| **Rough is marked, not named** | A distinct stroke on the globe; the shape stays anonymous until placed or bought. The rule that forced naming on closures — *an unnamed shape you cannot play is a trap* — does not transfer, because rough **is** playable. The player gets the cost without the name, and reveals keep their value. |
| **A shut region is drawn, not listed** | A contiguous grey sunken mass explains itself. Naming eight closures would refund eight reveals and turn the banner into a paragraph. Closures stay named at or below `NAMED_CLOSURE_LIMIT`; above it the region draws unnamed. An explicit rule, tested — not a size heuristic. |
| **No fail state, ever** | Conditions are restrictions: a reveal budget runs out and the globe stops selling names. `GameState.status` stays `'playing' \| 'won'`. In golf you do not fail a hole, and a hole you can fail has no number to put in the box — which a cumulative card cannot survive. |
| **Neither an endpoint nor a waypoint may be rough** | The endpoint rule is the directionality finding above. The waypoint rule keeps `steiner` honest: no leg charges its own terminal, which is only sound because no terminal is a country the player pays for. |
| **Regions are curated, not generated** | Auto-generated seed-and-neighbour rough blobs were eligible on 7,889 pairs but produced a genuine tradeoff on only 1,820 (23%). Three quarters would be decoration wearing a mechanic's clothes. Hand-maintained in `data/regions.json` with a required `basis` per region, exactly as `data/sea-links.json` is — and then the UI can *say* "Central Asia is rough today" instead of greying eight anonymous shapes. |

## The arithmetic that everything rests on

The existing identity is `best = cheapestRouteCost − 1`, asserted in three places that must
agree (`scripts/build-data.ts`, `src/game/freeplay.ts`, `src/daily-client.ts`). Both new
mechanics preserve it.

**Rough.** The premium is charged on *entering*, so a route with `k` intermediates, `s` sea
legs and `r` rough intermediates costs `(k + 1) + s + r`, and `best = k + s + r` — exactly
what a flawless round scores once `scorecard` counts rough countries **placed**. Simulating
the perfect player over 1,754 rough rounds confirmed `placed + crossings·(SEA_COST−1) +
roughPlaced === best` in every one.

`roughPlaced` counts placements where `crossings` counts the board, and the asymmetry is
real rather than an oversight: a crossing is charged to a *link*, and the closing leg into
the far endpoint is never a placement, so counting it from placements would let it through
free. The rough is charged to a *country*, and since no endpoint is rough, every rough
country on any route is one the player placed.

**Doglegs are a Steiner tree, not two shortest paths.** The player only has to get the
waypoint onto the board, so the cheapest satisfying placement is a minimum three-terminal
tree — three legs meeting at one country, minimised over every country as the meeting point:

```
best = min over hubs h of [ d(s,h) + d(e,h) + d(X,h) − 2·premium(h) ] − 1
```

Taking `h = X` recovers `d(s,X) + d(X,e) − 1`, which is therefore an over-estimate — and
measured against this graph it over-states on **84%** of waypoints, sometimes by nine
countries. The direction is the dangerous part: an over-stated `best` ships not an
impossible par but a wildly generous one, and `HISTOGRAM_MIN` exists precisely because "the
allowance puts a hard floor under how far below par a round can land".

The `− 2·premium(h)` is not a fudge: rough is charged on arrival, so each of the three legs
pays the hub's premium where the player pays it once. Without it the formula is wrong on
about one hole in eighty with rough in play. `graph.test.ts` checks `steiner` against an
independently-costed exhaustive tree, with and without rough, which is the only way anyone
would ever notice.

The consequence is that `isWon` gains exactly one conjunct — every required country is in
play — and **`solutionPath` needs no change**. A waypoint the final route does not use is a
paid detour, which is the bargain the rest of the scoring already makes.

## Where the mechanics land

- **Weights reach the search layer by a parameter, not by subtraction.** `within`
  *subtracts* and `rough` *prices*; additive cost cannot be said by subtraction. Only calls
  that measure a price get it — `isWon` asks about reachability alone and must not, since
  rough is finite and cannot make a route stop existing.
- **Rough is not a `Role`.** `Role` is one-of and answers "what is this country to the
  round"; a country can be rough *and* placed, or rough *and* an available move. It rides
  the `polygonStrokeColor` channel `GlobeView` already sets per polygon, leaving `FILL` and
  `LIFT` keyed by `Role` as they are. A **waypoint**, by contrast, genuinely is a `Role` —
  like `start` and `end` it is what the country is to the round, and like `closed` it is
  named from the opening move.
- **The wire format gains a sentinel byte.** `LINK_CODES` holds 165 entries, so bytes
  165–255 decode to `undefined` and `decodeRecipe` already returns null for them. A leading
  `0xFF` is therefore a version marker no existing link can collide with by construction,
  not by convention. An unknown tag is a hard `null`, never a skip: a link describing a
  round this build cannot play must not quietly play a *different* one.
- **The rules modal stays three steps.** The round contributes at most one extra step,
  chosen by priority, so it never grows past four.

## The pool

`functions/data/pairs.json` is 14,484 entries, 266 KB raw and 52 KB gzipped. With all four
variants it goes to 31,508 entries — 613 KB raw, **122 KB gzipped** in the split-by-variant
format, which is 4% of the Free Workers ceiling, and `JSON.parse` of it measures 10.8 ms
against a 1 s startup budget. **Bundle size is not the constraint and must not drive the
format.**

Validation time is. `data.test.ts`'s independent search costs 0.09 ms per open entry and
0.33 ms per dogleg, so the sweep goes from ~1.3 s to ~5.3 s and `npm test` from 7 s to
about 11 s. That is the price, and it is worth paying: this is the check that stops an
unsolvable daily shipping, and it is deliberately not the algorithm it is checking.

Sampling the pool down was considered and rejected. It buys bytes, which are not scarce,
and costs the ability to assert that every difficulty holds every mechanic — which is
exactly the guarantee the dogleg finding above exists to make failable.

## Phases

Each phase ships on its own. The ordering rule: the search-layer change ships **alone**,
before anything depends on it; then each mechanic is proven end to end in **free play**,
where being wrong costs nothing; and only then does the daily pool — the irreversible part
— learn about any of it.

### Phase 1 — Terrain through the search layer. A pure refactor. **complete**
`rough` threaded through `search`/`costsFrom`/`distance`/`shortestPath` and `cost`;
`ROUGH_COST`; `steiner` with the hub correction. Nothing sets a rough set yet.
**Acceptance:** `npm test` green with no existing expectation changed; `npm run build:data`
byte-identical; `steiner` agrees with an independently-costed exhaustive tree with and
without rough, and reduces to `distance` on two terminals.

### Phase 2 — Regions, as data
`data/regions.json`, hand-written, a required `basis` per region; the build validates
connectivity and membership and emits `src/data/regions.json`. Nothing reads it yet.
**Acceptance:** generated data still byte-identical; every region connected in the graph and
naming only countries the graph holds.

### Phase 3 — The rough, end to end, free play only
`Puzzle.rough`, `newGame`'s refusals, `roughPlaced`, `scorecard`, the stroke channel, the
builder's rough slot, `?g=` v2, `HowToPlay`, the share card. The daily is untouched.
**Acceptance:** a test plays the perfect line on a rough round and asserts
`scorecard(state).score === puzzle.best` — the identity as a number, not a comment. Every
link in a pinned table of v1 strings decodes to the identical recipe. A rough hole where one
line is strictly better is not a tradeoff, so both lines are asserted to cost more than
`best`.

### Phase 4 — Out of bounds — **complete**
`NAMED_CLOSURE_LIMIT`, the unnamed-region drawing, the banner copy, a region slot in the
builder. `Puzzle.closed` is already a list, so the engine is untouched.
**Acceptance:** a closure of three or more draws unnamed and leaks no label, checked against
every country the way role order already is. *Also fixed a bug older than this plan:
pressing a shut country recorded a miss, so two presses on the one shape that says outright
it cannot be played cost a stroke.*

### Phase 5 — Doglegs, end to end, free play only
`Puzzle.required`, `isWon`'s conjunct, `Role: 'required'`, `detours` excluding required, the
share grid's third square, the builder slot, the `?g=` tag.
**Acceptance:** a perfect dogleg round scores exactly `best` **and** its grid contains no
🟨. `isWon` is false with both ends joined and the waypoint absent, true the move it lands.

### Phase 6 — The daily learns all four. The irreversible one. **complete**
Shipped in two parts, and the ordering was the point.

**6a — the record.** Regenerating the pool reshuffles every date, because the index is
`digest mod pool[difficulty].length` over an array in file order. Only the two or three
dates `isPlausibleToday` admits can ever be asked for, so only those can be observed to
move: `scripts/pin-served.ts` asks the live site what it is serving and writes
`functions/data/served.json`, which `pickPuzzle` reads before the pool. It asks rather
than recomputing because `PUZZLE_SALT` is a Cloudflare secret and cannot be read back.
Shipped with the pool untouched, so its acceptance test was that *nothing changed*.

**6b — the pool.** Split by **combination of barriers** rather than by single variant,
because a day may carry two. Nine combinations, 50,092 holes, 225 KB gzipped. `ROTATION`
beside `BY_WEEKDAY`; `assertPlayable` recomputing `best` via `steiner`; `SEA_COST` and
`ROUGH_COST` collapsed into `src/game/terrain.ts` and the pool's wire format into
`src/game/pool.ts`.
**Acceptance met:** the broken generator was built and watched to fail — largest-gain
doglegs emptied the easy bucket exactly as measured, and a corrupted `best` was caught by
`pool.test.ts`. `npm test` 8.6 s. Every bucket holds every combination the rotation can
ask it for.

Two findings changed the phase's shape from what was planned here:

- **No doubled hole can be easy, and that is structural.** `easy` is exactly `best === 3`,
  a barrier only enters the pool if it lengthens the route, so two of them need an open
  route of one or two countries to land back on three — and a waypoint may not border an
  endpoint. Measured: zero, across the whole map. Monday and Tuesday carry one barrier or
  none, and the build asserts the rest.
- **Rough needed a rule of its own, and it is not the closure rule.** Measured over all
  5,665 eligible pairs: taking the largest gain forces the player into the rough on 63% of
  holes, which makes it a surcharge rather than a decision. Taking the *biggest bite that
  still leaves a live way round* — the largest gain among regions the route can dodge for a
  stroke or less — drops that to 49% while keeping the bite. All three candidate rules
  bucket identically, so unlike the dogleg finding this was a choice about feel, not safety.

### Phase 7 — Play conditions
`Conditions`, the reveal budget, `Outcome['reason']` gaining `'no-reveals'`, the hold ring's
counter.
**Acceptance:** a round with no budget left never sells a name **and never records a miss
for trying** — refusing to sell is not a wrong guess. `scorecard` output is identical for
any puzzle without conditions.

### Phase 8 — The course
`data/course.json` + build validation, `src/game/course.ts`, `CourseSelect`, `CourseCard`,
a second game slot in `storage.ts`, `isDaily` replacing the overloaded `free` boolean, the
`Entry` union, the course share card, analytics, and `public/privacy.html` — which must stay
true whenever anything new is recorded.
**Acceptance:** the build fails on a hole whose authored par is below its computed `best`;
**playing the entire course leaves the daily's saved game and the record untouched**, which
is what `isDaily` exists for.

## Deferred, deliberately

- **`ALLOWANCE` will need retuning** once holes stack mechanics, and it lives in
  `difficulty.ts` precisely so that is a one-line PR with no data rebuild. Ship the
  mechanics, watch the real distribution, then retune. A decision, not an oversight.
- **`SEA_COST` is stated in three places and `ROUGH_COST` will make it six.** Collapse both
  into an import-free leaf beside `difficulty.ts` when `build-data.ts` first needs
  `ROUGH_COST` — Phase 6 — rather than speculatively now.
