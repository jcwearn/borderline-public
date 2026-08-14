import { useCallback, useRef, useState } from 'react'

/**
 * Track an element's size.
 *
 * A callback ref rather than `useRef` plus an effect, because the element this
 * measures is behind an early return — it does not exist on the first render.
 * An effect with `[]` deps would run once against a null ref, bail out, and
 * never attach, leaving the size pinned at zero forever.
 */
export function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const observer = useRef<ResizeObserver | null>(null)

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!node) return

    // Seed from layout so the first paint after mounting already has a size,
    // rather than waiting a frame for the observer to fire.
    const { width, height } = node.getBoundingClientRect()
    setSize({ width: Math.round(width), height: Math.round(height) })

    observer.current = new ResizeObserver(([entry]) => {
      const box = entry.contentRect
      setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.current.observe(node)
  }, [])

  return [ref, size] as const
}
