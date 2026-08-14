import { Component, type ErrorInfo, type ReactNode } from 'react'
import { track } from '../analytics'

/**
 * Catches anything the globe throws — a failed chunk load, a WebGL context the
 * machine will not give us — and says what happened.
 *
 * Without this, a throw from inside the lazy boundary takes the whole app down
 * to a blank page, and the player cannot tell that apart from slow loading.
 */
export default class GlobeBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null }

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('globe failed to render', error, info.componentStack)
    // A machine that cannot draw the globe still plays, badly, and says nothing
    // about it to anyone but its own console.
    track('globe_failed', { message: error.message || String(error) })
  }

  render() {
    if (this.state.message !== null) {
      return (
        <div className="globe-failed">
          <p>The globe could not be drawn.</p>
          <p className="globe-failed-detail">{this.state.message}</p>
          <p className="globe-failed-detail">You can still play by typing country names below.</p>
        </div>
      )
    }
    return this.props.children
  }
}
