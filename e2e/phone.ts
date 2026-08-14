/**
 * A headless phone at a round of Borderline, which is what every test here
 * starts from.
 *
 * Shared rather than copied because none of it is any one test's business: the
 * viewport, the refused globe, the emulated pointer and the seeded storage are
 * all the same conditions, and a second copy of them is a second thing to
 * remember when one of them moves.
 */
import puppeteer, { type Browser, type Page } from 'puppeteer'

/** An iPhone 16's CSS viewport, less Safari's chrome. */
export const VIEWPORT = {
  width: 393,
  height: 659,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}

/** The globe's chunk, as `vite build` names it. */
const GLOBE_CHUNK = /\/assets\/GlobeView-[^/]*\.js$/

/** Names each step in the log, so a hang on a machine you cannot see says where. */
export async function step<T>(what: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now()
  const done = await run()
  console.log(`  ${what} — ${Math.round(performance.now() - started)}ms`)
  return done
}

export type Phone = {
  browser: Browser
  page: Page
  /** How many times the globe's chunk was turned away. */
  globeRefused: () => number
}

/** Open `path` on the served build, with the board up and no modal over it. */
export async function openPhone(path: string): Promise<Phone> {
  const browser = await step('launch', () =>
    puppeteer.launch({
      args: process.env.CI
        ? [
            // GitHub's Ubuntu runners disable unprivileged user namespaces, so
            // Chrome's own sandbox has nothing to build on and it aborts before
            // the first page. Only on CI, and only ever pointed at a Vite server
            // `serve.ts` started: nothing here loads anything the repo did not
            // write. Locally the sandbox stays on.
            '--no-sandbox',
            // A runner gives /dev/shm 64MB, which a page carrying three.js can
            // exhaust — and Chrome answers that by hanging rather than failing.
            '--disable-dev-shm-usage',
          ]
        : [],
    }),
  )
  const page = await browser.newPage()
  page.on('pageerror', (error) => console.log(`  page error: ${String(error)}`))
  await page.setViewport(VIEWPORT)

  // Refuse the globe. Headless Chrome has no GPU, so it rasterises three.js in
  // software, and on a two-core runner one animating globe is the whole machine
  // — a country that types in 200ms here took 78 seconds there. Nothing in this
  // directory reads the globe, and it cannot affect what does: `.stage` is
  // `overflow: hidden`, which keeps it out of the grid track's sizing entirely.
  // Withheld, the lazy import rejects and `GlobeBoundary` puts up the same
  // "could not be drawn" it puts up for a missing WebGL context.
  let globeRefused = 0
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (!GLOBE_CHUNK.test(request.url())) return void request.continue()
    globeRefused += 1
    void request.abort()
  })
  // The layout branches on the pointer, not on the width. Without this the page
  // renders a real `<input>` and there is no keypad to measure. Straight down
  // CDP because `page.emulateMediaFeatures` only allows the preference queries
  // — `hover` and `pointer` are not on its list.
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'hover', value: 'none' },
      { name: 'pointer', value: 'coarse' },
      { name: 'any-hover', value: 'none' },
      { name: 'any-pointer', value: 'coarse' },
    ],
  })
  // Every one-time explainer is a modal over the board, and the board is what
  // these tests are about. The key is `src/storage.ts`'s; every field it does
  // not find falls back to a default.
  //
  // `mechanicsSeen` is the names in `MECHANICS`, spelled out because `e2e/` is
  // outside the app's own module graph, and named in full whatever round is
  // being opened — a URL that grows a barrier must not silently grow a modal
  // over the thing being measured.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem(
      'borderline:v1',
      JSON.stringify({
        howToPlaySeen: true,
        revealNoticeSeen: true,
        mechanicsSeen: ['dogleg', 'rough', 'bounds', 'closed'],
      }),
    )
  })

  // `domcontentloaded` and not `load`: the globe is a megabyte and a half of
  // three.js behind a dynamic import, and waiting on it would be waiting on the
  // one part of the page these tests do not read. Headless Chrome has no WebGL
  // anyway, so it throws, `GlobeBoundary` catches it, and the stage says so.
  await step('goto', () =>
    page.goto(`${process.env.BORDERLINE_URL}${path}`, { waitUntil: 'domcontentloaded' }),
  )
  await step('board', () => page.waitForSelector('.rail-run .chip'))

  return { browser, page, globeRefused: () => globeRefused }
}
