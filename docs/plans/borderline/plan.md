# Plan: Borderline — a daily land-border traversal game

> **This plan is v1 and is complete.** The work that follows it — beatable par, hazards and
> the sea links deferred below — lives in [`../distinctive/plan.md`](../distinctive/plan.md).
> Note that par no longer means what it means here: it is now the shortest route *plus an
> allowance*, and the shortest route is `Puzzle.best`.

## Context

Inspired by [this short](https://www.youtube.com/shorts/DLL5b5f_1hs), where someone must
travel Nigeria → South Korea crossing as few countries as possible. Played straight, that
demands recall most people don't have.

Borderline keeps the premise and splits the difficulty in two. **Knowing where to go** is
spatial and fairly common. **Knowing what those countries are called** is recall, and that's
the wall. So the globe is unlabeled and you type country names to place them, but at any
moment you can point at a shape and buy its name. Beginners spend reveals and finish;
experts type from memory and beat par.

**Loop.** Given a start and end country, place countries one at a time. A placement is legal
only if it shares a land border with something already in play. You build inward from both
ends and win the moment the two sides touch. Par is the true shortest path.

### Decisions

| | |
|---|---|
| **Graph** | Land borders only, from [mledoze/countries](https://github.com/mledoze/countries). Two playable components: Afro-Eurasia (124) and the Americas (22). |
| **Globe** | Fully unlabeled. Names appear only on the endpoints, countries placed, and countries revealed. Load-bearing, not cosmetic. |
| **Reveal** | Click an unnamed country → it names it and places it if legal. Costs **+1**. |
| **Misses** | Rejected and free to retry, but **every 2 misses adds +1**. No hard fail. |
| **Assist** | *Daily* is strict. *Casual* highlights every legal next move. |

`score = countries placed + floor(misses / 2) + reveals`, against par.

> A revealed country that turns out to be illegal costs twice — the reveal *and* the miss.
> Deliberately spiky in strict mode, and the sharpest edge in the design. Both penalties are
> named constants in `src/game/score.ts`.

## Phases

### Phase 0: Repo init
Vite + React + TS scaffold, Vitest, directory layout.
Files: `package.json`, `tsconfig.*.json`, `vitest.config.ts`
Done when: `npm run dev` serves the app.

### Phase 1: Data pipeline
Vendor upstream data, generate the graph and puzzle pool, assert as you go.
Files: `scripts/build-data.ts`, `data/raw/`, `src/data/graph.json`, `functions/data/pairs.json`
Done when: the build generates and every assertion passes.

### Phase 2: Game engine
Pure TS: graph search, rules, scoring, daily selection.
Files: `src/game/{graph,rules,score,daily,search}.ts`
Done when: the suite is green and a puzzle is winnable headlessly.

### Phase 3: UI + unlabeled globe
Files: `src/components/{GlobeView,GuessInput,ChainRail}.tsx`, `src/geometry.ts`, `src/App.tsx`
Done when: a puzzle is playable to a win in a browser, by typing and by clicking.

### Phase 4: Daily backend
Files: `functions/api/daily.ts`, `src/daily-client.ts`, `wrangler.toml`
Done when: `wrangler pages dev` serves a stable daily puzzle the app consumes.

### Phase 5: Share, stats, persistence
Files: `src/game/share.ts`, `src/storage.ts`, `src/components/ResultModal.tsx`
Done when: the share text copies and a refresh mid-game restores state.

### Phase 6: Deploy
Cloudflare Pages project, `PUZZLE_SALT` secret, preview → production.
Done when: a live URL serves the same daily puzzle in two browsers.

## Deferred

- **Sea/ferry links** as a later "Ferry mode" — would unlock the ~40 island nations and
  connect the Americas to Eurasia, at the cost of a file of judgment calls.
- **KV**, only if global stats or hand-curated puzzle dates are wanted. Nothing in v1 needs it.
- **Archive / practice mode** — trivial once the engine exists, since the client can generate
  puzzles from `graph.json` alone.
- **Tune the double penalty** on a failed reveal after playtesting.
