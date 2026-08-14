# Borderline

**[borderline.golf](https://borderline.golf)** — cross the world in as few countries as
possible.

> **This is a read-only published snapshot.** Development happens in a private
> repo; a CI job mirrors the filtered tree here on every merge. Issues and pull
> requests opened here won't sync back upstream, and commits here will be
> overwritten by the next sync. Feel free to read, fork, and steal ideas.

Scored like golf, because it plays like golf: every puzzle has a par, and par gives you
a shot in hand over the shortest land route that exists — two on a hard day. So a clean
round finishes under it. Rounds read as `-2`, `-1`, `E`, `+3`.

You're given a start country and an end country, and place countries one at a time,
building inward from both ends until the two sides touch. A placement is legal only if
it joins something already in play — by a land border, or by one of the curated sea
crossings, which cost more and are drawn as dashed arcs. The globe is unlabelled: you
can buy a country's name, at a price, and that price is what the game is built around.

Layered on top: a daily closed border that can invalidate the obvious route, regions of
"rough" that cost double rather than blocking, doglegs that force a waypoint, and above
two closures the shut countries stop being named individually and become a region —
because naming them would hand back a reveal apiece.

## How it is built

React 19 + TypeScript on Vite, deployed to Cloudflare Pages with a Pages Function for
the API. `react-globe.gl` and three.js draw the globe.

The daily puzzle is derived deterministically from the date and a server-side
`PUZZLE_SALT`, so nothing is stored and no puzzle exists before its day. Publishing the
puzzle pool does not reveal future puzzles — the date-to-puzzle mapping is what the salt
protects, and the salt is a Cloudflare secret. A shareable free-play mode builds and
verifies rounds entirely in the browser.

All sound is synthesised at runtime in `src/audio.ts` through the Web Audio API. There
are no audio files.

## Data

Country names, flags and land borders come from
[mledoze/countries](https://github.com/mledoze/countries) (ODbL-1.0); globe geometry from
[world-atlas](https://github.com/topojson/world-atlas) (ISC, deriving from Natural Earth,
which is public domain). Both are vendored under `data/raw/` so a build is reproducible
and the graph cannot shift underneath a live puzzle.

ODbL is share-alike and reaches what is generated from it: `src/data/graph.json`,
`crossings.json`, `regions.json` and `functions/data/pairs.json` all inherit it.

Regions and sea crossings are curated by hand, and the curation _is_ the mechanic —
generated regions turned out to sit on no cheapest route at all and would have been
decoration. Each entry carries the reason it earned its place.

## License

Source code MIT. Vendored data keeps its upstream licence — see [LICENSE](LICENSE).
