/**
 * Shown once, the first time a player reaches for a country they cannot name.
 *
 * Buying names is the whole on-ramp, but it is also the only way to lose points
 * without being wrong — so nobody should discover the price by having been
 * charged it seven times.
 */
export default function RevealNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Buying a name">
      <div className="modal notice">
        <p className="modal-eyebrow">Before you do that</p>
        <h2>Buying a name costs you a point.</h2>

        <p className="notice-body">
          The globe will name the country you&apos;re pointing at — and play it, if the move is
          legal — for <strong>+1</strong> on top of the country itself. Typing a name you know stays
          free.
        </p>

        <p className="notice-how">
          <span className="notice-ring" aria-hidden />
          {/* One flex item, not three: the row is the ring and the sentence, and a
              bare <strong> in here becomes a column of its own. */}
          <span>
            Press and <strong>hold</strong> to buy. Let go early and nothing is charged.
          </span>
        </p>

        <button type="button" className="share" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  )
}
