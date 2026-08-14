/**
 * The phone layout must never be wider than the phone.
 *
 * A playtester found the game unplayable on iOS: the shell grew a little wider
 * with every country placed, and since `html, body` cannot scroll, the width it
 * grew into was unreachable. Backspace is the rightmost key on the bottom row,
 * so it was the first thing to go.
 *
 * It needs a browser because it is about layout — the fault was a grid track
 * sized to its content rather than to its container, which is invisible to
 * anything that does not lay out boxes for real. It also has to be a *coarse
 * pointer* browser: the on-screen keypad is behind `(hover: none) and (pointer:
 * coarse)`, not behind a width. Both come from `openPhone`.
 */
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type Browser, type Page } from 'puppeteer'
import { VIEWPORT, openPhone, step } from './phone'

/**
 * Four countries out of France and one back from Turkey, which leaves Bulgaria
 * missing so the round stays unfinished — winning would replace the keypad with
 * the scorecard and there would be no keys left to measure. Free play builds its
 * round in the client and rolls no dice without a `&closed=`, so this is the
 * same board every run; the borders are `src/data/graph.json`'s.
 */
const ROUTE = ['italy', 'slovenia', 'croatia', 'serbia', 'greece']

/** Twenty-six letters, a space and a backspace. */
const KEY_COUNT = 28

let browser: Browser
let page: Page
let globeRefused: () => number

beforeAll(async () => {
  ;({ browser, page, globeRefused } = await openPhone('/?free=FRA-TUR'))

  await step('keypad', async () => {
    await page.click('.guess-bar-toggle')
    await page.waitForSelector('.keypad .key')
  })
  for (const name of ROUTE) await step(name, () => place(name))
})

afterAll(async () => {
  await browser?.close()
})

/** Type a country on the game's own keys and take the match it offers. */
async function place(name: string): Promise<void> {
  const before = await chips()
  for (const letter of name) await page.click(`.keypad .key[aria-label="${letter}"]`)

  // A full country name should rank itself first, so waiting on the leading
  // chip is both how the guess gets sent and a check that it did.
  await page.waitForFunction(
    (wanted: string) =>
      document.querySelector('.suggestion-chip')?.textContent?.toLowerCase().includes(wanted) ??
      false,
    {},
    name,
  )
  await page.click('.suggestion-chip')

  // The rail is the only honest confirmation: a rejected guess leaves a toast
  // and no chip, and would otherwise be typed over in silence.
  await page.waitForFunction(
    (count: number) => document.querySelectorAll('.rail-run .chip').length === count,
    {},
    before + 1,
  )
}

function chips(): Promise<number> {
  return page.$$eval('.rail-run .chip', (found) => found.length)
}

test('the globe was kept off the board', async () => {
  // Guards the pattern above rather than the app: rename the chunk and the
  // globe comes back, and the only symptom is a suite that slowly times out on
  // a machine nobody is watching.
  expect(globeRefused()).toBeGreaterThan(0)
  expect(await page.$('.globe-failed')).not.toBeNull()
})

test('the board really is long enough to have broken', async () => {
  // Two endpoints and the five above. If this ever drops, every assertion below
  // stops proving anything — a short rail never triggered the bug.
  expect(await chips()).toBe(ROUTE.length + 2)
})

test('the page has no horizontal overflow', async () => {
  const shell = await page.evaluate(() => {
    const app = document.querySelector('.app')!
    return {
      // The used width of the shell's one grid column. `.app`'s own box is
      // always the viewport — it is the track inside it that used to grow, so
      // this is the number the whole fix is about, and the only one that says
      // plainly what went wrong.
      track: getComputedStyle(app).gridTemplateColumns,
      viewport: `${window.innerWidth}px`,
      // `html` clips, so only the body reports what escaped.
      spill: document.body.scrollWidth - document.body.clientWidth,
    }
  })
  expect(shell.track).toBe(shell.viewport)
  expect(shell.spill).toBe(0)
})

test('the chain rail scrolls sideways instead of widening the page', async () => {
  // The other half of it. `.rail-run` has always carried `overflow-x: auto` and
  // had never once used it: it handed its full content width up the tree
  // instead, and the tree had nothing to stop it.
  const rail = await page.$eval('.rail-run', (run) => ({
    scroll: run.scrollWidth,
    client: run.clientWidth,
  }))
  expect(rail.scroll).toBeGreaterThan(rail.client)
})

test('every key is on the screen, backspace included', async () => {
  const keys = await page.$$eval('.keypad .key', (found) =>
    found.map((key) => ({
      label: key.getAttribute('aria-label'),
      left: key.getBoundingClientRect().left,
      right: key.getBoundingClientRect().right,
    })),
  )

  expect(keys).toHaveLength(KEY_COUNT)
  const offscreen = keys.filter((key) => key.left < 0 || key.right > VIEWPORT.width)
  expect(offscreen.map((key) => key.label)).toEqual([])
})

/**
 * Last, and on the same page as everything above: the builder opens over the
 * round rather than replacing it, so opening it here is the real thing and
 * costs no second page load. Nothing after this may depend on the round.
 */
test('the free play panel takes the bottom of the screen and leaves the globe the top', async () => {
  await step('open the builder', async () => {
    await page.click('.mute[aria-label="Free play"]')
    await page.waitForSelector('.free-drawer')
  })

  const built = await page.evaluate(() => {
    const app = document.querySelector('.app')!
    const stage = document.querySelector('.stage')!.getBoundingClientRect()
    const drawer = document.querySelector('.free-drawer')!.getBoundingClientRect()
    return {
      track: getComputedStyle(app).gridTemplateColumns,
      viewport: `${window.innerWidth}px`,
      spill: document.body.scrollWidth - document.body.clientWidth,
      stageHeight: stage.height,
      // What the panel would have covered if the stage had not been shortened
      // to make room for it. That overlap is the whole bug on a phone: the
      // camera frames the two endpoints at the middle of the stage.
      overlap: stage.bottom - drawer.top,
      drawerRight: drawer.right,
    }
  })

  // The panel is content-sized, and a panel in the grid flow would hand that
  // width straight to the shell's one column — which is what this file exists
  // to catch.
  expect(built.track).toBe(built.viewport)
  expect(built.spill).toBe(0)
  expect(built.drawerRight).toBeLessThanOrEqual(VIEWPORT.width)

  expect(built.overlap).toBeLessThanOrEqual(1)
  expect(built.stageHeight).toBeGreaterThan(100)
})
