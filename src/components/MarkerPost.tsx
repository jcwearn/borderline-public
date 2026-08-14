/**
 * The stake that marks the dogleg's waypoint.
 *
 * This used to be ⛳, which is the flagstick in the cup — the *end* of a hole,
 * borrowed to mean a midpoint. That inversion is worth avoiding here because
 * the golf vocabulary is load-bearing rather than decorative: par, strokes,
 * rough and the dogleg itself all mean what they mean, and the scorecard counts
 * real ones. What marks a dogleg on a course is a stake at the corner — aim at
 * it, reach it, play on — so that is what this draws.
 *
 * Drawn rather than typed, and that is the other half of the change. The globe
 * carries no emoji at all: its whole vocabulary is fill, lift, stroke and the
 * rough's hatch, and every colour in `GlobeView`'s `FILL` has a comment saying
 * what it may not be confused with. A colour emoji would drop red and green
 * into the middle of that. A path in `currentColor` is simply whatever colour
 * the label already is, which for the waypoint is bone — `.chip.required` and
 * `.closed-notice.via` set it, and on the globe `.globe-label-required` does.
 * It also cannot come out as a tofu box on a platform whose fonts have never
 * heard of it.
 *
 * The pennant is filled where the rest of the app's icons are pure outline, and
 * that is on purpose: the smallest this is ever drawn is inside a globe label
 * at 0.74rem, where a stroked triangle is the hairline the plus button's own
 * comment warns about — "the one mark the button is named for was the one you
 * could not see". The post keeps the house stroke; the flag needs mass.
 *
 * Two exports of one drawing, because there are two callers wanting different
 * things: the rail and the notices are React, and `labelElement` in `GlobeView`
 * builds its nodes by hand. The shape lives here once so they cannot drift —
 * which is the whole point of the file, and is why the fast-refresh rule is
 * turned off below rather than obeyed. Obeying it means the path in one file
 * and the component in another, which is the drift this exists to prevent; the
 * cost is that editing this icon full-reloads instead of hot-swapping.
 */
const VIEW_BOX = '0 0 24 24'
const POST = 'M7 3.2V21'
const PENNANT = 'M8.1 4 18.6 7.8 8.1 11.6Z'
const STROKE_WIDTH = '2.2'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function MarkerPost({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `mark-post ${className}` : 'mark-post'}
      viewBox={VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d={POST} />
      <path d={PENNANT} fill="currentColor" />
    </svg>
  )
}

/**
 * The same marker for `GlobeView`, which has no React to hand.
 *
 * Built once and cloned, because `labelElement` runs per label per layout and
 * `createElementNS` five times over is five times more than this needs. Built
 * lazily rather than at module scope so importing this file costs nothing in a
 * test with no DOM.
 */
let template: SVGElement | null = null

// oxlint-disable-next-line react/only-export-components
export function markerPostNode(): SVGElement {
  if (!template) {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', 'mark-post')
    svg.setAttribute('viewBox', VIEW_BOX)
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', STROKE_WIDTH)
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')

    const post = document.createElementNS(SVG_NS, 'path')
    post.setAttribute('d', POST)

    const pennant = document.createElementNS(SVG_NS, 'path')
    pennant.setAttribute('d', PENNANT)
    pennant.setAttribute('fill', 'currentColor')

    svg.append(post, pennant)
    template = svg
  }
  return template.cloneNode(true) as SVGElement
}
