# Plan: one explanation per mechanic, from one table

## Context

The dogleg has a one-time modal — `src/components/DoglegNotice.tsx`, remembered as
`mechanicsSeen` in `src/storage.ts` — shown the first time a player is actually handed
one. The other three barriers do not, and they have exactly the problem it was built to
solve: the rules card is shown **once ever, on a first visit**, so somebody who started
in March and meets their first out-of-bounds region in June gets four seconds of banner
and a grey shape.

The banners are thinner than they look. Measured against what the rules card says, each
one leaves out the part that costs strokes:

| banner | says | leaves out |
| --- | --- | --- |
| `⛔ Chad closed today` | which country | **no route may pass through** |
| `⛔ The Maghreb is out of bounds today` | which region | the same |
| `⛰ The Maghreb is rough today — costs two to cross` | which region, the price | **going round may be cheaper** |
| `⛳ Your route has to run through the marked country` | that there is one | in one border and out another; that it is unnamed |

The second half of the job is the more important one: **the rules and the modals must
not drift.** They already have. Everything below was found while scoping, and all of it
is the same failure — the same fact written down twice and maintained once:

- `HowToPlay`'s rough step says the rough is "outlined in ochre and standing proud of
  the map". It has **no lift at all** — deliberately, and `GlobeView.tsx` carries the
  comment explaining that raising it was tried and reverted — and the outline is dark
  warm brown `rgba(122, 84, 52, 0.95)`, not ochre.
- The comment above that same step-4 block says "the rough goes first because it is the
  newer thing". The code checks `via &&` first; the dogleg was inserted above the rough
  and the comment was never updated.
- `.chip.rough` in `App.css` is commented "the same ochre the globe outlines the rough
  in". It is gold `#d6ad5e`. It has never matched.
- Two `App.css` comments have drifted onto the wrong rules — the ochre one sits above
  `.chip.required`.
- `App.tsx` formats the closed list with `join(' and ')` while `HowToPlay` uses its own
  `list()` helper. **They diverge at three names** and agree today only because
  `NAMED_CLOSURE_LIMIT` is 2. A latent bug, not a style difference.

So the fix is not a doc note alone. It is **one table per mechanic that both the rules
card and the modal read**, so that adding a mechanic is a compile error until every
piece of copy exists — with the CLAUDE.md note on top of it.

Doubled holes are **~19% of days** (`ROTATION`: easy none, medium 20/100, hard 35/100).
The queue is roughly one day a week, not a corner case.

## Decisions already taken

Settled with the user before this was tabled. Do not re-litigate:

1. **Queue on a doubled hole.** A round carrying two barriers neither of which has been
   explained shows one modal, then the second on dismiss.
2. **Modal copy is generic**, never naming today's region. The banner behind it already
   does, and it stays up while a modal is open (nothing arms its timer until the player
   acts), so the two are read back to back. It also keeps the copy a lookup table rather
   than a set of sentences with holes in.
3. **One shared table** drives both the modal copy and the rules card's step 4.
4. The rules card still shows **at most one** step 4, in its existing priority order
   (`dogleg > rough > bounds > closed`). Only the source of the line changes.

## The thing most likely to be got wrong

`barriersIn` must classify by **how the round is presented, not by which combo built
it**, and the distinction is not pedantic.

`bounds` is `closed.length > 0 && !closuresAreNamed(puzzle)`, and `closuresAreNamed` is
`length <= NAMED_CLOSURE_LIMIT`, which is 2. Two of the twelve regions are exactly two
countries — the Iberian Peninsula, and the Anatolian and Iranian highlands — so
**1,462 holes filed under `bounds` in the committed pool are named one by one**: the
banner reads "Türkiye and Iran closed today", not "the highlands are out of bounds".
Those rounds must get the *closure* explanation, because a closure is what the player is
looking at.

Deriving this from `Combo` in `src/game/pool.ts` would explain a mechanic the round is
not showing. `Combo` is in any case **discarded before the puzzle reaches the client** —
`pickPuzzle` emits only the three optional fields — so the classifier has to go from
`Puzzle` back to a barrier set on its own.

Two consequences: `closuresAreNamed` returns `true` for *zero* closures, so the length
check is load-bearing; and `daily.test.ts:378-389`, which calls `closed.length > 1` "a
region out of bounds", is imprecise rather than broken — the pool only ever shuts one
country for `closed`, so it passes today. Tighten it to the real predicate while here.

## Phases

### Phase 1: The pure half

**`src/game/mechanics.ts`** (new). No React — `src/game/` is free of it by rule, and
`rules.ts`'s header says so. Not `presentation.ts`, whose header is "What the globe is
allowed to show" and which is about roles and terrain; not `pool.ts`, which is
deliberately import-free so the build script can typecheck it under Node resolution,
and this needs `closuresAreNamed` from `rules.ts`.

```ts
export type Mechanic = 'dogleg' | 'rough' | 'bounds' | 'closed'

/**
 * Priority order, stated once and meant three times: which barrier the rules
 * card's fourth step is about, which modal a doubled hole shows first, and
 * which one the card is taken to have covered on a first visit.
 */
export const MECHANICS: readonly Mechanic[] = ['dogleg', 'rough', 'bounds', 'closed']

export type Barrier = {
  mechanic: Mechanic
  /** Today's instance, named. Null on a dogleg, which is never named. */
  label: string | null
}

/** Which barriers this round carries, in `MECHANICS` order. */
export function barriersIn(puzzle: Puzzle): Barrier[]
```

**Return the label with the mechanic, not a separate `labelOf`.** Labels are the other
half of the drift being fixed — the `join(' and ')` / `list()` divergence above — and
one function kills it. With two functions, `labelOf(puzzle, 'closed')` on a bounds day
returns `null` and "null" then means two different things ("not in this round" and
"never named"). One function, and the ambiguity cannot be expressed.

Internals are three private `Record<Mechanic, …>` tables — `CARRIES`, `LABEL` — so a
fifth mechanic is a compile error here before the copy is even reached. Iterate
`MECHANICS`, never `Object.keys`, so the order is the declaration.

**`src/storage.ts`** — delete the local `Mechanic`, `import type { Mechanic } from
'./game/mechanics'`, shorten the doc comment to point at the new module. Under
`verbatimModuleSyntax` the type import is erased, so storage gains no runtime dependency
on the graph. Nothing under `src/game/` imports `storage`, so there is no cycle. The
stored shape needs no migration.

**Acceptance**: `barriersIn` covers all four in priority order, labels included, and a
two-country region shut comes back `closed`.

### Phase 2: The copy, in one place

**`src/components/mechanics.tsx`** (new) — the half that cannot live in `src/game/`
because it is JSX. **One table with the step beside the modal copy**, not two parallel
records:

```tsx
type Copy = {
  /** The dialog's accessible name. */
  label: string
  eyebrow: string
  title: string
  body: ReactNode
  /** A picture, only where a picture says it better than the sentence does. */
  figure?: ReactNode
  /** The rules card's fourth step. Takes today's name, where there is one. */
  step: (label: string) => ReactNode
}
export const MECHANIC_COPY: Record<Mechanic, Copy>
```

Two `Record<Mechanic, …>` would enforce exhaustiveness equally, but adjacency is what
keeps the *voice* matched — adding a mechanic becomes one contiguous block in one diff
rather than two blocks that slowly stop sounding like each other. That is the real
failure mode; the compiler was never going to catch it.

`noUnusedParameters` is on in `tsconfig.app.json`, so the dogleg's `step: () => (…)` is
enforced rather than merely conventional. Callers pass `barrier.label ?? ''`.

Copy, drawing on the reviewed step-4 wording and **fixing the falsehoods**:

- **rough** — title "Some ground costs double to cross." Outlined in ochre and
  **hatched** (not "standing proud"); every country in it costs two instead of one, so
  the short way through and the long way round are both open and only one is cheaper.
- **bounds** — "A whole region is out today." Greyed and sunk; nothing may be played
  there *and no route may pass through*. Its own words rather than the closure's:
  `regions.ts` says outright that "a closed border is a country you cannot enter, and
  out of bounds is a part of the world the round has been ruled off — the two are
  different mechanics rather than the same one at two sizes."
- **closed** — "A border is shut today." Same two clauses. **Reword the step to drop the
  copula** ("Nothing may be played in {label}, and no route may pass through…") — that
  is what lets `step` take one pre-joined string instead of `string[]` plus an
  `is`/`are` agreement.
- **dogleg** — moved in verbatim, rail fragment and all. A diff that changes a word of
  it is a diff to question.

**Figures: rough only.** The rough's entire tell is a texture, and a modal that says
"hatched" without showing it sends the player hunting. `closed`/`bounds` get none — a
flat grey square says "grey", and grey was never the part anybody misunderstands; the
clause that changes behaviour is "no route may pass through", and that is prose.

The rough swatch must be honest: `roughFill.ts` multiplies the role's fill by
`BAND = rgb(122, 84, 52)` at `DUTY = 0.42` with edge `STROKE_ROUGH =
rgba(122, 84, 52, 0.95)`, so
`repeating-linear-gradient(45deg, rgba(122,84,52,.9) 0 3px, transparent 3px 7px)` over
`rgba(58,70,112,.85)` (the `unknown` fill) with that border is the same two colours in
the same proportion. Quote `BAND`/`DUTY`/`STROKE_ROUGH` in the CSS comment so the two
can be checked against each other later. A plain ochre square would repeat the mistake
this phase exists to fix.

It slots into `.notice-how` unchanged — already a flex row with a fixed leading item
(`.notice-ring`), so `.notice-swatch` needs no new layout.

**Acceptance**: adding a name to `Mechanic` fails `tsc` in the copy table.

### Phase 3: The queue

**`src/components/MechanicNotice.tsx`** — git-rename from `DoglegNotice.tsx` so
`git log --follow` keeps the reasoning. ~30 lines:

```tsx
export default function MechanicNotice({
  mechanic,
  /** Whether anything preceded it this round. Only the eyebrow cares. */
  first,
  onDismiss,
}: { mechanic: Mechanic; first: boolean; onDismiss: () => void })
```

`first` is the one piece of copy belonging to the queue rather than the mechanic: on a
doubled hole both would otherwise open "This hole is different" twice, which reads as a
stutter. Second and later get "One more thing".

A third file rather than folding the table into this one, because otherwise
`HowToPlay.tsx` imports the rules card's copy *out of the notice component* — which
reads as an accident and is the invitation to drift being closed.

**`src/App.tsx`** — name the queue `explaining`; `notice` is taken by the banner's
state machine.

```ts
const present = barriersIn(next.puzzle).map((b) => b.mechanic)
// The rules card shows at most one fourth step: the first in `MECHANICS`
// order. Whatever it says is read; whatever it does not say is left for the
// next round that carries it, rather than stacked behind the card or quietly
// marked read.
const covered = rulesComing ? present.slice(0, 1) : []
covered.forEach(markMechanicSeen)
// A resumed round that is already scored is an atlas. The result card is
// going up over it and a rule nobody can still use is noise.
setExplaining(
  next.status === 'won' ? [] : present.filter((m) => !covered.includes(m) && !mechanicSeen(m)),
)
```

**The `rulesComing` asymmetry is the subtle part**, and the answer is neither of the two
obvious ones. Marking *everything present* as seen writes a lie into storage — the
player is recorded as having read something nobody showed them. Queueing the rest
*behind* the card paints a second modal on top of the first-visit card (both are
`.modal-backdrop` at the same z-index and the notice renders later in the tree), and
gating on `!showHowToPlay` just makes it three modals on a first round. So: **mark seen
exactly what the card shows, drop the rest without marking.** On a single-barrier day
this is byte-identical to what shipped.

Dismissal marks as it advances — not up front — which is what makes the queue survive a
reload: dismiss the first, reload, and `begin` recomputes the queue as exactly the
second. Keep `markMechanicSeen` out of the `setState` updater; StrictMode double-invokes
updaters.

Render with `key={explaining[0]}` so the second remounts rather than swapping text
inside a reused node. `captureTyping` becomes `!showHowToPlay && !showRevealNotice &&
explaining.length === 0 && !building` — consider hoisting a `modalUp` const, the
expression is now four terms.

**Two things that look like they need special-casing and do not.** *Resume mid-round*:
the notice comes back up, which is correct — it is dismissed once, not shown once.
*A round you built yourself*: `playFree` calls `begin`, so building a rough round can
raise the rough notice. Mildly redundant, but picking a field labelled "Rough" is not
being told it costs two, and it is once ever.

**Banner labels** come from `barriers` (`labelOf('closed')` is now a string, not an
array), but **leave the four literal `<p className="closed-notice">` blocks alone.** A
`barriers.map(...)` loop would flip them: `.closed-notice.via` and `.closed-notice.rough`
are hard-positioned at `top: 3rem` as the *second* pill, while `MECHANICS` order puts
dogleg and rough *first*. Generalising the banners is a layout change, the layout suite
does not cover them, and it is not what this task is for.

**`HowToPlay.tsx`** — props collapse from `closed/bounds/rough/via` to
`barrier: Barrier | null`; the four nested guards become one block rendering
`MECHANIC_COPY[barrier.mechanic].step(barrier.label ?? '')`; `list()` goes; the stale
"the rough goes first" comment is replaced by one stating the real order and pointing at
`MECHANICS`.

**Acceptance**: a doubled hole with clean storage shows two modals in sequence and
stores both names.

### Phase 4: CLAUDE.md

Generalise the existing `DoglegNotice` paragraph in *Running it* rather than adding a
second one beside it:

> Every barrier gets a one-time modal of its own, the first time a player is actually
> handed one — `mechanicsSeen` in `src/storage.ts`, a list rather than a flag apiece, so
> a fifth barrier is a new name in it instead of a stored-shape change. Which barriers a
> round carries, in what order, and what today's instance of each is called is
> `barriersIn` in `src/game/mechanics.ts`: it is where a closure and a whole region out
> of bounds are told apart, since they are the same payload field with
> `NAMED_CLOSURE_LIMIT` between them. The copy for all four is one table in
> `src/components/mechanics.tsx`, and **that table feeds both the modal and the rules
> card's fourth step, so adding a `Mechanic` is a type error until every line of copy
> exists**. Do not add a barrier, or change what one does, without going through it —
> the rules card is the only place most players ever read a rule, and the two used to be
> able to drift because they were written twice. They did: the rough's step said it
> stood proud of the map when it has never had any lift.
>
> The modals are deliberately not the rules: those are shown once ever, on a first
> visit, while every barrier turns up weekly. **`begin` takes the rules card to have
> covered whatever comes first in `MECHANICS` order and raises modals only for the
> rest** — the card shows at most one fourth step, so on a doubled hole it does not
> cover both, and what it did not say is left for the next round that carries it rather
> than stacked behind the card or quietly marked read. That is what the `rulesComing`
> argument is for, since free play calls `begin` too and never raises the rules.

### Phase 5: Tests

There is **no React component test infrastructure**: `vitest.config.ts` is
`environment: 'node'` and its `include` is `src/**/*.test.ts`, so a `.tsx` test is not
even collected — which is the point of the split. Adding jsdom is a dependency; ask
first. All judgement lives in the pure module.

**`src/game/mechanics.test.ts`** (new):

- The `closed`/`bounds` boundary both ways: one closure and two are `closed` (with a
  comment that two is `NAMED_CLOSURE_LIMIT` and not a coincidence), three is `bounds`.
  Write one of them *derived* from `NAMED_CLOSURE_LIMIT` and `+ 1`, so retuning the limit
  moves the test with it rather than leaving literals to disagree.
- Never both `closed` and `bounds`, over closure lists of length 0…6.
- **A two-country region shut is `closed`, not `bounds`** — pinned against the real pool,
  since 1,462 committed holes are that case. The obvious test to write instead — "every
  `Combo` maps to the mechanics its name claims" — is exactly wrong here: it would pass
  only if the modal explained a mechanic the round is not showing.
- A hole carrying none is `[]`, including the explicit `{closed: [], rough: [],
  required: []}` shape that a decoded link can produce.
- All four real doubled combos, asserting *order*, plus one built with the fields
  written in the opposite key order, to prove the order is `MECHANICS`' and not the
  object's.
- Pool agreement, both directions in one assertion — a combo naming a barrier with no
  copy, and a mechanic the pool can never produce:
  `expect([...new Set(COMBOS.flatMap((c) => (c === 'open' ? [] : c.split('+'))))].sort())
  .toEqual([...MECHANICS].sort())`
- Labels: closed one and two; bounds as an exact region; bounds as a set that is
  *nearly* a region (falls through to "5 countries" — `regionOf` is deliberately exact);
  rough as a region; rough as a single country (its name, not "1 countries"); and
  **dogleg is `null`**, with a comment that it is null by design, not by absence.

**`src/storage.test.ts`** — parameterise the two existing dogleg-only tests over
`MECHANICS`, so a fifth mechanic shows up here for free. Add: each mechanic is its own
record; they accumulate in the order marked; and **a name from a later build survives a
downgrade** (seed `{ mechanicsSeen: ['sandtrap'] }`, mark `'rough'`, assert both are
stored). That last one is already true, and the doc comment on `mechanicsSeen` promises
it in prose — a promise with no test is the one that breaks.

**Puppeteer**, one-off from the scratchpad and **not committed** (`headless: 'shell'`,
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`). Free play reaches
every barrier without the deployed API:

| what | URL |
| --- | --- |
| rough | `?free=FRA-TUR&rough=ROU,HUN,SVK,UKR` (The Carpathians) |
| closed | `?free=FRA-TUR&closed=ITA` |
| bounds | `?free=FRA-TUR&closed=MAR,DZA,TUN,LBY` (The Maghreb, four > the limit) |
| dogleg | `?free=FRA-TUR&via=GRC` |
| doubled | `?free=FRA-TUR&closed=ITA&via=GRC` |
| two-country region | `?free=AFG-ARM&closed=TUR,IRN` — must raise **closed**, not bounds |

Assert, with `howToPlaySeen: true` seeded: one modal per single-barrier link with the
right `aria-label`; the doubled link shows dogleg first, then closed with the eyebrow
reading "One more thing"; **reload mid-queue** shows exactly the second; all four seen
means no modal anywhere; a cleared-storage daily shows the rules card with exactly one
step 4 and *nothing* over or behind it; typing is captured only once the queue is empty;
and at 390px wide each modal fits without pushing the button off-screen. Screenshot the
rough figure beside the globe's real hatch and look at them together — that is what the
software context is for.

**`e2e/mobile-layout.test.ts`** loads `?free=FRA-TUR`, which carries no barriers, so
nothing breaks. Its comment says "Both one-time explainers", which is now wrong; update
the wording and seed `mechanicsSeen` with all four so that anyone who later changes that
URL to a barrier round does not get a modal over the footer the suite measures.

## Implementation order

1. `src/game/mechanics.ts` — types, `MECHANICS`, `barriersIn`, private tables.
2. `src/game/mechanics.test.ts` — green before any component moves.
3. `src/storage.ts` — import the type, shorten the comment.
4. `src/storage.test.ts` — parameterise over `MECHANICS`, add the three cases.
5. `src/components/mechanics.tsx` — the copy table; dogleg moved verbatim, three new,
   the two falsehoods fixed.
6. `src/components/MechanicNotice.tsx` — git-rename of `DoglegNotice.tsx`.
7. `src/App.css` — `.notice-swatch` and `.notice-swatch.rough`, quoting the shader's
   numbers in the comment.
8. `src/components/HowToPlay.tsx` — one step-4 block, drop `list()`, fix the comment.
9. `src/App.tsx` — `barriers` memo, `explaining` queue, `covered`/`won` logic,
   `dismissNotice`, `captureTyping`, banner labels. Banner JSX untouched.
10. `CLAUDE.md`, then verify.

## Verification

```
npm run format:check && npm run lint && npm run typecheck
npm test && npm run test:layout && npm run build
npx wrangler@3.114.17 pages functions build --outdir=/tmp/fn
```

Then the puppeteer pass above, since nothing in that list renders a modal.

## No data rebuild

Nothing here touches `functions/data/pairs.json` or the wire format, so none of the
pinning ritual in CLAUDE.md applies.
