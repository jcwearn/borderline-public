/**
 * The rules, once, on a first visit — and afterwards from the help button.
 *
 * Deliberately three steps. The game is simple to play and only interesting to
 * play well, so this covers what the board is for and what things cost, and
 * leaves the rest to be discovered.
 */
import { GRAPH, type CountryCode } from '../game/graph'
import type { Barrier } from '../game/mechanics'
import { MECHANIC_COPY } from './mechanics'

export default function HowToPlay({
  start,
  end,
  par,
  free,
  barrier,
  onDismiss,
}: {
  start: CountryCode
  end: CountryCode
  par: number
  /** Whether this round was built rather than served, which changes one word. */
  free: boolean
  /**
   * The one barrier the fourth step is about — the first this round carries in
   * `MECHANICS` order — or null on a plain hole. Already named, where it is
   * named at all.
   */
  barrier: Barrier | null
  onDismiss: () => void
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="modal notice">
        <p className="modal-eyebrow">Borderline</p>
        <h2>Cross the world by land, in as few countries as you can.</h2>

        <ol className="steps">
          <li>
            <span className="step-no">1</span>
            <div>
              <strong>Type a country that borders one already in play.</strong> Legal moves are lit
              on the globe; build from either end. A few links are sea crossings, which cost +1.
            </div>
          </li>
          <li>
            <span className="step-no">2</span>
            <div>
              <strong>It&apos;s scored like golf.</strong> Par is the shortest route plus a shot —
              two on the hard days. Every extra country costs one, and so does every second wrong
              guess.
            </div>
          </li>
          <li>
            <span className="step-no">3</span>
            <div>
              <strong>
                Can&apos;t name one? Press and <em>hold</em> it.
              </strong>{' '}
              The globe names it and plays it, for +1. Typing what you know is always free.
            </div>
          </li>
          {/* At most one extra step, whatever the round is doing. Three is
              deliberate — the game is simple to play and only interesting to
              play well — and a fourth per mechanic would undo that. Which one
              gets the step is `MECHANICS` order in `src/game/mechanics.ts`:
              dogleg, rough, bounds, closed, least legible from the board first.
              A doubled hole therefore leaves one unsaid here, and `begin` raises
              a modal for it rather than letting the card be taken to have
              covered it. */}
          {barrier && (
            <li>
              <span className="step-no">4</span>
              <div>{MECHANIC_COPY[barrier.mechanic].step(barrier.label ?? '', barrier.plural)}</div>
            </li>
          )}
        </ol>

        {/* "Today" only where it is today's. The rules reach a free round now —
            somebody's first Borderline can be a link a friend sent — and that
            round is not the daily and may not even be from today. */}
        <p className="steps-today">
          {free ? 'This round' : 'Today'}:{' '}
          <span className="from">
            {GRAPH[start].flag} {GRAPH[start].name}
          </span>
          <span aria-hidden> → </span>
          <span className="to">
            {GRAPH[end].flag} {GRAPH[end].name}
          </span>
          <span className="steps-par"> · par {par}</span>
        </p>

        <button type="button" className="share" onClick={onDismiss}>
          Play
        </button>

        {/* Everyone sees this modal once, before their first round, which makes
            it the one place a notice about what is recorded is actually read
            before there is anything to record. A new tab, so a player who opens
            it mid-round comes back to the round rather than to a fresh one. */}
        <p className="modal-fineprint">
          <a href="/privacy.html" target="_blank" rel="noopener">
            Privacy Statement
          </a>
        </p>
      </div>
    </div>
  )
}
