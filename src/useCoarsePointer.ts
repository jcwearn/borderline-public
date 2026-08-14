import { useSyncExternalStore } from 'react'

const QUERY = '(hover: none) and (pointer: coarse)'

/**
 * Whether this is a touch device — no hover, no fine pointer.
 *
 * This decides the whole input model rather than a few cosmetics. On a coarse
 * pointer the game renders no text field at all, because the only reliable way
 * to stop iOS Safari opening its keyboard — and then scrolling the page up to
 * reach the focused field, which is what threw the scorecard off the top of the
 * screen — is to give it nothing focusable to scroll to.
 *
 * Read synchronously rather than from an effect: a first paint of the desktop
 * layout would be a first paint with a real input in it, and the keyboard would
 * be up before the correction landed.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}

/** The same question asked once, outside React — see `src/analytics.ts`. */
export function isCoarsePointer(): boolean {
  return snapshot()
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function snapshot(): boolean {
  return window.matchMedia(QUERY).matches
}

function serverSnapshot(): boolean {
  return false
}
