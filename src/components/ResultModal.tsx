/**
 * The results card. Breaks the score down so the two penalties are legible,
 * because how a round was lost matters more than the number.
 */
import { useState } from 'react'
import { roundProps, track } from '../analytics'
import { GRAPH } from '../game/graph'
import type { GameState } from '../game/rules'
import { formatDelta, scorecard, verdict } from '../game/score'
import { shareResult, shareText } from '../game/share'
import Distribution from './Distribution'
import type { Stats } from '../storage'

/**
 * A plain link, not Buy Me a Coffee's embed widget. The widget is a third-party
 * script that sets cookies on a page whose whole privacy posture is that it does
 * not — and it would load for everybody, including the players who are never
 * measured. An anchor costs nothing until it is followed.
 */
const BUY_ME_A_COFFEE = 'https://buymeacoffee.com/borderline.golf'

type Props = {
  state: GameState
  stats: Stats
  /** Whether this player has played enough rounds to be asked, and not said no. */
  showSupport: boolean
  onDismissSupport: () => void
  onClose: () => void
}

export default function ResultModal({
  state,
  stats,
  showSupport,
  onDismissSupport,
  onClose,
}: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  const card = scorecard(state)
  const start = GRAPH[state.puzzle.start]
  const end = GRAPH[state.puzzle.end]
  const free = Boolean(state.puzzle.free)

  async function share() {
    const outcome = await shareResult(shareText(state))
    track('share_clicked', { ...roundProps(state), outcome, delta: card.delta })
    setCopied(outcome === 'shared' ? 'Shared' : 'Copied to clipboard')
    setTimeout(() => setCopied(null), 2200)
  }

  // `rounds` on both, because the question the pair answers is whether the ask
  // arrives at the right time — a dismissal on the twentieth round and one on
  // the hundredth are not the same answer.
  function supportProps() {
    return { ...roundProps(state), delta: card.delta, rounds: stats.rounds }
  }

  function dismissSupport() {
    track('support_dismissed', supportProps())
    onDismissSupport()
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Result">
      <div className="modal">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <p className="modal-eyebrow">
          {free ? 'Borderline · free play' : `Borderline #${state.puzzle.id}`}
        </p>
        <h2>
          {start.flag} {start.name} <span aria-hidden>→</span> {end.flag} {end.name}
        </h2>

        <p className="modal-score">
          {card.score}
          <span className="modal-delta">{formatDelta(card.delta)}</span>
        </p>
        <p className="modal-par">{verdict(card)}</p>

        <dl className="breakdown">
          <div>
            <dt>Countries</dt>
            <dd>{card.countries}</dd>
          </div>
          {card.crossings > 0 && (
            // Crossings cost, so leaving them off made the parts of the score
            // fail to add up to the total with nothing on screen to explain it.
            <div>
              <dt>Crossings</dt>
              <dd>
                {card.crossings} <small>+{card.crossingPenalty}</small>
              </dd>
            </div>
          )}
          <div>
            <dt>Misses</dt>
            <dd>
              {card.misses} {card.missPenalty > 0 && <small>+{card.missPenalty}</small>}
            </dd>
          </div>
          <div>
            <dt>Reveals</dt>
            <dd>
              {card.reveals} {card.revealPenalty > 0 && <small>+{card.revealPenalty}</small>}
            </dd>
          </div>
        </dl>

        {/* The record is the daily's. A free round is not in it, and showing a
            streak next to a score that did not affect it would suggest it did. */}
        {!free && (
          <>
            <dl className="breakdown record">
              <div>
                <dt>Rounds</dt>
                <dd>{stats.rounds}</dd>
              </div>
              <div>
                <dt>Streak</dt>
                <dd>{stats.currentStreak}</dd>
              </div>
              <div>
                <dt>Best streak</dt>
                <dd>{stats.maxStreak}</dd>
              </div>
            </dl>

            <Distribution distribution={stats.distribution} currentDelta={card.delta} />
          </>
        )}

        <button type="button" className="share" onClick={share}>
          {copied ?? 'Share result'}
        </button>

        {/* Under the share button, in the same footnote the privacy link uses on
            the rules screen: the game has just been enjoyed, which is the only
            honest moment to ask, and a footnote is as loud as the ask should
            get. The × is what stops it being an advert — see storage.ts. */}
        {showSupport && (
          <p className="modal-fineprint">
            <a
              href={BUY_ME_A_COFFEE}
              target="_blank"
              rel="noopener"
              onClick={() => track('support_clicked', supportProps())}
            >
              Enjoying Borderline? Buy me a coffee
            </a>
            <button
              type="button"
              className="fineprint-dismiss"
              onClick={dismissSupport}
              aria-label="Don't ask again"
              title="Don't ask again"
            >
              ×
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
