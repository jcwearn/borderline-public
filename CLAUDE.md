# Borderline

A daily land-border puzzle: cross the world from one country to another, scored
like golf.

## Before committing

CI runs these in order and fails on the first one that complains, so run them
before pushing — `format:check` in particular, which is easy to forget and is the
usual reason a green-looking branch goes red:

```
npm run format      # prettier --write . — do this on every change you make
npm run lint        # oxlint
npm run typecheck   # tsc -b
npm test            # vitest run
npm run test:layout # vitest run --config vitest.layout.config.ts
npm run build
```

Prettier owns formatting; do not hand-format around it. `npm run format:check` is
what CI actually runs, so use it to confirm.

**Nothing in that list compiles the Pages Functions, and the Cloudflare build does.**
It bundles _everything_ under `functions/` — the tests too, which it never runs but does
compile — using its own wrangler 3, whose esbuild cannot parse import attributes. So
`with { type: 'json' }` is a build failure anywhere in that directory, while being
required everywhere else in the repo. Our own wrangler is v4 and parses it happily, so
neither `npm run build` nor `wrangler pages functions build` will show you this. To
reproduce what Cloudflare does:

```
npx wrangler@3.114.17 pages functions build --outdir=/tmp/fn
```

## Running it

`npm run dev` serves the app, but there is no local fallback for `/api/daily` — the
daily round only works against the deployed function. Any `?free=XXX-YYY` link is a
full game screen, globe included, and `?free=XXX-YYY&closed=ABC` shuts a border.
Endpoints need to be far enough apart to build a puzzle: `?free=FRA-TUR` works where
an adjacent pair does not.

That spelled-out form is for typing by hand, and is read but no longer written.
What the app puts in the address bar and on the share card is `?g=M5c` — the same
round as a country per byte, indexed into `src/link-codes.ts` and base64url'd,
which keeps a link from growing by four characters for every border shut. That
list is the wire format: append only, never reordered, or every link already
shared starts naming a different puzzle. `scripts/build-data.ts` fails the build
rather than let a data rebuild renumber it.

A round that puts ground in the rough or names somewhere it must run through needs more
than a country per byte, so `?g=` has a second version behind a sentinel: the
table holds 165 entries and is capped at 256, which makes `0xFF` a first byte no
existing link can have. After it come the two ends and then length-prefixed
sections — closed, rough, required. A round using none of those still encodes
exactly as it always did, so every link already shared stays short as well as
correct, and `freeplay-url.test.ts` pins four real ones by hand. An unknown
section is refused outright rather than skipped: a link from a later build
describes a round this one cannot play, and playing the part it understands would
quietly hand over a _different_ puzzle. The build asserts the table can never grow
into the sentinel. Spelled out these are `&rough=ITA,AUT` and `&via=GRC`.

**An attempt the board turns away is not a miss.** `Outcome` has carried the two apart
since the closure refusal — `reason` set, `miss: false`, state returned unchanged — and
two things now go through it: a shut country pressed on the globe, and any country
already in play, which is the two endpoints plus everything placed. Both used to cost
half a stroke apiece, so pressing one enough times moved the scorecard. The line this
stops at is a name bought off the globe that never went on the board: naming that again
is a fresh claim about a board that has grown since, and it still costs. Refusals reach
PostHog as `result: 'refused'`, told apart by `reason`, and are deliberately kept out of
`miss` so a mis-tap does not read as somebody wrong about the map.

**When the board opens, two countries on it have names: the two ends.** `isNamed` in
`src/game/rules.ts` is the whole of that list, and it is short on purpose — a name is
what the game charges for, so anything that hands one over for free is handing over the
round. A closure used to be named there, on the reasoning that a grey shape you cannot
identify is a trap; it is greyed and sunk, which is enough to route around, and the
other half of that reasoning (paying twice to discover it was shut) is closed by
`attemptReveal` refusing a shut shape outright rather than by the name. So the banner
counts what it cannot call a place — "2 countries are closed today" — and the builder
holds every pick but the two ends as an anonymous chip.

Every barrier gets a one-time modal of its own, `MechanicNotice`, the first time a
player is actually handed one — `mechanicsSeen` in `src/storage.ts`, a list rather than
a flag apiece, so a fifth barrier is a new name in it instead of a stored-shape change.
Which barriers a round carries, in what order, and what today's instance of each is
called is `barriersIn` in `src/game/mechanics.ts`: it is where a closure and a whole
region out of bounds are told apart, since they are the same payload field with
`LONE_CLOSURE_LIMIT` between them. **That line is not where the pool's own vocabulary
puts it.** Two of the curated regions are exactly two countries, so 2,326 committed
holes filed under `bounds` are two shut borders as far as the player can see, and get
the closure's explanation, because a closure is what they are looking at. They are still
named as the place they are — the mechanic and the label are two decisions, and only the
first of them turns on the limit. Classify off `Combo` and you explain a mechanic the
round is not showing; `Combo` is discarded before the puzzle reaches the browser anyway.

**A region is named where the round used a whole one, at any size** — "the Maghreb is
rough today" is a mechanic, and four hatched shapes with no name between them is a
puzzle about the interface. That is the line the anonymity stops at, and it holds
because a name for a place is not a name for the countries in it: down to the two
regions that hold exactly two countries, which is as close as a place name comes to
being a list of its members. `regionOf`'s exactness is the only bar, so a set that is
merely _nearly_ a region falls through to a count rather than being called something it
is not. `FreePlay.tsx` makes the same call for the same reason, since a chip is either a
place or a row of anonymous shapes.

`Barrier` carries a `plural` beside its label, because "2 countries is rough today" is
what happens otherwise. The sentences are JSX in four places and no node test can run
them, so the is/are agreement is decided in `barriersIn`, where one can. A region is one
place and can still take a plural verb — the Alps **are** rough today, the Maghreb is —
so three of the twelve names are listed in `regions.ts` as plural. Written out and not
guessed at: the tell anybody would reach for is a trailing s, and the Caucasus is in the
same list. It is deliberately not a field in `data/regions.json`, which is an input to
`build:data` — adding one there means regenerating `pairs.json` and reshuffling every
date over a fact about English.

The copy for all four is one table in `src/components/mechanics.tsx`, and **that table
feeds both the modal and the rules card's fourth step, so adding a `Mechanic` is a type
error until every line of copy exists**. Do not add a barrier, or change what one does,
without going through it — the rules card is the only place most players ever read a
rule, and the two used to be able to drift because they were written twice. They did:
the rough's step said it stood proud of the map when it has never had any lift, and
called its outline ochre when the globe draws warm brown. The rough's swatch in the
modal quotes `BAND`, `DUTY` and `STROKE_ROUGH` in its CSS comment for the same reason.

The modals are deliberately not the rules: those are shown once ever, on a first visit,
while every barrier turns up weekly. **A first visit raises no modal at all** — the
rules card is about to go up, a notice renders later in the tree than the card and would
paint straight over it, and gating on `!showHowToPlay` only makes that three modals
deep. `begin` instead takes the card to have covered whatever comes first in `MECHANICS`
order, marks exactly that one read, and leaves the rest **neither shown nor marked**: on
a doubled hole the card has room for one fourth step, and what it did not say waits for
the next round carrying it. Marking everything present would record that somebody read
something nobody showed them. After that first visit the queue runs normally, one modal
at a time, and dismissal marks as it advances rather than up front — which is what lets a
doubled hole survive being reloaded half-read.

**Which visit is the first is `begin`'s decision, not the caller's**, and that is a
change: the rules used to be raised only by the daily, so somebody whose first Borderline
was a link a friend sent got no rules then and none afterwards either, since the daily
only offers them to a player who has never seen them. Every way into a round goes through
`begin` — the daily, a `?free=` link, and the builder's Play button — so all three raise
the card now, and the `rulesComing` argument is gone. The card says "This round" instead
of "Today" on a free one, since it is neither the daily nor necessarily from today.
The builder is the one thing it cannot precede: there is no round to describe until Play,
and the card names the endpoints and par.

The `required` section is the one whose _length_ is now checked as well as its tag: a
round runs through exactly one country, and a link naming two is refused rather than
truncated to the first — same reasoning as the unknown section, since playing the first
of two would be playing a different puzzle. The format itself did not change, so every
single-waypoint link ever shared still decodes.

**A `Puzzle` becomes a `Recipe` through `recipeOfPuzzle`, and nowhere else.** The share
card used to assemble one itself out of `start`, `end` and `closed` — three of the five
fields — so a free round with rough in it or a dogleg shared a link that dropped them.
That is not a broken link: `best` and par come out of the barriers, so the recipient
loaded a different and easier puzzle with nothing to say so. The address bar was right
the whole time, which is what made it invisible. The invariant now stated in
`share.test.ts` is over the rebuilt `Puzzle` rather than over the bytes — every
combination of the three barriers, each chosen so it moves `best`.

The round turns over at the player's local midnight, so the browser sends its own
date as `/api/daily?d=YYYY-MM-DD`. The Worker honours it only for the two or three
dates somewhere on Earth is currently on and silently falls back to UTC otherwise —
so a date far from today reads as today's puzzle, not as an error. `?date=` is the
separate, unbounded development override, gated on `ALLOW_DATE_OVERRIDE`.

The pool is split by _combination of barriers_, not by difficulty alone:
`pairs.json` is `{difficulty: {combo: entries}}`, and an entry is a tuple whose tail
the combo explains — `TAIL` in `src/game/pool.ts` is the wire format, and position
means nothing without it. Ten combinations: up to two barriers at once, and the
fairway, which is enough of its own thing to get its own section below. The day picks
a combination first and a hole second, from two separate digests, which is what makes
barrier frequency a decision rather than an accident of pool composition; that table is
`ROTATION` in `src/game/daily.ts`, beside `ALLOWANCE` and retunable without a data
rebuild. **Easy holds no doubled hole and never will** — easy is exactly `best == 3`,
a barrier only enters the pool if it lengthens the route, so two of them cannot fit
underneath it. `bounds` shuts a whole region and `closed` shuts one country: same
payload field, different mechanics, counted and rationed apart.

Selection rules differ per barrier and each was measured. A closure or a region out of
bounds takes the largest gain. A **dogleg takes the smallest positive gain** — largest
gain is unbounded up to `MAX_BEST`, so it saturates and puts 9,135 of 9,135 waypoints
in `hard`, and Monday never sees one. **Rough takes the biggest bite that still leaves
a live way round**, because rough is a decision rather than a surcharge: of regions the
route can dodge for a stroke or less, the one that lengthens it most. For a doubled
hole the barriers are chosen in a fixed order — shut ground, then rough, then the
waypoint — which is not cosmetic: closure-first yields half again as many playable
`closed+rough` holes.

**A dogleg's floor is the cheapest route _through_ the waypoint**, and that sentence
used to read the other way. It was the cheapest Steiner _tree_ joining both ends and
the waypoint, on the reasoning that a player is asked to reach it rather than to route
through it — which is exactly what let the cheapest board hang the waypoint off the
side on a dead-end spur and run the route past it. So `d(start, via) + d(via, end)` has
flipped from an over-estimate of the floor (on 84% of waypoints) to a **lower bound**
on it, met on most and exceeded wherever the cheapest way in blocks the cheapest way
out. If you remember one thing about this mechanic, remember that the inequality points
the other way now.

It also means a waypoint has to have two usable borders — in one, out another. That is
not a separate rule anywhere in the code: `searchVia` returns `null`, and everything
refuses on it. Nineteen countries hold a single link and can never be a waypoint
(Portugal, Iceland, Lesotho, Canada, Japan and so on), as can nothing behind a cut
vertex relative to both ends.

The floor is a minimum-cost flow of value two, from the waypoint to a sink fed by both
ends, over the graph with every country split in half. **Three implementations of it
have to agree**, and each is checked by a different one: `viaCostOf` generates in
`scripts/build-data.ts` and `suurballe` re-derives every hole before anything is
written; `searchVia` in `src/game/graph.ts` is pinned against an exhaustive enumeration
of every simple path in `graph.test.ts`; and `pool.test.ts` holds a fourth against what
actually got committed. That is not belt and braces — `assertPlayable` recomputes the
floor in the browser and refuses the day if it disagrees, so a build whose arithmetic
drifts ships a daily nobody can load.

The scan is not 165 flows a pair. The bound above is two table reads, and the rule
wants the _smallest_ gain, so candidates are priced by the bound, walked cheapest-first
and cut off as soon as what remains cannot beat what has been found — 1.30 exact
evaluations per pair rather than ~150. The break has to compare the country code as
well as the cost and **must not compare it alone**: both forms agree on this graph,
which is what would make the tighter one a silent trap.

`npm run build:data` takes about a minute now — it got faster when the waypoint scan
stopped costing a 165-hub minimisation per candidate — and is byte-for-byte
reproducible.

## Fairway days

A fairway day is `closed` and `rough` composed at scale and nothing else: a corridor of
open ground between the two ends, a band of rough beside it, and the rest of the world —
~130 countries, the unreachable included — shut. No rule, score or search knows the word
"fairway"; the _classifier_ does, and it is one line up from the closure's:
`FAIRWAY_LIMIT` (40) in `src/game/rules.ts`, past which `barriersIn` stands the rough
and bounds pills down so one sentence speaks for the day. The dogleg deliberately does
not stand down — a waypoint is an ask on top of the course, not part of its shape.
**A band is part of that classification and not just something courses have**: the
pill, the modal and the rules card's fourth step all say the corridor runs between
rough and out of bounds, so a wide closure with nothing in the rough is not a course
being described tonally wrongly, it is copy saying something false — while standing
down the count that was true. Only a hand-built round can be shut that wide with no
band, and it reads as `bounds`.
Roughly fifty a year — 30 weight on hard, 12 on medium, never easy: a three-country hop
has no room to be a course, and the generator gates it rather than trusting the buckets.

**The rough is an option and never the answer.** `best` is the fairway's own floor with
the band shut too, and the generator's shortcut repair closes any band country a
cheaper-than-fairway route rides until that holds. This came from play, not caution: the
first bent courses drew the arc and left the direct line in the band at a stroke a
country, so the fairway was scenery and the optimal line cut through the rough. The
invariant is pinned twice — build verification and `pool.test.ts` both assert the
fairway-only floor equals `best + 1` on every committed course — so a decoy course
cannot ship.

**The fairway is exempt from the bite rule, in both directions at once.** A straight
course holds every tied cheapest route and leaves the floor exactly where it was; a bent
one — the corridor runs through a waypoint the direct route ignores — is priced by its
closure the way `bounds` is. What no course may be is _cheaper_ carved than open, and
that bound is what the bite tests assert for this combo where every other barrier must
show strict growth.

**The pool is 385 courses because Earth holds 385, not because anyone chose it.** The
water-fill in `scripts/build-data.ts` admits candidates biggest-bend-first under three
gates, each the answer to a measured failure. No course shares more than
`FAIRWAY_MAX_OVERLAP` (0.6) of its fairway with any kept course — four committed courses
once turned out to be one challenge, crossing the Central American isthmus, wearing four
pairs of endpoints, and country counts cannot see that. No country sits on more than
`FAIRWAY_TRUNK_CAP` (100) courses — without it the fill loosened until Russia fronted
51% of the pool, against 39% in the straight pool the bend was built to escape.
`FAIRWAY_POOL` (800) is a ceiling the gates never let it reach. Do not "fix" a thin pool
by loosening the gates; that is re-admitting the sameyness they exist to refuse. The
honest levers are hand-curated courses, which go through the same verification, or lower
rotation weights.

The pool stores a fairway hole as its **complement**: the wire carries the corridor and
the band, and `holeOf` derives the closure from `LINK_CODES` — `pool.ts`'s one import, a
leaf of pure data, so the module still reaches nothing that reaches the graph. The share
link plays the same trick: v2 tag 4 carries the open ground, and the crossover is
strictly-more-shut-than-open, so every link from before the tag keeps its exact bytes.
Both decodes sort alphabetically and that is load-bearing — the share invariant is deep
equality over the rebuilt puzzle, order included, so every closed list a fairway
produces anywhere in the codebase has exactly one spelling.

The builder's Fairway field is the same carve one derivation earlier: paint the
corridor, and `deriveFairway` in `src/game/freeplay.ts` takes the band one link out and
shuts the rest — without the shortcut repair, deliberately. A hand-built round is the
player's to make easy; only the daily is held to "the rough is never the answer".
**The waypoint is course ground the carve may not bury.** The rules refuse a waypoint
that is shut and refuse one in the rough, so a carve that swallowed it made every
fairway-with-a-via draft unbuildable — the whole combination the panel offers a Via
field for, and the one the classifier keeps a second pill for. It is held open and its
neighbours band like any other course country's, so a via off to one side is reached
through its own band rather than marooned. `previewOf` is the same compile for the
globe, drawn from the first corridor tap rather than the first tap after both ends:
the corridor has no colour of its own — open ground among the grey is the statement —
so before the grey exists, painting and un-painting look like doing nothing.

A `Recipe` carries no corridor, so reopening a course in the builder runs the
derivation backwards: whatever the round left open is the candidate, and it is the
corridor only if carving it reproduces exactly the lists that arrived. That recovers a
builder-painted course (226 of the 385 committed ones too) and refuses the rest —
a generated course has had its band repaired, and no corridor derives it, so a
recovered one would recompile to a _rougher and easier_ round than the one shared.
What those come back as is one collapsed chip per field rather than ~130, since a
wall of identical shapes in which removing any one silently breaks the carve is not
an editable round. The invariant `freeplay.test.ts` pins is that either way,
`recipeOfDraft(draftOf(recipe))` is the round that arrived.

`scripts/measure-fairways.ts` and `scripts/measure-bent-fairways.ts` are the records of
how the parameters were chosen — the straight-pool checkpoint and the bent rework. They
are not maintained against the current pool, and the bent script says so itself: rerun
today, its pool-mix section reads the selection's own output rather than the straight
pool it was measured against.

## Rebuilding the pool

That bound is also why regenerating the pool is survivable. Which puzzle a date gets is
`digest mod pool[difficulty][combo].length` over an array in file order, so any change to
`functions/data/pairs.json` reshuffles every date. But only the two or three dates the
world is currently on can ever be asked for, so those are the only ones that can be
observed to move — and `npm run pin:served` writes them down. It asks the live site what
it is serving and appends to `functions/data/served.json`, which `pickPuzzle` consults
before the pool, so a player part-way through today keeps the board they started on.

It asks rather than recomputing because `PUZZLE_SALT` is a Cloudflare secret and secrets
cannot be read back. **The salt in `.dev.vars` is a development one and answers a
different question** — it will hand you a plausible and completely wrong answer for
today.

**The rule is not "pin before you build". It is "pin while the old pool is still
live".** Those come apart, because the window moves: at 09:00 UTC the reachable dates
are the 11th and the 12th, and by 11:00 UTC they are the 11th, 12th and 13th. Pin at
09:00, deploy at noon, and the 13th went out from the old pool to anyone on UTC+14 for
two hours without ever being recorded — so it moves. The script asks production, not
your working tree, so it is safe to run at any point right up to the deploy, and
re-running only ever appends.

So:

1. `npm run pin:served` — again, right at the end, however many times you ran it before.
   It is idempotent, it only appends, and it **fails loudly** if the site now serves
   something different for a day already recorded: that day has already moved and
   writing it down will not move it back.
2. `npm run build:data`
3. Commit `served.json` and `pairs.json` together, and merge promptly. If hours pass
   between the last pin and the merge, go back to step 1.

A pinned day stays pinned forever, which is why 2026-08-11 and 2026-08-12 will never
grow a barrier: they were served before the daily had any, and that is what they were.
If `pin:served` cannot reach the site it fails rather than writing an empty record — do
not work around that, because a rebuild on top of a record that is missing today is
exactly the thing this exists to prevent.

Analytics (`src/analytics.ts`, PostHog through the `/ingest` proxy in
`functions/ingest/`) is inert unless the build was given `VITE_POSTHOG_KEY`, which
only production is — so nothing local or under test sends anything, and a keyless
build drops the library entirely rather than shipping an idle one. To exercise it,
put a key in `.env.local` and run `pages:dev` alongside `dev`; `/ingest` is proxied
there the same way `/api` is. Add events through `track` and a props helper in
`src/analytics.ts` rather than at the call site, so what gets reported stays
testable in Node. Anything new that gets recorded belongs in `public/privacy.html`
too — it is linked from the rules modal and it is meant to stay true. Note that
`capture_pageview` is left at its default, so `$pageview` and `$pageleave` fire
as well as the ten named events; that is deliberate, and the privacy page says
so.

The dashboard is `scripts/posthog-dashboard.ts`, not something clicked together:
tiles are edited in its `TILES` array and the script re-run, which matches them by
name and updates in place. Rename a tile and the old insight is left behind rather
than updated — the script warns instead of deleting. A property renamed in
`src/analytics.ts` silently empties whichever tile reads it, so the two files
change together. **The script no longer has to be remembered**: editing it is
enough, because `.github/workflows/posthog-dashboard.yml` dry-runs it on the pull
request and runs it for real when the change lands on `main`. That warning about a
renamed tile therefore now goes past in a CI log rather than in front of you — a
rename still leaves an orphan on the dashboard for somebody to remove by hand.

Nobody in the EEA, the UK or Switzerland is measured: `init` asks `/api/region`
and only then imports posthog, because writing the identifier is the act that
matters and a gate after it would be too late. If `/api/region` cannot be reached
the answer is no and nothing loads; do not "fix" that by defaulting it open.

`wrangler pages dev` reports `cf.country: 'US'` and `isEUCountry: false` — a
boolean, where production sends the string `'1'` — so locally you are a US visitor
and the gate is open, and `cf-ipcountry` cannot be used to pretend otherwise
because the real `cf` wins. Test the closed path by calling `isGated` directly.
That type disagreement is why `src/privacy-region.ts` carries a country list as
well as reading the flag.

The globe needs a real WebGL context. Under headless Chrome three.js throws,
`GlobeBoundary` catches it, and the page reads "The globe could not be drawn" — so
anything checking polygon colour, hover or the press-and-hold ring must run headful.

For a one-off look rather than a test, headless can be given a software context:

```js
puppeteer.launch({
  headless: 'shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
```

That draws the globe properly — enough to screenshot the rough's hatch or a
closure's grey and actually look at it. It costs about fifteen seconds a frame,
which is fine for a handful of shots and is exactly why `test:layout` aborts the
globe's chunk instead. Do not put it in a suite.

## Touch

The mobile UI branches on `(hover: none) and (pointer: coarse)` — see
`src/useCoarsePointer.ts` and the matching block in `src/App.css` — deliberately not
on width, so a narrow desktop window keeps its real `<input>`. Resizing a window
proves nothing about the touch layout; only CDP media emulation reveals it.

`npm run test:layout` (`e2e/`) is that emulation, held down: puppeteer at an
iPhone's metrics with `hover: none` / `pointer: coarse` forced through
`Emulation.setEmulatedMedia`, playing five countries on the game's own keys and
then measuring. It is the only suite here that needs a browser, because it is the
only one about layout — it exists because the shell used to grow wider than the
screen with every chip added to the rail, until the backspace key left it.

Two things about it are deliberate and will look wrong. It builds the app and
serves that rather than using `vite dev`, and it aborts the request for the
globe's chunk — a headless browser rasterises three.js in software, and on CI's
two cores either of those costs minutes per keystroke. `.stage` is
`overflow: hidden` and so contributes nothing to the sizing under test, so
neither shortcut weakens it. Puppeteer's own Chrome is not fetched by `npm ci`
(npm blocks its install script); run `npx puppeteer browsers install chrome`
once, as CI does.
