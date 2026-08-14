/**
 * The notices over the board must not be drawn on top of each other.
 *
 * `.closed-notice.via` and `.closed-notice.rough` were both pinned at
 * `top: 3rem`, on the assumption that a round has at most one of them plus a
 * closure. `rough+dogleg` is a real combination — 4 in a hundred medium days,
 * 9 in a hundred hard ones — and on those days the two pills were drawn at
 * exactly the same coordinates, one over the other.
 *
 * A phone is where it matters and a phone is where it is worst: the notices are
 * allowed to wrap under 720px, so even two pills that did not share a `top`
 * could run into each other once the first one took two lines. Hence a real
 * engine at a real width, and a round carrying three barriers at once — more
 * than the pool ever deals, but a shared link can.
 */
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type Browser, type Page } from 'puppeteer'
import { VIEWPORT, openPhone } from './phone'

/**
 * A closure, rough and a waypoint together. The rough is the Carpathians, which
 * `regionOf` names rather than counting, so that pill is long enough to wrap to
 * two lines at this width — the case no arrangement of fixed offsets can
 * survive. Serbia and not Greece: a waypoint that borders an end is refused
 * outright, and Greece borders Türkiye.
 */
const ROUND = '/?free=FRA-TUR&closed=BIH,MKD&rough=ROU,HUN,SVK,UKR&via=SRB'

/**
 * An iPhone SE, and the reason for it is the whole point of the file.
 *
 * At the 393px the other suite uses, only the last of the three pills wraps —
 * and a pill with nothing under it proves nothing about what a wrap does to the
 * pill below. That used to come for free, because the closure pill named its
 * countries and "Bosnia and Herzegovina and North Macedonia closed today" did
 * not fit anywhere; it now reads "2 countries are closed today". So the width
 * comes down to the narrowest phone anybody still holds, where the sentences
 * wrap on their own merits rather than on a name the game no longer gives away.
 */
const NARROW = { ...VIEWPORT, width: 320 }

/** What each pill should say, top to bottom. */
const READING_ORDER = ['closed today', 'run through', 'are rough today']

type Pill = {
  text: string
  top: number
  bottom: number
  left: number
  right: number
  /** How many lines the words took, which is not a height in any font. */
  lines: number
}

let browser: Browser
let page: Page

beforeAll(async () => {
  // Nothing is clicked, here or below. The notices leave four seconds after the
  // player's first move and not before — `arm` in `App.tsx` — so an untouched
  // page holds them up for as long as it takes to measure them.
  ;({ browser, page } = await openPhone(ROUND))
  await page.setViewport(NARROW)
  await page.waitForSelector('.closed-notice')
})

afterAll(async () => {
  await browser?.close()
})

function measure(): Promise<{
  pills: Pill[]
  stage: Omit<Pill, 'text' | 'lines'>
  spill: number
}> {
  return page.evaluate(() => {
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
    }
    // One rect per line box, so counting the distinct tops counts the lines.
    // Heights would not: the runner's fallback font sets its own line height,
    // and a two-line pill there is shorter than a one-line pill here.
    const lines = (element: Element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
    }
    return {
      // In DOM order, which is the order the assertions below are about.
      pills: [...document.querySelectorAll('.closed-notice')].map((pill) => ({
        text: pill.textContent ?? '',
        lines: lines(pill),
        ...box(pill),
      })),
      stage: box(document.querySelector('.stage')!),
      // `html` clips, so only the body reports what escaped.
      spill: document.body.scrollWidth - document.body.clientWidth,
    }
  })
}

test('the round really is carrying three barriers at once', async () => {
  // If this ever drops to two, every assertion below stops proving anything.
  const { pills } = await measure()
  expect(pills.map((pill) => pill.text)).toHaveLength(3)
  for (const [index, wanted] of READING_ORDER.entries()) expect(pills[index].text).toContain(wanted)
})

test('the pills are in reading order, top to bottom', async () => {
  // What the round has done to the map, then what it wants of you. `MECHANICS`
  // order is the other way round; this is the order they are written in.
  const { pills } = await measure()
  const byTop = [...pills].sort((a, b) => a.top - b.top)
  expect(byTop.map((pill) => pill.text)).toEqual(pills.map((pill) => pill.text))
})

test('no two pills are drawn over each other', async () => {
  // The regression itself. Both of the lower two used to sit at top: 3rem, so
  // this comes back with the whole pair.
  const { pills } = await measure()
  const overlapping = pills.flatMap((pill, index) =>
    pills
      .slice(index + 1)
      .filter((other) => pill.top < other.bottom && other.top < pill.bottom)
      .map((other) => [pill.text, other.text]),
  )
  expect(overlapping).toEqual([])
})

test('a pill that wraps pushes the next one down instead of through it', async () => {
  // The half a third tier would not have fixed. How many of the three wrap at
  // this width depends on the machine, so what is asserted is only that one of
  // them does and has another under it — a pill wrapping at the bottom of the
  // stack is the case that never needed fixing.
  const { pills } = await measure()
  expect(pills.slice(0, -1).some((pill) => pill.lines > 1)).toBe(true)

  // And every pill sits the same distance below the one before it, wrapped or
  // not. That is what being in flow means, and it is what a `top` put back on
  // one of them would break.
  const gaps = pills.slice(1).map((pill, index) => pill.top - pills[index].bottom)
  for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 0)
})

test('every pill is on the screen and inside the stage', async () => {
  const { pills, stage, spill } = await measure()
  const escaped = pills.filter(
    (pill) =>
      pill.left < 0 ||
      pill.right > NARROW.width ||
      pill.top < stage.top ||
      pill.bottom > stage.bottom,
  )
  expect(escaped.map((pill) => pill.text)).toEqual([])
  expect(spill).toBe(0)
})
