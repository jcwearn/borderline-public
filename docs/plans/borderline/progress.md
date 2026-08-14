# Progress: Borderline

## Current Status: Live at https://borderline.golf

| Phase | Status | Updated | Notes |
|-------|--------|---------|-------|
| 0. Repo init | Complete | 2026-08-09 | Vite 8 + React 19 + TS 6, Vitest 4, oxlint |
| 1. Data pipeline | Complete | 2026-08-09 | 165 countries, 6510 puzzles, assertions in the build |
| 2. Game engine | Complete | 2026-08-09 | `src/game/`, pure TS, no React or DOM |
| 3. UI + globe | Complete | 2026-08-09 | Built and typechecked; **not yet seen in a browser** |
| 4. Daily backend | Complete | 2026-08-09 | Verified against a running `wrangler pages dev` |
| 5. Share, stats, resume | Complete | 2026-08-09 | Full round played headlessly against the live API |
| 6. Deploy | Complete | 2026-08-09 | Pages project `borderline-golf`, Git-connected, apex + www |
| 7. Share previews | Complete | 2026-08-09 | `og:*` card, real favicon, `apple-touch-icon` |

232 tests passing. `npx tsc -b` and `npm run lint` clean.

## What the data decided

Three findings from the source data shaped the design, all with assertions guarding them:

- **A border only counts if both countries claim it.** That intersection drops Sri Lanka →
  India, a maritime claim listed one way round. Any *new* asymmetry fails the build.
- **The dump marks Vatican City as a UN member** (it is an observer), so the filter yields
  194 rather than 193.
- **Only countries with a globe polygon are in the graph.** That buys the invariant the
  reveal mechanic needs — every country is clickable, every clickable shape is a country.
  It drops 29: 24 islands with no land border, plus Andorra, Liechtenstein, Monaco, San
  Marino and Vatican City, all dead ends whose neighbours already border each other. Nothing
  is disconnected and the puzzle count is unchanged.

**Morocco–Spain is a land border** in this data — the Ceuta and Melilla exclaves — so Africa
connects to Europe there, not only via Egypt. Factually correct and it materially changes
routes: Nigeria → South Korea is par 9 through Spain, not through the Middle East.

## Handoff Notes

**Phase 3 has not been seen in a browser.** It builds, typechecks and lints, and every piece
of logic under it is tested, but the Chrome extension was not connected during the build, so
no one has confirmed the globe renders, that hovering does not leak a name, or that clicking
a shape reveals it. That is the first thing to do.

To run the whole thing:

```sh
npm run pages:dev          # builds, then serves app + /api/daily on :8788
npm run dev                # optional: hot reload on :5173, proxies /api to :8788
```

`.dev.vars` holds a local `PUZZLE_SALT` and is gitignored. In production the salt is a Pages
secret — the Function refuses to start without one rather than falling back to a guessable
default.

**Deployment is automatic.** The Pages project is `borderline-golf`, connected to
`jcwearn/borderline` via the Cloudflare GitHub App. Pushing to `main` deploys production;
pushing any branch deploys a preview and the bot comments the URL on the PR. Nothing is
deployed by hand.

Branch aliases truncate at 28 characters — `feat/share-previews-and-domain` served from
`feat-share-previews-and-doma.borderline-golf.pages.dev` — so read the URL out of the PR
comment rather than guessing it.

`PUZZLE_SALT` is set on **both** the production and preview environments; previews would
otherwise 500 on `/api/daily` and be unplayable. `wrangler pages secret put` only writes
production — the preview one went in via `PATCH …/pages/projects/borderline-golf` with
`deployment_configs.preview.env_vars`. **Do not rotate either**: the salt is what maps a date
to a puzzle, so changing it reshuffles every future daily, and Cloudflare will not read a
secret back, so a lost salt cannot be recovered.

**The Pages build image bundles Functions with wrangler 3**, whose esbuild cannot parse
import attributes. That is why `functions/api/daily.ts` imports its JSON bare while the rest
of the repo uses `with { type: 'json' }`. Anything new under `functions/` must follow the same
rule. It will not show up locally — `npm run pages:dev` uses the repo's wrangler 4.

**The share card is not rebuilt by `npm run build`.** `npm run build:og` rasterizes
`public/og.png` and `public/apple-touch-icon.png` with the local Chrome, which the Cloudflare
builder does not have, so both PNGs are committed. Rerun it if the globe palette or the
featured board in `scripts/build-og.ts` changes.

**Custom domains** `borderline.golf` and `www.borderline.golf`. `wrangler` 4.120 has no
`pages domain` command, so this went through the REST API
(`/accounts/{id}/pages/projects/borderline-golf/domains`), and so must any future change.
Adding a domain that way does **not** create the DNS record the dashboard flow creates —
both `@` and `www` are proxied CNAMEs to `borderline-golf.pages.dev`, added by hand.

**All three hosts serve the game and none redirect.** `_redirects` cannot match on hostname
— Cloudflare lists domain-level redirects as unsupported — so canonicalising `www` and
`borderline-eb1.pages.dev` onto the apex needs either a zone Redirect Rule or a
`functions/_middleware.ts`, and middleware would put every static asset through a Worker.
Neither is in place. The `canonical` link and `og:url` in `index.html` both name the apex,
which is what actually decides how a shared link is attributed, so this is cosmetic.

**Still not seen in a real browser.** The globe renders in headless Chrome for the share card,
which is some evidence the geometry is right, but nobody has yet confirmed the live site
plays: that hovering does not leak a name, that press-and-hold buys one, that audio fires.
