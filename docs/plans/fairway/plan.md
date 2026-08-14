# Plan: Fairway days

## Context

The rough and out-of-bounds mechanics are curated regions that happen to sit between the
endpoints — true to the map, not to golf. A fairway day carves the world into three: a
**fairway** (the corridor the route is meant to run through), a **rough margin** flanking
it (existing rough, +1 on arrival), and **everything else on Earth out of bounds**
(existing closed). No new rules semantics — closed and rough behave exactly as today,
composed at scale. Two hand-built references exist as `?g=` links: ZAF→CIV up the west
coast of Africa, and ESP→TKM along the southern route into Central Asia.

Decisions made up front: generation is algorithmic and measured (distributions before
parameters); frequency is hard days plus a touch of medium, roughly weekly overall, never
easy; presentation is a fifth `Mechanic`, `'fairway'`, replacing the tonally wrong
"140 countries are out of bounds today" pill stack; scope includes compact share links
and free-play builder support.

Design skeleton (details in each phase):

- **No `Puzzle` schema change.** A fairway day is served as `closed` (the complement,
  sorted) + `rough` (the margin, sorted). Classification follows the
  `LONE_CLOSURE_LIMIT` precedent: `FAIRWAY_LIMIT` + `fairwayRound()` in `rules.ts`.
- **Carving**: `slack(v) = d(start,v) + d(v,end) - d(start,end)` over the build's OPEN
  table. Either every country with slack ≤ F is fairway ("slack" mode), or exactly one
  canonical shortest path is ("spine" mode) — measured against each other in Phase 1.
  Rough is slack ≤ R beyond that; everything else, including unreachable ground, is
  closed. Endpoints and the whole shortest route have slack 0, so the floor never moves —
  which inverts the build's bite assertion for this combo.
- **Pool**: new `Combo` `'fairway'`, no doubles. `pool.test.ts` requires >50 entries per
  combo in medium and hard, so the mechanic code and the regenerated pool land together.
- **Rotation**: new weights on medium and hard only; pool must exceed 5× annual draws.

## Phases

### Phase 1: Measurement
- `scripts/measure-fairways.ts` — stdout-only; carves every eligible pair (open best
  4–10) under slack F ∈ {0,1,2} × margin R and spine × R, reports size distributions,
  pool sizes against both rotation proposals' floors, byte growth under both storage
  shapes, and ZAF→CIV against the hand-built reference.
- Files involved: `scripts/measure-fairways.ts`, `docs/plans/fairway/*`
- Acceptance: script runs clean; Jackson picks carving mode, (F, R), quality filter,
  rotation split, and pool storage/cap from the numbers.

### Phase 2: Mechanic + pool (one PR; pin:served dance)
- `fairwayFor` in `scripts/build-data.ts` + verification (bite inversion, shape asserts);
  `Combo`/`TAIL` in `src/game/pool.ts`; `FAIRWAY_LIMIT`/`fairwayRound` in
  `src/game/rules.ts`; `Mechanic`/`MECHANICS`/`CARRIES`/`LABEL` in
  `src/game/mechanics.ts`; copy in `src/components/mechanics.tsx`; pill in `src/App.tsx`
  + `src/App.css`. Regenerated `pairs.json` (pin while old pool is live; commit
  `served.json` + `pairs.json` together; merge promptly). Check the wrangler-3 functions
  build size.
- Acceptance: hand-built `?free=` fairway links classify as fairway and show the new
  pill; full battery green; globe eyeballed headful.

### Phase 3: Compact share links
- Tag 4 (complement) in `src/freeplay-url.ts`; share.test gains a fairway configuration.
- Acceptance: round-trips both forms; four pinned real links decode unchanged.

### Phase 4: Serve it
- `ROTATION` weights in `src/game/daily.ts` per the checkpoint decision; daily.test
  updates. No pairs.json change, no pin dance.
- Acceptance: a preview date under `ALLOW_DATE_OVERRIDE` serves a fairway day.

### Phase 6: Bent corridors
- The straight pool was samey — Russia on 39% of corridors, Israel 39%, Egypt 38%,
  because a fairway that must follow the shortest route follows the planet's three land
  bridges. Rework: a course may bend through a waypoint (the closure moves the floor,
  like bounds), corridors keep tied strands, and the pool is a water-filled 800-hole
  selection that spreads corridors across the map (worst trunk ~22%). Straight courses
  remain as the bend-0 case of the same carve.
- Files involved: `scripts/measure-bent-fairways.ts`, `scripts/build-data.ts`,
  `functions/data/pairs.json`, `src/data/pool.test.ts`, `src/game/daily.test.ts`
- Acceptance: build verification green with the bite rule relaxed to a bound
  (open floor ≤ carved floor); fairway pool exactly 800, floors met; battery green.

### Phase 5: Builder
- `fairway` slot + `deriveFairway` in `src/game/freeplay.ts`; corridor authoring in
  `src/components/FreePlay.tsx`; draft preview through App.
- Acceptance: painting a corridor previews and plays; degenerate corridors refuse
  legibly.
