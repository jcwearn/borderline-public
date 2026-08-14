/**
 * Builds the share card and the raster icon:
 *
 *   public/og.png               1200x630, what iMessage and Slack show
 *   public/apple-touch-icon.png 180x180, the home-screen icon
 *
 * The card is the game's own globe — the same Natural Earth polygons the browser
 * draws, in the same colours — rather than a stock illustration, so a link
 * preview looks like the thing it links to.
 *
 * Rasterizing is done by the Chrome already installed on this machine, which is
 * why this is not part of `npm run build`: the Cloudflare builder has no Chrome.
 * The PNGs are committed, like src/data/graph.json.
 *
 *   npm run build:og
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { feature } from 'topojson-client'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { GRAPH, shortestPath, type CountryCode } from '../src/game/graph.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const WIDTH = 1200
const HEIGHT = 630

/**
 * Off-centre and slightly overflowing the right edge, so the globe reads as a
 * world that continues past the card rather than a logo sitting on it.
 */
const GLOBE = { cx: 872, cy: 315, r: 336 }

/** Centred on the Mediterranean: Europe above, Africa below, Arabia to the right. */
const VIEW = { lat: 27, lon: 18 }

/**
 * The board on the card is a round *in progress*, not a solved one.
 *
 * Portugal to Saudi Arabia is a real puzzle from the pool, so a finished route
 * would be a published answer for the day it comes up. Lighting only part of it
 * avoids that, and is the truer picture anyway — you build inward from both ends,
 * and the card catches you mid-round with Libya and the Levant still dark. It
 * also puts Spain and Morocco next to each other, which is the border most
 * players refuse to believe.
 */
const START: CountryCode = 'PRT'
const END: CountryCode = 'SAU'
const PLACED: CountryCode[] = ['ESP', 'MAR', 'DZA', 'EGY']

/** Straight from src/components/GlobeView.tsx, so the card cannot drift from the game. */
const OCEAN = '#0d1428'
const FILL = {
  inert: 'rgba(30, 38, 66, 0.55)',
  unknown: 'rgba(58, 70, 112, 0.85)',
  placed: 'rgba(90, 209, 160, 0.92)',
  start: 'rgba(242, 177, 52, 0.95)',
  end: 'rgba(240, 118, 178, 0.95)',
} as const
type Role = keyof typeof FILL

const STROKE = 'rgba(12, 18, 36, 0.9)'
const STROKE_LIT = 'rgba(232, 236, 248, 0.75)'

// --- the featured board -----------------------------------------------------

const route = shortestPath(START, END)
if (!route) throw new Error(`no land route from ${START} to ${END}`)

for (const code of PLACED) {
  if (!route.includes(code)) {
    throw new Error(`${code} is not on the shortest ${START}-${END} route: ${route.join(' ')}`)
  }
}

// The whole point of the composition. If a future data build ever made these
// placements enough to join the two ends up, the card would be an answer key.
const inPlay = new Set<CountryCode>([START, END, ...PLACED])
if (shortestPath(START, END, inPlay)) {
  throw new Error('the featured board is solved — the card would spoil the puzzle')
}

const ROLES = new Map<CountryCode, Role>([
  [START, 'start'],
  [END, 'end'],
  ...PLACED.map((code): [CountryCode, Role] => [code, 'placed']),
])

// --- orthographic projection ------------------------------------------------

type Point = [number, number]

const RADIANS = Math.PI / 180
const lat0 = VIEW.lat * RADIANS
const lon0 = VIEW.lon * RADIANS

/** Positive on the near side of the globe, negative on the side facing away. */
function facing(lon: number, lat: number): number {
  const phi = lat * RADIANS
  const lambda = lon * RADIANS
  return Math.sin(lat0) * Math.sin(phi) + Math.cos(lat0) * Math.cos(phi) * Math.cos(lambda - lon0)
}

function project(lon: number, lat: number): Point {
  const phi = lat * RADIANS
  const lambda = lon * RADIANS
  const x = Math.cos(phi) * Math.sin(lambda - lon0)
  const y =
    Math.cos(lat0) * Math.sin(phi) - Math.sin(lat0) * Math.cos(phi) * Math.cos(lambda - lon0)
  return [GLOBE.cx + GLOBE.r * x, GLOBE.cy - GLOBE.r * y]
}

/** Where a segment from a visible point to a hidden one crosses the horizon. */
function horizon(from: Position, to: Position): Position {
  let visible = 0
  let hidden = 1
  for (let step = 0; step < 24; step++) {
    const mid = (visible + hidden) / 2
    const lon = from[0] + (to[0] - from[0]) * mid
    const lat = from[1] + (to[1] - from[1]) * mid
    if (facing(lon, lat) >= 0) visible = mid
    else hidden = mid
  }
  return [from[0] + (to[0] - from[0]) * visible, from[1] + (to[1] - from[1]) * visible]
}

function angleAt([x, y]: Point): number {
  return Math.atan2(GLOBE.cy - y, x - GLOBE.cx)
}

/**
 * The rim between where a ring leaves the visible hemisphere and where it comes
 * back. Without this, a country that wraps around the edge — Russia, Antarctica —
 * gets closed with a straight chord that slices across the ocean.
 */
function limbArc(from: number, to: number): Point[] {
  let sweep = to - from
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  while (sweep < -Math.PI) sweep += 2 * Math.PI

  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 180)))
  const points: Point[] = []
  for (let step = 1; step < steps; step++) {
    const angle = from + (sweep * step) / steps
    points.push([GLOBE.cx + GLOBE.r * Math.cos(angle), GLOBE.cy - GLOBE.r * Math.sin(angle)])
  }
  return points
}

function clipRing(ring: Position[]): Point[] | null {
  const shown = ring.map(([lon, lat]) => facing(lon, lat) >= 0)
  if (!shown.includes(true)) return null
  if (!shown.includes(false)) return ring.map(([lon, lat]) => project(lon, lat))

  // Start at a visible vertex, so every exit is followed by its re-entry and the
  // rim arcs can be walked in one pass.
  const offset = shown.indexOf(true)
  const ordered = [...ring.slice(offset), ...ring.slice(0, offset)]
  const visible = [...shown.slice(offset), ...shown.slice(0, offset)]

  const points: Point[] = []
  let leftAt: number | null = null

  for (let index = 0; index < ordered.length; index++) {
    const current = ordered[index]
    const next = ordered[(index + 1) % ordered.length]
    const here = visible[index]
    const there = visible[(index + 1) % ordered.length]

    if (here) points.push(project(current[0], current[1]))
    if (here === there) continue

    const crossing = horizon(here ? current : next, here ? next : current)
    const point = project(crossing[0], crossing[1])

    if (here) {
      leftAt = angleAt(point)
      points.push(point)
    } else {
      if (leftAt !== null) points.push(...limbArc(leftAt, angleAt(point)))
      points.push(point)
      leftAt = null
    }
  }

  return points.length >= 3 ? points : null
}

function ringPath(points: Point[]): string {
  return `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`
}

function shapePath(shape: Feature<Polygon | MultiPolygon>): string {
  const polygons =
    shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates] : shape.geometry.coordinates

  return polygons
    .flat()
    .map(clipRing)
    .filter((points) => points !== null)
    .map(ringPath)
    .join('')
}

// --- the globe --------------------------------------------------------------

const topology = JSON.parse(
  readFileSync(join(ROOT, 'public/countries-110m.json'), 'utf8'),
) as Topology<{ countries: GeometryCollection }>

const byCcn3 = new Map<string, CountryCode>(
  Object.entries(GRAPH).map(([code, entry]) => [entry.ccn3, code]),
)

const shapes = feature(topology, topology.objects.countries).features as Array<
  Feature<Polygon | MultiPolygon>
>

/** Drawn dimmest first, so a lit country is never overdrawn by its neighbour. */
const ORDER: Role[] = ['inert', 'unknown', 'placed', 'start', 'end']

const layers = new Map<Role, string[]>(ORDER.map((role) => [role, []]))
const drawn = new Set<CountryCode>()

for (const shape of shapes) {
  const code = byCcn3.get(String(shape.id)) ?? null
  const role: Role = code === null ? 'inert' : (ROLES.get(code) ?? 'unknown')
  const path = shapePath(shape)
  if (!path) continue
  layers.get(role)!.push(path)
  if (code) drawn.add(code)
}

for (const code of inPlay) {
  if (!drawn.has(code)) throw new Error(`${GRAPH[code].name} is not visible from this angle`)
}

const land = ORDER.map((role) => {
  const paths = layers.get(role)!
  if (paths.length === 0) return ''
  const stroke = role === 'inert' || role === 'unknown' ? STROKE : STROKE_LIT
  const width = role === 'inert' || role === 'unknown' ? 0.9 : 1.6
  return `<path d="${paths.join('')}" fill="${FILL[role]}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" />`
}).join('\n      ')

const globe = `
    <svg class="globe" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="sea" cx="38%" cy="30%" r="78%">
          <stop offset="0%" stop-color="#16223f" />
          <stop offset="62%" stop-color="${OCEAN}" />
          <stop offset="100%" stop-color="#070c1b" />
        </radialGradient>
        <radialGradient id="sky" cx="50%" cy="50%" r="50%">
          <stop offset="86%" stop-color="rgba(74, 109, 168, 0)" />
          <stop offset="97%" stop-color="rgba(74, 109, 168, 0.42)" />
          <stop offset="100%" stop-color="rgba(74, 109, 168, 0)" />
        </radialGradient>
        <clipPath id="disc">
          <circle cx="${GLOBE.cx}" cy="${GLOBE.cy}" r="${GLOBE.r}" />
        </clipPath>
      </defs>
      <circle cx="${GLOBE.cx}" cy="${GLOBE.cy}" r="${GLOBE.r}" fill="url(#sea)" />
      <g clip-path="url(#disc)">
      ${land}
      </g>
      <circle cx="${GLOBE.cx}" cy="${GLOBE.cy}" r="${GLOBE.r * 1.06}" fill="url(#sky)" />
      <circle cx="${GLOBE.cx}" cy="${GLOBE.cy}" r="${GLOBE.r}" fill="none" stroke="rgba(74, 109, 168, 0.5)" stroke-width="1.5" />
    </svg>`

// --- the card ---------------------------------------------------------------

const card = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        overflow: hidden;
        background: #0b1020;
        font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        color: #e8ecf8;
      }
      .card { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; }
      .globe { position: absolute; inset: 0; }
      .fade {
        position: absolute;
        inset: 0;
        background: linear-gradient(100deg, #0b1020 24%, rgba(11, 16, 32, 0.88) 40%, rgba(11, 16, 32, 0) 62%);
      }
      .text { position: absolute; left: 84px; top: 168px; width: 500px; }
      h1 {
        font-size: 78px;
        font-weight: 700;
        letter-spacing: 0.15em;
        line-height: 1;
        text-transform: uppercase;
      }
      .rule {
        width: 96px;
        height: 4px;
        margin: 34px 0 30px;
        border-radius: 2px;
        background: #5ad1a0;
      }
      p {
        font-size: 30px;
        line-height: 1.42;
        color: #8f9ac0;
      }
      .site {
        margin-top: 42px;
        font-size: 25px;
        font-weight: 600;
        letter-spacing: 0.06em;
        color: #5ad1a0;
      }
    </style>
  </head>
  <body>
    <div class="card">
${globe}
      <div class="fade"></div>
      <div class="text">
        <h1>Borderline</h1>
        <div class="rule"></div>
        <p>Cross the world in as few countries as possible. A daily land-border puzzle, scored like golf.</p>
        <div class="site">borderline.golf</div>
      </div>
    </div>
  </body>
</html>`

const icon = readFileSync(join(ROOT, 'public/favicon.svg'), 'utf8')
const touchIcon = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; }
      body { width: 180px; height: 180px; overflow: hidden; background: #0b1020; }
      svg { display: block; width: 180px; height: 180px; }
    </style>
  </head>
  <body>${icon}</body>
</html>`

// --- rasterize --------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'borderline-og-'))

/**
 * Chrome 151 writes the screenshot and then declines to exit, so waiting on the
 * process would wait forever. Wait on the file instead: once it has appeared and
 * stopped growing, the picture is taken and Chrome has nothing left to say.
 */
async function written(path: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let previous = -1

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const size = statSync(path, { throwIfNoEntry: false })?.size ?? -1
    if (size > 0 && size === previous) return
    previous = size
  }
  throw new Error(`Chrome never produced ${path}`)
}

async function shoot(html: string, width: number, height: number, output: string): Promise<void> {
  const page = join(scratch, `${output.replace(/\W/g, '-')}.html`)
  const target = join(ROOT, 'public', output)
  writeFileSync(page, html)
  rmSync(target, { force: true })

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      `--user-data-dir=${join(scratch, 'profile')}`,
      `--window-size=${width},${height}`,
      `--screenshot=${target}`,
      `file://${page}`,
    ],
    { stdio: 'ignore', detached: true },
  )

  try {
    await written(target)
  } finally {
    // Detached, so the whole process group goes — Chrome leaves helpers behind.
    try {
      process.kill(-chrome.pid!, 'SIGKILL')
    } catch {
      chrome.kill('SIGKILL')
    }
  }

  const png = readFileSync(target)
  const actual = [png.readUInt32BE(16), png.readUInt32BE(20)]
  if (actual[0] !== width || actual[1] !== height) {
    throw new Error(`${output} came out ${actual[0]}x${actual[1]}, wanted ${width}x${height}`)
  }

  // Apple's link fetcher gives up on large images, and a preview that never
  // arrives is worse than a plain one.
  const bytes = png.byteLength
  if (bytes > 500_000) {
    throw new Error(`${output} is ${Math.round(bytes / 1024)}KB, over the 500KB budget`)
  }

  console.log(`public/${output}  ${width}x${height}  ${Math.round(bytes / 1024)}KB`)
}

await shoot(card, WIDTH, HEIGHT, 'og.png')
await shoot(touchIcon, 180, 180, 'apple-touch-icon.png')

console.log(
  `featured: ${route.map((code) => GRAPH[code].name).join(' → ')} (par ${route.length - 2}), ` +
    `${PLACED.length} of ${route.length - 2} placed`,
)
