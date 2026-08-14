/**
 * Shown once per barrier, the first time a player is actually handed one.
 *
 * The rules modal covers these too, in its fourth step — but that is shown once
 * ever, on a first visit, and it only ever shows one step. So somebody who
 * started in March and meets their first region out of bounds in June would get
 * four seconds of banner and a grey shape, and nothing anywhere saying that no
 * route may pass through it either.
 *
 * Deliberately not the rules. It explains one mechanic to someone already
 * mid-round and already holding the rest — which is why the copy is generic and
 * never names today's region. The banner behind it does that, and stays up while
 * this is open, so the two are read back to back.
 */
import { MECHANIC_COPY } from './mechanics'
import type { Mechanic } from '../game/mechanics'

export default function MechanicNotice({
  mechanic,
  first,
  onDismiss,
}: {
  mechanic: Mechanic
  /** Whether anything preceded it this round. Only the eyebrow cares. */
  first: boolean
  onDismiss: () => void
}) {
  const copy = MECHANIC_COPY[mechanic]
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={copy.label}>
      <div className="modal notice">
        {/* Not "new today": a shared link is a round somebody else set, and this
            is just as likely to be the first one somebody meets. The second on a
            doubled hole says something else, because opening the same way twice
            in a row reads as a stutter rather than as a second thing. */}
        <p className="modal-eyebrow">{first ? 'This hole is different' : 'One more thing'}</p>
        <h2>{copy.title}</h2>

        {copy.body}

        <button type="button" className="share" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  )
}
