/**
 * The two endpoints, and the button that swaps which one you read as "from".
 *
 * Purely presentational. The endpoints are interchangeable — a placement is
 * legal against either and the score counts neither — so this changes nothing
 * but the direction the puzzle reads in.
 */
import { useState } from 'react'
import { GRAPH, type CountryCode } from '../game/graph'

export default function EndpointSwap({
  origin,
  destination,
  onSwap,
}: {
  origin: CountryCode
  destination: CountryCode
  onSwap: () => void
}) {
  // Accumulated so the icon keeps turning the same way rather than snapping
  // back on every other press.
  const [turns, setTurns] = useState(0)

  return (
    <div className="endpoints-swap">
      <div className="endpoint-field from">
        {/* Keyed on the country so React remounts it and the animation replays. */}
        <span key={origin} className="endpoint-name arrive-from-right">
          <span className="flag">{GRAPH[origin].flag}</span>
          {GRAPH[origin].name}
        </span>
      </div>

      <button
        type="button"
        className="swap-button"
        onClick={() => {
          setTurns((n) => n + 1)
          onSwap()
        }}
        aria-label={`Swap direction — read it as ${GRAPH[destination].name} to ${GRAPH[origin].name}`}
        title="Swap direction"
      >
        <svg
          viewBox="0 0 24 24"
          width="17"
          height="17"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: `rotate(${turns * 180}deg)` }}
          aria-hidden
        >
          <path d="M7 10h13l-3.5-3.5" />
          <path d="M17 14H4l3.5 3.5" />
        </svg>
      </button>

      <div className="endpoint-field to">
        <span key={destination} className="endpoint-name arrive-from-left">
          <span className="flag">{GRAPH[destination].flag}</span>
          {GRAPH[destination].name}
        </span>
      </div>
    </div>
  )
}
