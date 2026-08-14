# Progress: one explanation per mechanic, from one table

## Current Status: Complete

| Phase | Status | Updated | Notes |
| --- | --- | --- | --- |
| 1. The pure half — `barriersIn` | Complete | 2026-08-12 | `src/game/mechanics.ts` |
| 2. The copy, in one place | Complete | 2026-08-12 | `src/components/mechanics.tsx` |
| 3. The queue | Complete | 2026-08-12 | `MechanicNotice`, `explaining` in `App.tsx` |
| 4. CLAUDE.md | Complete | 2026-08-12 | Generalised in place |
| 5. Tests | Complete | 2026-08-12 | `mechanics.test.ts`, `storage.test.ts` |

Scoped and designed on 2026-08-12, then tabled; built the same day on
`feat/mechanic-notices`, stacked on the plan's own branch.

## What already exists

The dogleg half of this shipped in **PR #45** (`feat/dogleg-through-route`), alongside
the through-route rewrite:

- `src/components/DoglegNotice.tsx` — the modal this generalises.
- `src/storage.ts` — `type Mechanic = 'dogleg'`, `mechanicsSeen: string[]`,
  `mechanicSeen` / `markMechanicSeen`. **The stored shape needs no migration**: it is
  already a list of names, and a record written before the field existed, or one whose
  value is not an array, both read as empty. Covered in `storage.test.ts`.
- `src/App.tsx` — `begin(next, rulesComing)`, the single `showDoglegNotice` boolean, and
  `captureTyping`. The `rulesComing` argument exists because free play calls `begin` too
  and never raises the rules card.

So phase 1 is a type widening plus a classifier, not new machinery.

## What was built, and where it differs from the plan

Four things came out other than as written. None changes the design.

- **2,326, not 1,462.** The count of `bounds`-filed holes that are named one by one has
  moved with a pool rebuild since the plan was written. The rule is unchanged; the
  number in `CLAUDE.md` is the measured one.
- **`Copy` has no separate `figure` slot.** The dogleg's rail fragment sits *between* its
  two paragraphs, so a prose-then-figure order could not hold it verbatim, and verbatim
  was the point. `body` is one slot holding prose and picture both.
- **`Copy` has no `eyebrow` either.** "This hole is different" is a fact about the round
  and identical for all four; the queue owns it, along with "One more thing" for the
  second. Putting it in the table would have been four copies of one string.
- **The queue keeps its cursor inside its own state** (`{queue, at}`) rather than
  shifting the array. The eyebrow reads the position, and `explaining.length` against
  `barriers.length` gets it wrong on a doubled hole whose first barrier was already
  known — the second is still the first thing shown.
- **The rules card now reaches free play, and `rulesComing` is gone.** Asked for after
  the rest had landed, and it undoes an asymmetry rather than adding one: the rules were
  raised only by the daily, so somebody whose first Borderline was a shared link got no
  rules then — and none later either, since the daily only offers them to a player who
  has never seen them. All three ways into a round go through `begin`, so `begin` decides.
  One word follows: the card says "This round" rather than "Today" on a free one, which
  is neither the daily nor necessarily from today. The builder is the one thing it cannot
  precede, since the card names the endpoints and par and there is no round until Play.
- **A first visit raises nothing**, where `plan.md` contradicted itself. Its phase-3
  snippet queued `present.filter(m => !covered.includes(m) && !mechanicSeen(m))`, which
  on a doubled hole puts the second barrier's modal up *alongside* the rules card — and
  since the notice renders later in the tree, straight over it. Its own prose two
  paragraphs down says the opposite and is the one that was followed: "mark seen exactly
  what the card shows, drop the rest without marking", left for the next round carrying
  it. The puppeteer pass caught this; it was written as the plan had it and was wrong.

The rename was committed on its own, content untouched, because rewriting the file in
the same commit put the similarity below git's threshold and `git log --follow` stopped
at the rename. It now reaches back to the through-route work.

## Decisions taken, not to be revisited

Settled with the user before tabling: queue both modals on a doubled hole; modal copy
stays generic and never names today's region; one shared table drives both the modal and
the rules card; the rules card still shows at most one step 4. The reasoning for each is
in `plan.md` under *Decisions already taken*.

## Loose ends found while scoping — all fixed

Three pieces of stale copy, all of them the drift this plan exists to stop.

- `HowToPlay.tsx`'s rough step says the rough is "outlined in ochre and standing proud
  of the map". It has **no lift** — deliberately — and the outline is dark warm brown.
- The comment above that same block says "the rough goes first because it is the newer
  thing". The code checks `via &&` first: the dogleg was inserted above the rough and
  the comment was never updated.
- `.chip.rough` in `App.css` is commented "the same ochre the globe outlines the rough
  in". It is gold `#d6ad5e` against the globe's `rgba(122, 84, 52, 0.95)`.
- Two `App.css` comments have drifted onto the wrong rules; the ochre one sits above
  `.chip.required`.

The rough's step now reads "hatched and outlined in warm brown"; the ordering comment
names `MECHANICS`; and the `.chip.rough` comment is back above `.chip.rough` and says
why the chip's gold and the globe's brown are deliberately different colours.

And one real latent bug, which phase 1 removed as a side effect:

- `App.tsx` formats the closed list with `join(' and ')`; `HowToPlay` uses its own
  `list()` helper. **They diverge at three names** and agree today only because
  `NAMED_CLOSURE_LIMIT` is 2. Returning the label from `barriersIn` kills it.

Plus one imprecision, which passes today and would not if the pool changed:

- `daily.test.ts:378-389` calls `closed.length > 1` "a region out of bounds". The real
  predicate is `!closuresAreNamed(puzzle)`, i.e. more than `NAMED_CLOSURE_LIMIT` (2).
  The pool only ever shuts one country for a `closed` hole, so the two agree by
  accident rather than by rule.

And one bug in what already shipped, fixed by phase 3's `won` guard:

- A round resumed **already won** raised the dogleg notice *and* `setShowResult(true)`.
  `ResultModal` renders later in the tree so it painted on top, and the notice was found
  underneath it after the card was dismissed. With four mechanics that would have got
  four times likelier.

## Left behind, then fixed: the banners collided on a `rough+dogleg` hole

Turned up while reading `App.css` for this work and left alone at the time, since it is
a layout change and the layout suite did not cover the banners. Fixed on 2026-08-12 in
`fix/notice-stack`.

`.closed-notice.via` and `.closed-notice.rough` were both hard-positioned at `top: 3rem`
(`src/App.css`), on the assumption that a round has at most one of them plus a closure.
`rough+dogleg` is a real combo in the pool, and on those days the two pills were drawn
exactly on top of each other. The comment above them — "when a round has both, the rough
sits under the closure rather than beside it: two pills side by side on a phone is wider
than the screen" — was right about the constraint and wrong about which pairs occur.

**Not the third tier this section used to prescribe.** A third `top` would have fixed
that pair and left two things standing, both found while scoping the fix:

- **Three pills are reachable.** `closed` and `bounds` are mutually exclusive, so the
  pool's doubling can only ever raise two — but a `?free=` link or the builder can carry
  a closure, rough and a waypoint at once, and then a fourth tier would be wanted.
- **The fixed tops were already wrong on a phone with no collision at all.** Under 720px
  a pill may wrap, and a wrapped first pill runs straight through whatever is pinned
  2.25rem below it. That is `closed+rough` — a combo that has been in the pool the whole
  time — not a hypothetical.

So the pills went into flow instead: one absolutely-positioned `.notice-stack` at the
top of the stage, a flex column, and the pills static inside it. No conditional class is
needed after all, since nothing has to know what else is up; the four literal blocks in
`App.tsx` stay literal, and their DOM order is the reading order, so every pairing that
rendered before renders unchanged.

`e2e/notice-stack.test.ts` covers it, with the opening lifted out of
`mobile-layout.test.ts` into `e2e/phone.ts` so both files share one `openPhone`. It
loads `?free=FRA-TUR&closed=BIH,MKD&rough=ROU,HUN,SVK,UKR&via=SRB` — three pills, the
closure wrapping to two lines — and asserts no two rects intersect and that the gaps
between them are equal. Put the old `top`s back and it fails on three overlapping pairs.
Note the waypoint: **`via=GRC` is refused on a `FRA-TUR` round**, as the tables in
`plan.md` had it, because a waypoint bordering an end would open with the bend half made.

## Not in scope

- **No analytics.** There is no barrier-naming prop anywhere today — `roundProps` sends
  counts only. If it is ever wanted, one event with a `mechanic` prop across all four
  beats one per barrier, and `public/privacy.html` has to change with it.
- **No component tests.** `vitest.config.ts` is `environment: 'node'` with an `include`
  of `*.test.ts`; jsdom and testing-library are dependencies, and adding one needs
  asking. The modals get checked with puppeteer instead.
- **No data rebuild.** Nothing here touches `pairs.json`, so none of the pinning ritual
  in CLAUDE.md applies.
