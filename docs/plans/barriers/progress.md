# Progress: Three more barriers, and a course to play them on

## Current Status: In Progress

| Phase | Status | Updated | Notes |
|-------|--------|---------|-------|
| 1. Terrain through the search layer | Complete | 2026-08-11 | `rough` threaded, `steiner` landed; data byte-identical (#31) |
| 2. Regions, as data | Complete | 2026-08-11 | 12 curated regions, each measured to bite (#32) |
| 3. The rough, free play only | Complete | 2026-08-11 | Hatched in the shader; `?g=` v2 (#33) |
| 4. Out of bounds | Complete | 2026-08-11 | Named below 3, drawn as a place above (#34) |
| 5. Doglegs, free play only | Complete | 2026-08-11 | `steiner` in use; the rail is a chain (#35) |
| 6a. The record of what was served | Complete | 2026-08-11 | Salt-free pin from the live site (#38) |
| 6b. The daily learns all four | Complete | 2026-08-11 | 9 combinations, 50,092 holes (#39) |
| 7. Play conditions | Not Started | — | Start here |
| 8. The course | Not Started | — | — |

**The daily now serves all four barriers, and up to two at once.** 597 tests green,
`npm test` 8.6 s on a quiet machine, the Function bundle 239 KB gzipped against a 1 MB
ceiling.

`src/data/pool.test.ts` carries an explicit 30 s timeout on its heavy tests. The work is
bounded and known — fifty thousand independent re-searches, worst single test about a
second and a half — but vitest's default ceiling is five seconds and CI has two cores,
which is near enough that a loaded runner would fail on the clock rather than on anything
being wrong. It is not covering for a slow test; it is refusing to let timing be the
thing that decides.

## Pick up here

Phase 7 is play conditions: `Conditions`, the reveal budget, `Outcome['reason']` gaining
`'no-reveals'`, the hold ring's counter. Nothing in phase 6 constrains it.

**Before touching the pool again, read *Rebuilding the pool* in `CLAUDE.md`.** The rule
is not "pin before you build" — it is "pin while the old pool is still live", and the two
come apart because the reachable window moves through the day. Run `npm run pin:served`
last, immediately before merging, however many times it has already run.

That mechanism has now been proved in production rather than only in tests: the pool went
from 14,484 entries to 50,092, every date's index moved, and 2026-08-11 and 2026-08-12
came back from the live API byte-for-byte what they were.

## What phase 6 actually did

### The record (6a)

Which puzzle a date gets is `digest mod pool[difficulty].length` over an array in file
order, so any change to the pool reshuffles every date. The fix is a record of what went
out, not a cleverer index — the pool *is* the index and no arrangement of it is stable.

- **Only two or three dates can ever be asked for.** `?date=` is gated on a flag
  production does not carry (verified: it 403s), and `isPlausibleToday` bounds `?d=` to
  the dates somewhere on Earth is currently on. Everything older is unreachable by
  construction, so the record stays a handful of entries rather than growing with the
  calendar.
- **Puzzle #1 is not in it and cannot be.** `2026-08-10` had already fallen outside the
  window when this was written — the live site refuses it and answers with today. Beyond
  reach, and therefore beyond harm.
- **It asks the site rather than recomputing.** `PUZZLE_SALT` is a Cloudflare secret and
  secrets cannot be read back. The salt in `.dev.vars` is a *development* one and answers
  a different question: it gives 2026-08-11 as `DNK → KAZ` where production served
  `TJK → ARM`. Anyone who tries to recompute the record locally will produce a plausible
  and completely wrong file.
- Re-running is idempotent and re-verifies: a day already recorded that the site now
  serves differently fails the script loudly.

### The pool (6b)

`pairs.json` is `{difficulty: {combo: entries}}` — 50,092 holes over nine combinations,
1.5 MB raw and 225 KB gzipped. An entry is a tuple whose tail the combo explains; `TAIL`
in `src/game/pool.ts` is the wire format and position means nothing without it.

```
open              8047   easy   975 · medium  3330 · hard  3742
closed            6437   easy   325 · medium  1689 · hard  4423
bounds            4389   easy    86 · medium   922 · hard  3381
rough             5665   easy   233 · medium  1799 · hard  3633
dogleg            9135   easy  1784 · medium  3196 · hard  4155
closed+rough      3865   easy     0 · medium   604 · hard  3261
closed+dogleg     4938   easy     0 · medium  1329 · hard  3609
rough+dogleg      4507   easy     0 · medium  1349 · hard  3158
bounds+dogleg     3109   easy     0 · medium   616 · hard  2493
```

- **`open` and `closed` come out at exactly 8,047 and 6,437** — precisely the 14,484 the
  pool held before any of this. The rules that built them did not change, so the counts
  did not either, and `pool.test.ts` asserts both numbers. That is the strongest available
  evidence the rewrite moved nothing it did not mean to.
- **Objects were tried and rejected.** The same holes written as `{s, e, b, closed}` run to
  about four megabytes; the key naming which lists an entry carries is not worth repeating
  fifty thousand times when the combination it is filed under already says.
- **Rough ships as an inline country list, not a region index.** An index would be smaller
  and would add a second append-only ordering to maintain beside `LINK_CODES`. `regionOf`
  already recovers the name from an exact set, which is what it was written for.

## Standing decisions from phase 6, and why

- **No doubled hole can be easy, and that is the map's doing rather than a policy.** `easy`
  is exactly `best === 3`; a barrier only earns a pool entry if it lengthens the route, so
  two of them need an open route of one or two countries to land back on three — and a
  waypoint may not border an endpoint. Zero exist across the whole map. The build asserts
  every combination is present *except* doubles under easy, and `daily.test.ts` checks the
  rotation never asks easy for one. Do not "fix" the empty buckets.
- **Rough takes the biggest bite that still leaves a live way round.** Not the closure
  rule. Measured over all 5,665 eligible pairs: largest-gain forces the player into the
  rough on 63% of holes, which is a surcharge; this rule drops that to 49% and keeps a
  gain of two or more on 32%. All three candidate rules bucket identically, so the
  difficulty spread was not the deciding factor — the feel of the hole was.
- **Doglegs take the smallest positive gain**, as measured before this phase. Copying the
  closure rule puts 9,135 of 9,135 in `hard`. This was rebuilt deliberately to watch it
  fail, and it failed exactly there: `easy holds no "dogleg" holes`.
- **A doubled hole picks its barriers in a fixed order** — shut ground, then rough, then
  the waypoint — each measured against the graph the earlier ones leave. Not cosmetic:
  closure-first yields 59 playable `closed+rough` holes per sample where rough-first yields
  40, because a closure has far more candidates to give up.
- **The combination is drawn from its own digest**, `${date}:combo`, like the reversing
  coin. Sharing the entry digest would tie the kind of hole to its position in the array,
  so a rare combination would always land on the same few holes.
- **The generator keeps its own search, and now a table as well.** `build-data.ts` cannot
  import `graph.ts` — that reads `src/data/graph.json`, which the script writes. Generation
  runs on 190 cached all-pairs tables of `Int16Array` (every single closure, every region
  shut, every region roughened), which is what makes the waypoint scan finish at all:
  asking pair by pair is millions of searches. `cheapest` stays the plain reading of the
  rules and validates what the tables produced. **They disagreed once, and the disagreement
  was real** — `roughFor` dropped the closure from the hole it returned, so `closed+rough`
  entries were written with an empty closure list and a `best` computed with it applied.
- **The rules modal still shows at most one extra step, by priority.** A doubled hole
  therefore explains only its highest-priority barrier there — but the board names both,
  which was checked by eye: *"Egypt closed today"* and *"The Caucasus is rough today"*
  stack, and the globe draws the grey and the hatch together.

## Verifying by eye

The Chrome extension was not connected, so both screenshots were taken with the
swiftshader recipe in `CLAUDE.md` against `wrangler pages dev`. Two links mirroring real
generated dailies, both of which loaded and drew correctly:

    ?g=_0ZXAQEsAgM2BQg   Iran -> Libya, Egypt shut and the Caucasus rough
    ?g=_4GHAQKXRgMBCg    Sudan -> Serbia, Türkiye and Iran out of bounds, via Belgium

45 consecutive days were also fetched over HTTP from `wrangler pages dev` and each
independently re-solved: every one winnable at exactly its stated par, all nine
combinations represented, no barrier ever on an endpoint, every rough set an exact
region.

## Deferred, still deliberately

- **`ALLOWANCE` has not been retuned**, and holes now stack mechanics, so the real
  distribution has moved. It lives in `difficulty.ts` precisely so this is a one-line PR
  with no data rebuild: ship, watch, then tune. `HISTOGRAM_MIN = -2` is coupled to
  `ALLOWANCE.hard = 2` and moves with it.
- **`ROTATION`'s weights are a first guess informed by pool counts**, not measured play.
  `bounds` is deliberately lighter than its siblings on easy, where only 86 holes exist —
  `daily.test.ts` asserts every combination has at least five holes per expected draw in a
  year, which is what stops a retuned weight quietly making Monday repeat itself.
