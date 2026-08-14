/**
 * Typing a country in.
 *
 * The free path: naming a country from memory costs nothing, which is what
 * makes buying a name on the globe a real decision. Autocomplete only forgives
 * spelling — it matches official names and alternates too, so "UK", "Holland",
 * "UAE" and "Turkiye" all land.
 *
 * On a touch device none of that is an `<input>`. iOS opens its keyboard for a
 * focusable field and then scrolls the page to reach it, which is what pushed
 * the whole scorecard off the top of the screen — so there is nothing to focus
 * here, only a bar that reads back what you typed and a keypad of our own. That
 * is the answer for the game screen, where there is a scorecard to lose; the
 * free play builder passes no `touch` and takes the real keyboard.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { GRAPH, type CountryCode } from '../game/graph'
import { search, type Match } from '../game/search'
import { applyKey } from '../keys'
import Keypad from './Keypad'

type Props = {
  onGuess: (code: CountryCode) => void
  disabled?: boolean
  placeholder?: string
  /** Coarse pointer: our own keys, and chips in place of the dropdown. */
  touch?: boolean
  /** Whether the keypad is up. Owned by App — it decides how big the globe is. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Take a letter typed with nothing focused. Opt-in rather than always on: the
   * builder puts three of these on one screen, and they would all answer.
   */
  captureTyping?: boolean
  /**
   * Reaching for this field. The builder has three, and which one you are in is
   * also what the globe is filling — so going to one has to say so.
   */
  onFocus?: () => void
}

export default function GuessInput({
  onGuess,
  disabled,
  placeholder,
  touch,
  open,
  onOpenChange,
  captureTyping,
  onFocus,
}: Props) {
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => search(query), [query])
  const active = matches[Math.min(highlighted, matches.length - 1)]

  function submit(match: Match | undefined) {
    if (!match) return
    onGuess(match.code)
    setQuery('')
    setHighlighted(0)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((current) => Math.min(current + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      submit(active)
    } else if (event.key === 'Escape') {
      // Whoever is listening above — the free play builder closes on Escape —
      // only gets the key once there is nothing left here to clear.
      if (query) event.stopPropagation()
      setQuery('')
      setHighlighted(0)
    }
  }

  /**
   * Just start typing. The field is the only thing on the page that wants a
   * letter, so hunting for it with the mouse first is a step for nothing.
   *
   * The letter is appended here rather than left to the default action landing
   * in the newly focused field, which browsers disagree about. Only letters
   * qualify: digits and punctuation are nobody's first keystroke of a country
   * name, and stealing them would take a browser shortcut with them.
   */
  useEffect(() => {
    if (touch || disabled || !captureTyping) return

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (!/^\p{L}$/u.test(event.key)) return
      const focused = document.activeElement
      if (
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        (focused instanceof HTMLElement && focused.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      input.current?.focus()
      setQuery((current) => current + event.key)
      setHighlighted(0)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [touch, disabled, captureTyping])

  const prompt = placeholder ?? 'Name a country…'

  if (touch) {
    return (
      <div className="guess guess-touch">
        <div className="guess-bar">
          <button
            type="button"
            className="guess-bar-toggle"
            disabled={disabled}
            aria-expanded={open}
            aria-controls="keypad"
            onClick={() => onOpenChange?.(!open)}
          >
            {/* With the keys up, the prompt is said twice — once here and once
                under the strip — so the bar keeps only the caret. */}
            <span
              className={query ? 'guess-text' : 'guess-text empty'}
              role="textbox"
              aria-readonly="true"
              aria-label={query ? `Typed: ${query}` : prompt}
            >
              {query || (open ? '' : prompt)}
            </span>
            {open && <span className="guess-caret" aria-hidden />}
            <svg
              className={open ? 'guess-chevron down' : 'guess-chevron'}
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m6 15 6-6 6 6" />
            </svg>
          </button>
          {query && (
            <button
              type="button"
              className="guess-clear"
              aria-label="Clear what you typed"
              onClick={() => setQuery('')}
            >
              ✕
            </button>
          )}
        </div>

        {open && (
          <div id="keypad" className="keypad-block">
            {/* Holds its height whether or not anything matches: a strip that
                came and went per keystroke would resize the stage, and the
                globe's canvas with it, on every letter. */}
            <div className="suggestion-strip" role="listbox" aria-label="Matching countries">
              {matches.length > 0 ? (
                matches.map((match) => (
                  <button
                    key={match.code}
                    type="button"
                    className="suggestion-chip"
                    role="option"
                    aria-selected="false"
                    onClick={() => submit(match)}
                  >
                    <span className="flag">{GRAPH[match.code].flag}</span>
                    {match.name}
                  </button>
                ))
              ) : (
                <span className="suggestion-empty">
                  {query ? 'No country by that name' : 'Type a country name'}
                </span>
              )}
            </div>
            <Keypad onKey={(value) => setQuery((current) => applyKey(current, value))} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="guess">
      <input
        ref={input}
        value={query}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value)
          setHighlighted(0)
        }}
        onKeyDown={handleKeyDown}
        onFocus={onFocus}
        placeholder={prompt}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Name a country to place"
      />
      {matches.length > 0 && (
        <ul className="suggestions" role="listbox">
          {matches.map((match, index) => (
            <li key={match.code}>
              <button
                type="button"
                className={match === active ? 'suggestion active' : 'suggestion'}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => {
                  submit(match)
                  input.current?.focus()
                }}
              >
                <span className="flag">{GRAPH[match.code].flag}</span>
                {match.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
