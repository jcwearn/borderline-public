/**
 * The ring that closes around the pointer while buying a country's name.
 *
 * A press that costs a point should take a moment and be visibly refusable —
 * a plain click is far too easy to spend seven of by accident.
 *
 * Under a mouse the ring is the cursor. Under a thumb it would be *behind* the
 * thumb: a fingertip covers some fifty pixels of glass, which is the whole ring
 * and then some. So on touch it grows and rides above the contact patch, where
 * the one thing the ring exists to do — show the press is being counted — can
 * actually be seen.
 */
const RADIUS = 21
const TOUCH_RADIUS = 30

export default function HoldRing({
  x,
  y,
  progress,
  lifted,
}: {
  x: number
  y: number
  /** 0 to 1. */
  progress: number
  lifted?: boolean
}) {
  const radius = lifted ? TOUCH_RADIUS : RADIUS
  const circumference = 2 * Math.PI * radius
  const stroke = lifted ? 4 : 3
  const size = (radius + stroke + 1) * 2

  return (
    <svg
      className={lifted ? 'hold-ring lifted' : 'hold-ring'}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ left: x, top: y }}
      aria-hidden
    >
      <circle
        className="hold-ring-track"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        className="hold-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}
