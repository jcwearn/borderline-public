# Progress: Fairway days

## Current Status: In Review — PR #54 carries the whole feature (the #55–#59 stack merged into it); review fixes applied 2026-08-13. Re-run pin:served right before it lands.

| Phase | Status | Updated | Notes |
|-------|--------|---------|-------|
| 1. Measurement | Complete | 2026-08-12 | Script in PR #54; parameters chosen at checkpoint |
| 2. Mechanic + pool | In Review | 2026-08-12 | PR #55. Pool holds fairway: medium 2,193 / hard 3,138; pairs.json +0.87 MB. Re-run pin:served right before merge. |
| 3. Compact share links | In Review | 2026-08-12 | PR #56, stacked on #55. Tag 4 = open-ground complement. |
| 4. Serve it | In Review | 2026-08-12 | PR #57, stacked on #56. Rotation: hard 30 / medium 12. |
| 5. Builder | In Review | 2026-08-12 | PR #58, stacked on #57. Paint the corridor; band and closure derived. |
| 6. Bent corridors | In Review | 2026-08-12 | PR #59, stacked on #58. Courses bend through a via; rough never carries the carved board's shortest route (shortcut repair + pinned invariant); no two courses share >60% of their fairway; trunk cap 100. Pool: 385 (medium 173 / hard 212), worst trunk 26% vs the straight pool's 39% Russia. Merge #57 only after this. |

| 7. Review fixes | Complete | 2026-08-13 | Ten findings from the PR #54 review. Below. |

## Review fixes, 2026-08-13

Applied to the branch, in the order they matter:

- **Fairway + Via was unbuildable at all.** The carve swallowed the waypoint into band
  or closure, both of which the rules refuse a waypoint in, so *every* such draft
  errored while the panel went on offering the field. `deriveFairway` now holds
  `required` open as course ground.
- **`pin:served` re-run**, which added 2026-08-14 — the reachable date the rebuilt
  `pairs.json` would have moved under anyone playing it. Run it again right before merge.
- **A bandless wide closure is no longer called a course.** `fairwayRound` requires
  rough, because the mechanic's copy asserts a band in three places.
- **Reopening a course in the builder** recovers the corridor where the carve
  round-trips (226 of 385 committed courses; the repaired ones cannot, by design), and
  collapses the rest to one chip a field instead of ~145.
- **The corridor previews from the first tap**, before both ends exist, via `previewOf`
  — which is also now the only fairway compile outside `recipeOfDraft`.
- **A link filling one field twice is refused**, `closed` against `open` especially:
  last-wins decided whether ~130 countries were shut or open.
- Duplication: one `carvedSearch` in `build-data.ts` replaces two Dijkstras and a
  hand-rolled re-pricing (verified a no-op — the rebuilt `pairs.json` is byte-identical);
  `complementOf` is shared with the URL decoder; `assign` refuses picks aimed at derived
  fields rather than leaving the rule to a component effect.

Not done: `scripts/measure-bent-fairways.ts` still copies the band derivation rather
than importing `deriveFairway`. Importing it pulls `freeplay.ts` → `rules.ts` into the
Node project, where `nodenext` demands explicit extensions on every transitive import —
a cascade across `src/game` for a script that is explicitly a historical record.

## Handoff Notes

Phase 1's script measures two carving modes: `slack` (every country within F of optimal
is fairway — keeps every tied route, so ZAF→CIV holds both coasts of Africa) and `spine`
(one canonical shortest path is the fairway; other near-optimal ground is rough — this
reproduces the hand-built ZAF→CIV west-coast round almost exactly, fairway
`AGO BEN BFA CIV CMR COG NAM NGA ZAF` at SPINE R=1).

Headline numbers: pools are far above the rotation floors in every sensible
configuration (thousands of holes vs floors of ~208 hard / ~55–94 medium). The binding
constraint is `pairs.json` growth: filing every viable pair adds ~4–6.6 MB storing the
closed list, ~0.7–2.2 MB storing the fairway+rough complement instead. A deterministic
cap (e.g. ~500 per difficulty) plus complement storage brings it to ~150 KB — but
complement storage in the pool means the closed list is derived at serve time, which
`daily.ts` would need a code list for (it is deliberately graph-free today). Decision
pending at the checkpoint, along with carving mode, (F, R), and the quality filter.

Checkpoint decisions, made 2026-08-12 from the measurements:

- **Carving: spine.** The fairway is one canonical shortest path; other near-optimal
  ground is rough. Reproduces the hand-built ZAF→CIV west-coast round.
- **Rough margin: R=1**, with the tight quality filter (rough ≥ 8, closed ≥ 110).
  Pools: medium 2,193 / hard 3,138 — floors are >94 / >156.
- **Rotation (Phase 4): hard 30 / medium 12** — ~31 + ~19 fairway days a year.
- **Pool storage: complement.** Entries carry fairway + rough; the closed list is
  derived (all codes minus both) at decode time in `pool.ts`, which stays graph-free by
  importing the code list from `link-codes.ts` (a leaf). Uncapped: ~+0.9 MB. All lists
  canonically sorted, because the share invariant is deep equality including order.
