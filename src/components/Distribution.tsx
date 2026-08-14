/**
 * How your rounds have gone, by how far off par they landed.
 *
 * The data has been accumulating since the first win — this only draws it.
 */
import { histogram, rowFor } from '../game/score'

export default function Distribution({
  distribution,
  /** This round, highlighted so the card reads as a scoreboard. */
  currentDelta,
}: {
  distribution: Record<string, number>
  currentDelta: number
}) {
  const rows = histogram(distribution)
  const most = Math.max(1, ...rows.map((row) => row.count))
  const current = rowFor(currentDelta)

  return (
    <div className="distribution">
      <p className="distribution-title">Your rounds</p>
      {rows.map((row, index) => (
        <div key={row.label} className={index === current ? 'dist-row current' : 'dist-row'}>
          <span className="dist-label">{row.label}</span>
          <span className="dist-track">
            <span
              className="dist-bar"
              // A zero row still shows a sliver, so the scale stays readable.
              style={{ width: `${Math.max(2, (row.count / most) * 100)}%` }}
            />
          </span>
          <span className="dist-count">{row.count}</span>
        </div>
      ))}
    </div>
  )
}
