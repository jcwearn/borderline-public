/**
 * The keyboard the game brings with it.
 *
 * A phone's own keyboard costs three hundred pixels and takes the scorecard off
 * the top of the screen with it, so on touch the game types itself. Layout and
 * typing rules live in `../keys`; this only draws them.
 */
import { BACKSPACE, KEY_ROWS, SPACE, type Key } from '../keys'

function describe(key: Key): string {
  if (key.value === SPACE) return 'Space'
  if (key.value === BACKSPACE) return 'Backspace'
  return key.value
}

export default function Keypad({ onKey }: { onKey: (value: string) => void }) {
  return (
    <div className="keypad">
      {KEY_ROWS.map((row, index) => (
        <div key={index} className="keypad-row">
          {row.keys.map((key, position) => (
            <button
              key={key.value}
              type="button"
              className={key.span > 2 ? 'key key-wide' : 'key'}
              style={{
                gridColumn:
                  position === 0 ? `${row.offset + 1} / span ${key.span}` : `span ${key.span}`,
              }}
              aria-label={describe(key)}
              // A real keyboard inserts under the finger, not on release, and
              // the default action here is everything we don't want: focus
              // moving off the bar, text selection, the page scrolling.
              onPointerDown={(event) => {
                event.preventDefault()
                onKey(key.value)
              }}
              // VoiceOver's double-tap synthesises a click with no pointer
              // events behind it, so the same key has to answer both. A real
              // tap's click carries a detail count; the synthetic one doesn't.
              onClick={(event) => {
                if (event.detail === 0) onKey(key.value)
              }}
            >
              {key.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
