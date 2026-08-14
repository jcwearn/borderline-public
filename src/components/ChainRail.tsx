/**
 * The round as a chain through everywhere it has to run.
 *
 * Shows only what the player has earned: placed countries are named, a stretch
 * still to be built is an anonymous `?`. On an ordinary hole that is the two
 * ends and the gap closing between them. On a dogleg it is
 * `Portugal — ? — ⚑ — ? — Finland` — a bend is owed, somewhere the globe is
 * already showing them, and the name of it is the hole.
 *
 * What goes where is decided in `presentation.ts`, because it is a judgement
 * about the rules and no rule belongs in a component. This draws the answer.
 */
import { GRAPH } from '../game/graph'
import { railView, type RailLink } from '../game/presentation'
import { isSea, type GameState } from '../game/rules'
import { MarkerPost } from './MarkerPost'

function Chip({ code, kind }: { code: string; kind: string }) {
  return (
    <span className={`chip ${kind}`}>
      <span className="flag">{GRAPH[code].flag}</span>
      <span className="chip-name">{GRAPH[code].name}</span>
    </span>
  )
}

/**
 * The waypoint before it has been named.
 *
 * Neither the flag nor the name, and the flag is the part worth spelling out:
 * `.chip-name` is hidden under `(hover: none) and (pointer: coarse)`, so on a
 * phone a chip carrying both would collapse to a lone flag and hand over the
 * one country the round is asking for. `.chip-anon` is always drawn.
 *
 * The stake alone, where it used to be a stake and a `?`. An empty chip on a
 * chain of named ones is already a question; the mark says which question, and
 * the `?` beside it only said it twice.
 */
function AnonChip() {
  return (
    <span className="chip required">
      <span className="chip-anon" aria-label="somewhere your route still has to run through">
        <MarkerPost />
      </span>
    </span>
  )
}

/** A crossing is drawn as water: the one link that cost more than a step. */
function Link({ from, to }: { from: string; to: string }) {
  const sea = isSea(from, to)
  return <span className={sea ? 'link sea' : 'link'} aria-label={sea ? 'by sea' : undefined} />
}

/** The countries of one stretch, or the gap still to be closed. */
function Stretch({ link, from, to }: { link: RailLink; from: string; to: string }) {
  if ('joined' in link) {
    const walk = [from, ...link.joined, to]
    return (
      <>
        {link.joined.map((code, index) => (
          <span key={code} className="rail-step">
            <Link from={walk[index]} to={code} />
            <Chip code={code} kind="placed" />
          </span>
        ))}
        <Link from={walk[walk.length - 2]} to={to} />
      </>
    )
  }

  const { fromLeft, fromRight } = link.gap
  return (
    <>
      {fromLeft.map((code) => (
        <span key={code} className="rail-step">
          <span className="link" aria-hidden />
          <Chip code={code} kind="placed" />
        </span>
      ))}
      <span className="gap" aria-label="not yet joined">
        <span className="link dashed" aria-hidden />?<span className="link dashed" aria-hidden />
      </span>
      {[...fromRight].reverse().map((code) => (
        <span key={code} className="rail-step">
          <Chip code={code} kind="placed" />
          <span className="link" aria-hidden />
        </span>
      ))}
    </>
  )
}

const SPARE_LABEL = { wasted: "Didn't need", aside: 'Off to the side' } as const

export default function ChainRail({
  state,
  flipped = false,
}: {
  state: GameState
  flipped?: boolean
}) {
  const { anchors, links, spare, spareLabel } = railView(state, flipped)
  const last = anchors.length - 1

  /** The two ends are what they are; the waypoint is placed once it is named. */
  const kindOf = (at: number) => (at === 0 ? 'start' : at === last ? 'end' : 'placed')

  return (
    <div className="rail">
      <div className="rail-run">
        {anchors.map(({ code, hidden }, at) => (
          <span key={code} className="rail-step">
            {hidden ? <AnonChip /> : <Chip code={code} kind={kindOf(at)} />}
            {at < last && <Stretch link={links[at]} from={code} to={anchors[at + 1].code} />}
          </span>
        ))}
      </div>
      {spare.length > 0 && (
        <div className="rail-wasted">
          <span className="rail-note">{SPARE_LABEL[spareLabel]}</span>
          {spare.map((code) => (
            <Chip key={code} code={code} kind="wasted" />
          ))}
        </div>
      )}
    </div>
  )
}
