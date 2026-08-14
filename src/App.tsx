import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChainRail from './components/ChainRail'
import GuessInput from './components/GuessInput'
import { GRAPH } from './game/graph'
import { apply, type Source } from './game/actions'
import { destination, origin } from './game/presentation'
import { isRough, newGame, type GameState, type Outcome, type Puzzle } from './game/rules'
import EndpointSwap from './components/EndpointSwap'
import GlobeBoundary from './components/GlobeBoundary'
import FreePlay from './components/FreePlay'
import HowToPlay from './components/HowToPlay'
import { barriersIn, type Mechanic } from './game/mechanics'
import ResultModal from './components/ResultModal'
import RevealNotice from './components/RevealNotice'
import MechanicNotice from './components/MechanicNotice'
import { MarkerPost } from './components/MarkerPost'
import { formatDelta, scorecard } from './game/score'
import { fetchDailyPuzzle } from './daily-client'
import {
  EMPTY_DRAFT,
  assign,
  buildPuzzle,
  draftOf,
  previewOf,
  recipeOfDraft,
  type Draft,
  type Slot,
} from './game/freeplay'
import { readEntry, showDaily, showEntry } from './freeplay-url'
import { loadCountryFeatures, type CountryFeature } from './geometry'
import {
  EMPTY_STATS,
  howToPlaySeen,
  loadFlipped,
  loadMuted,
  loadStats,
  mechanicSeen,
  markHowToPlaySeen,
  markMechanicSeen,
  markRevealNoticeSeen,
  markSupportDismissed,
  recordWin,
  resumeOrStart,
  revealNoticeSeen,
  saveFlipped,
  saveGame,
  saveMuted,
  supportDismissed,
  type Stats,
} from './storage'
import { guessProps, resultProps, roundProps, setRecord, track, trackOnExit } from './analytics'
import { play, setMuted, soundFor } from './audio'
import { useCoarsePointer } from './useCoarsePointer'
import { useElementSize } from './useElementSize'
import './App.css'

// Three.js is most of the bundle, so the globe loads after first paint.
const GlobeView = lazy(() => import('./components/GlobeView'))

/**
 * Finished rounds before the results card mentions a tip. Twenty is about three
 * weeks of turning up, which is long enough that the game has already proved
 * whether it is worth anything — asking a first-time player to pay for something
 * they have not decided they like yet is how the ask becomes an advert.
 *
 * Free rounds do not count towards it, because `rounds` is the daily's record.
 */
const SUPPORT_AFTER_ROUNDS = 20

/** What to tell the player about what just happened. */
function describe(outcome: Outcome): { text: string; tone: 'good' | 'bad' } | null {
  const name = GRAPH[outcome.code]?.name
  if (!name) return null

  if (outcome.placed) {
    // The premium is worth saying out loud at the moment it is charged. The
    // globe marks the rough, but a country typed from memory was never looked
    // at, and a stroke that appears in the score unexplained reads as a bug.
    const rough = isRough(outcome.state, outcome.code) ? ' Rough — that one cost two.' : ''
    return {
      text: (outcome.reveal ? `That's ${name} — placed.` : `${name}. ✓`) + rough,
      tone: 'good',
    }
  }
  // Refused rather than missed: the board would not entertain it, and nothing
  // was charged. Worth saying anyway, because silence after a press reads as a
  // dead control rather than as an answer.
  if (!outcome.miss) {
    // Nothing to keep quiet about here — the name is on the rail already.
    if (outcome.reason === 'already-in-play') {
      return { text: `${name} — already on the board.`, tone: 'bad' }
    }
    if (outcome.reason !== 'closed') return null
    // Anonymous, always: this is a shape the player pressed, and nothing shut
    // is named. It used to name a lone closure, which made the toast the one
    // place a name got out for nothing.
    return { text: 'That one is closed today — nothing to play there.', tone: 'bad' }
  }

  const lead = outcome.reveal ? `That's ${name} — ` : `${name} — `
  const reason =
    outcome.reason === 'closed'
      ? 'the border is closed today.'
      : outcome.reason === 'already-in-play'
        ? 'already on the board.'
        : outcome.reason === 'unreachable'
          ? 'no land route to it at all.'
          : "doesn't border anything you've played."
  return { text: lead + reason, tone: 'bad' }
}

export default function App() {
  const [state, setState] = useState<GameState | null>(null)
  const [features, setFeatures] = useState<CountryFeature[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // The id is what makes two identical messages in a row two messages: it keys
  // the element, so the same words twice remount and replay the fade rather
  // than leaving a pill that already looks spent.
  const [message, setMessage] = useState<{ text: string; tone: string; id: number } | null>(null)
  // How much life the closed-borders notice has left. It holds at `up` for as
  // long as the player has done nothing, because arriving to a hazard you have
  // not read is the case it exists for; `armed` is their first move, and the
  // clock runs from there.
  const [notice, setNotice] = useState<'up' | 'armed' | 'leaving' | 'gone'>('up')
  const [attempt_, setAttempt] = useState(0)
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [showResult, setShowResult] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [muted, setMutedState] = useState(false)
  const [revealsExplained, setRevealsExplained] = useState(true)
  // Starts closed and is opened by `begin` once storage has been read, so a
  // player who has already said no never sees it flash back at them.
  const [supportOffered, setSupportOffered] = useState(false)
  const [showRevealNotice, setShowRevealNotice] = useState(false)
  // Barriers this round carries that the player has never had explained, in
  // `MECHANICS` order, and how far through them they are. Not `notice`, which
  // is the banner's own state machine.
  //
  // The position is in here rather than beside it because the eyebrow reads it:
  // "one more thing" is only true of a modal something preceded, and a queue
  // and a cursor held apart would eventually disagree about that.
  const [explaining, setExplaining] = useState<{ queue: Mechanic[]; at: number }>({
    queue: [],
    at: 0,
  })
  const [explored, setExplored] = useState<ReadonlySet<string>>(new Set())
  const [showHowToPlay, setShowHowToPlay] = useState(false)
  // Where the round came from. Only the daily is saved, scored or counted.
  const [entry, setEntry] = useState(() => readEntry(location.search))
  // A link that names a round goes straight into it; only a bare `?free` opens
  // the builder. Deciding that here rather than after the round is built keeps
  // the form from flashing up for a frame on the way past.
  const [building, setBuilding] = useState(() => {
    const arrived = readEntry(location.search)
    return arrived.mode === 'free' && !arrived.recipe
  })
  // The round being built, and which of its three fields the globe is filling.
  // Up here rather than in the builder because the globe draws it too — the
  // panel and the shapes under it are one decision seen twice. Seeded from a
  // link that names a round, so opening the builder over a shared round is how
  // you take it and change a border rather than start again.
  const [draft, setDraft] = useState<Draft>(() => {
    const arrived = readEntry(location.search)
    return arrived.mode === 'free' && arrived.recipe ? draftOf(arrived.recipe) : EMPTY_DRAFT
  })
  // Whichever field is still empty. Arriving on a link that already names both
  // ends, the thing left to do is shut a border, so that is what is armed.
  const [slot, setSlot] = useState<Slot>(() =>
    !draft.start ? 'start' : !draft.end ? 'end' : 'closed',
  )
  const [stageRef, stageSize] = useElementSize<HTMLDivElement>()
  const touch = useCoarsePointer()

  // Whether the on-screen keypad is up. It lives here because raising it
  // shortens the stage, and the stage is this grid's business. Starts down: the
  // first thing a round should show is the globe, not a keyboard.
  //
  // The globe's canvas is sized off a ResizeObserver, so for exactly one frame
  // after a toggle the footer is at its new height while the canvas is still at
  // the old one. What shows through is the stage's own gradient, which is the
  // same near-black as the space around the globe, so it reads as background.
  const [typing, setTyping] = useState(false)

  // When this round went up on screen, so that how long one takes — and how long
  // an abandoned one lasted — is a measurement rather than a guess. Reset by
  // `begin`, so a resumed game times the sitting rather than the puzzle.
  const startedAt = useRef(0)

  // Everything a round needs on the way in, whoever chose the puzzle. Shared so
  // that starting a free round resets exactly what starting the daily does —
  // the explored set in particular, which would otherwise leak names across.
  const begin = useCallback((next: GameState) => {
    startedAt.current = Date.now()
    // A round that arrives with moves already in it came back out of storage.
    track('round_started', {
      ...roundProps(next),
      resumed: next.placed.length > 0 || next.misses.length > 0,
    })
    // The rules are shown once ever, on a first visit — whoever set the round.
    // This used to be an argument only the daily passed, which meant somebody
    // whose first Borderline was a link a friend sent got no rules at all, and
    // then none afterwards either, since the daily only offers them to a player
    // who has never seen them. A round is a round; every way into one goes
    // through here, so the decision belongs here too.
    const rulesComing = !howToPlaySeen()
    if (rulesComing) setShowHowToPlay(true)
    // What the round is doing that the board cannot say on its own. The banner
    // names today's instance and the globe draws it, but "no route may pass
    // through" and "through, not merely to" are only written down in the rules —
    // and those are shown once ever, while a barrier turns up most days.
    const present = barriersIn(next.puzzle).map((barrier) => barrier.mechanic)
    // On a true first visit the rules card is about to go up, and it shows at
    // most one fourth step: the first in `MECHANICS` order. That one counts as
    // read. The others are neither shown nor marked — a first round raises no
    // notices at all, because a notice renders later in the tree than the card
    // and would paint straight over it. What the card did not say is left for
    // the next round that carries it, which on a doubled hole is the honest
    // answer: marking it would record that somebody read something nobody
    // showed them, and showing it would be two modals deep on a first visit.
    if (rulesComing) present.slice(0, 1).forEach(markMechanicSeen)
    // A resumed round that is already scored is an atlas. The result card is
    // going up over it, and it renders later in the tree, so a notice raised
    // here would be found underneath it afterwards — a rule nobody can still
    // use, delivered as a surprise.
    setExplaining({
      queue:
        rulesComing || next.status === 'won'
          ? []
          : present.filter((mechanic) => !mechanicSeen(mechanic)),
      at: 0,
    })
    setState(next)
    setExplored(new Set())
    setMessage(null)
    setNotice('up')
    setShowResult(false)
    setStats(loadStats())
    setRevealsExplained(revealNoticeSeen())
    setSupportOffered(!supportDismissed())
    setFlipped(loadFlipped())
    setMutedState(loadMuted())
    setMuted(loadMuted())
  }, [])

  useEffect(() => {
    const abort = new AbortController()
    setFailure(null)

    // The globe geometry is wanted whichever mode this is, and must survive a
    // switch between them — it is a megabyte of topology, not round state.
    loadCountryFeatures().then(setFeatures, (error: Error) => setFailure(error.message))

    if (entry.mode === 'free') return () => abort.abort()

    fetchDailyPuzzle(abort.signal).then(
      (puzzle) => {
        // Reload mid-game and you pick up where you left off — but only for
        // today's puzzle, so yesterday's progress never bleeds into it.
        const resumed = resumeOrStart(puzzle)
        begin(resumed)
        // Only the daily resumes, so only the daily can reopen on its
        // scorecard — and not over the rules, which `begin` has just raised if
        // this is a first visit. `howToPlaySeen` is unchanged by `begin`; it is
        // dismissing the card that marks it.
        if (howToPlaySeen() && resumed.status === 'won') setShowResult(true)
      },
      (error: Error) => {
        if (error.name === 'AbortError') return
        setFailure(error.message)
        track('daily_fetch_failed', { message: error.message })
      },
    )
    return () => abort.abort()
  }, [attempt_, entry.mode, begin])

  // A round named in the URL starts straight away, so a link to one is playable
  // rather than merely pre-filling the builder.
  useEffect(() => {
    if (entry.mode !== 'free' || !entry.recipe) return
    const built = buildPuzzle(entry.recipe)
    if ('error' in built) {
      setFailure(`That free play link does not work: ${built.error}`)
      setBuilding(false)
      return
    }
    setBuilding(false)
    begin(newGame(built.puzzle))
  }, [entry, begin])

  // Persist after every move, so closing the tab loses nothing.
  // `saveGame` and `recordWin` both refuse a free puzzle themselves — the guard
  // lives in storage, where it can be tested — so these stay unconditional.
  useEffect(() => {
    if (state) saveGame(state)
  }, [state])

  // Fold the finished game into the record exactly once, then show the card.
  useEffect(() => {
    if (state?.status !== 'won') return
    const record = recordWin(state)
    setStats(record)
    track('round_won', { ...resultProps(state), elapsed_ms: Date.now() - startedAt.current })
    // `recordWin` refuses a free round, so this reports the daily's record only.
    if (!state.puzzle.free) setRecord(record)
    const timer = setTimeout(() => setShowResult(true), 900)
    return () => clearTimeout(timer)
  }, [state?.status, state])

  // Walking away is the one thing a player does that leaves no trace, so it is
  // reported on the way out — otherwise giving up is only visible as an absence,
  // and an absence says nothing about how far in it happened. `pagehide` rather
  // than `unload`, which iOS Safari does not fire at all.
  useEffect(() => {
    if (!state || state.status === 'won') return
    const leave = () => {
      trackOnExit('round_left', {
        ...roundProps(state),
        placed_count: state.placed.length,
        miss_count: state.misses.length,
        reveal_count: state.revealed.length,
        elapsed_ms: Date.now() - startedAt.current,
      })
    }
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [state])

  // Long enough after the first move to still be there if that move was a
  // misfire, short enough that it is not sitting on the map all round.
  useEffect(() => {
    if (notice !== 'armed') return
    const timer = setTimeout(() => setNotice('leaving'), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  // Anything the player does with the round. Touching the globe counts even if
  // the touch plays nothing — a drag to look around is someone underway — and
  // so does a typed guess, or a player who never touches the globe would keep
  // the notice for the whole round, which is the case it is being cleared for.
  const arm = useCallback(() => setNotice((life) => (life === 'up' ? 'armed' : life)), [])

  // What a guess costs depends on where it came from, so the source travels
  // with it. Typing is always free; pointing at the globe may be a purchase.
  const guess = useCallback(
    (code: string, source: Source) => {
      arm()
      setState((current) => {
        if (!current) return current
        const outcome = apply(current, code, source)
        setMessage((previous) => {
          const next = describe(outcome)
          return next && { ...next, id: (previous?.id ?? 0) + 1 }
        })

        // A refusal is reported too — it cost nothing, and how often somebody
        // re-names a country already on the board or presses a shut one is the
        // measure of whether the board is readable. Once the round is scored
        // the globe is an atlas, and a tap on it is none of the three: those
        // carry no reason, and reporting them would bury the moves that cost
        // something under the ones that cannot.
        if (outcome.placed || outcome.miss || outcome.reason) {
          track('guess', guessProps(outcome, source))
        }

        const swing = soundFor(outcome)
        if (swing) play(swing)
        // Let the strike land before the ball drops.
        if (outcome.placed && outcome.won) setTimeout(() => play('holed'), 260)

        return outcome.state
      })
    },
    [arm],
  )

  const guessTyped = useCallback((code: string) => guess(code, 'typed'), [guess])
  const guessFromGlobe = useCallback((code: string) => guess(code, 'globe'), [guess])

  // Which end reads as "from". Changes no rule and no score.
  const swapDirection = useCallback(() => {
    setFlipped((current) => {
      saveFlipped(!current)
      return !current
    })
  }, [])

  const toggleMuted = useCallback(() => {
    setMutedState((current) => {
      const next = !current
      setMuted(next)
      saveMuted(next)
      if (!next) play('place') // so you hear what you just turned back on
      return next
    })
  }, [])

  const playFree = useCallback(
    (puzzle: Puzzle, built: Draft) => {
      const recipe = recipeOfDraft(built)
      if (!recipe) return
      track('free_round_built', {
        start: recipe.start,
        end: recipe.end,
        closed_count: recipe.closed?.length ?? 0,
        rough_count: recipe.rough?.length ?? 0,
        required_count: recipe.required?.length ?? 0,
      })
      showEntry(recipe)
      setEntry({ mode: 'free', recipe })
      setBuilding(false)
      setFailure(null)
      begin(newGame(puzzle))
    },
    [begin],
  )

  // The round underneath is left exactly as it is — `entry` included, since the
  // effects above are keyed on it and touching it would rebuild the very round
  // the player may be about to come back to. Only the URL and the panel move.
  // The draft is left alone too: what you were assembling last time is still
  // there, which is the whole difference between a panel and a screen.
  const openBuilder = useCallback(() => {
    showEntry(null)
    setBuilding(true)
    setFailure(null)
  }, [])

  /**
   * Choosing a country for the round being built.
   *
   * One function for both ways in — a tap on a shape and a name typed into a
   * field — because they are the same decision, and two copies of it would be
   * two chances to disagree about what a second pick of the same country means.
   * What it does to the draft is `assign`'s, and tested there; the advance to
   * the next field is this screen's, and only happens into an empty one, so the
   * form fills itself in as you go without the mark wandering off work in hand.
   */
  const pickForDraft = useCallback(
    (code: string) => {
      setDraft((current) => assign(current, slot, code))
      if (slot !== 'closed' && !draft[slot]) setSlot(slot === 'start' ? 'end' : 'closed')
    },
    [slot, draft],
  )

  const pick = useMemo(() => {
    if (!building) return undefined
    // A painted fairway previews as what it will play as, derived in
    // `previewOf` rather than here: the carve has one spelling, and a copy of
    // it on the preview path would be the one the player is looking at while
    // Play built the other.
    return { draft: previewOf(draft), onPick: pickForDraft }
  }, [building, draft, pickForDraft])

  const backToDaily = useCallback(() => {
    showDaily()
    setEntry({ mode: 'daily' })
    setBuilding(false)
    setState(null)
    setFailure(null)
    setAttempt((n) => n + 1)
  }, [])

  // Shutting the builder without building anything: put back the round it was
  // opened over, still mid-move, and the URL that names it.
  const closeBuilder = useCallback(() => {
    // Unless there is nothing behind it — the player landed straight on a bare
    // `?free`, or the round never loaded. Then the way out is today's puzzle.
    if (!state || (entry.mode === 'free' && !entry.recipe)) {
      backToDaily()
      return
    }
    if (entry.mode === 'free') showEntry(entry.recipe)
    else showDaily()
    setBuilding(false)
  }, [state, entry, backToDaily])

  const dismissHowToPlay = useCallback(() => {
    markHowToPlaySeen()
    setShowHowToPlay(false)
  }, [])

  const dismissSupport = useCallback(() => {
    markSupportDismissed()
    setSupportOffered(false)
  }, [])

  // Marks as it advances rather than up front, which is what lets the queue
  // survive a reload: dismiss the first of two, reload, and `begin` recomputes
  // the queue as exactly the second. Outside the updater, since StrictMode
  // double-invokes those and writing to storage twice is not free of meaning.
  const dismissExplaining = useCallback(() => {
    const dismissed = explaining.queue[explaining.at]
    if (dismissed) markMechanicSeen(dismissed)
    setExplaining((seen) => ({ ...seen, at: seen.at + 1 }))
  }, [explaining])

  const explainReveals = useCallback(() => setShowRevealNotice(true), [])

  const dismissRevealNotice = useCallback(() => {
    markRevealNoticeSeen()
    setRevealsExplained(true)
    setShowRevealNotice(false)
  }, [])

  // Once the round is scored, the globe stops being a board and becomes an
  // atlas: pointing at a country simply names it, free and unrecorded. Kept out
  // of GameState so nothing here can move the score that has already been filed.
  const explore = useCallback((code: string) => {
    setExplored((current) => (current.has(code) ? current : new Set(current).add(code)))
  }, [])

  // Naming the country here would be the very thing the player has not paid for.
  const holdTooShort = useCallback(() => {
    setMessage((previous) => ({
      text: "Hold to buy that country's name — it costs +1.",
      tone: 'bad',
      id: (previous?.id ?? 0) + 1,
    }))
  }, [])

  // Both of these replace the app — unless the builder is open over the top,
  // which is the one thing on this screen that works with no round behind it
  // at all. It has its own globe to pick on and its own way back to today.
  if (failure && !building) {
    return (
      <div className="app splash">
        <div>
          <h1>Borderline</h1>
          <p className="failure">{failure}</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
          <button type="button" className="linkish" onClick={openBuilder}>
            Free play
          </button>
        </div>
      </div>
    )
  }

  if (!state && !building) {
    return (
      <div className="app splash">
        <div>
          <h1>Borderline</h1>
          <p className="loading-text">Fetching today&apos;s puzzle…</p>
        </div>
      </div>
    )
  }

  const card = state && scorecard(state)
  const won = state?.status === 'won'
  // What this round is doing and what to call it, from the one place that
  // decides — including the line between a border or two shut and a place ruled
  // off altogether, and the is/are agreement, which is settled there because
  // nothing here is reachable from a test.
  const barriers = state ? barriersIn(state.puzzle) : []
  const barrierOf = (mechanic: Mechanic) =>
    barriers.find((barrier) => barrier.mechanic === mechanic) ?? null
  const shut = barrierOf('closed')
  const ruledOff = barrierOf('bounds')
  const rough = barrierOf('rough')
  // Also a boolean: the course is drawn, not counted. When this is up, `shut`,
  // `ruledOff` and `rough` are all null — the classifier stands them down so
  // the one pill speaks for the whole shape of the day.
  const onFairway = barriers.some((barrier) => barrier.mechanic === 'fairway')
  // A boolean and never a name: the waypoint is the one thing on the board the
  // round is deliberately not telling anybody. The globe marks it, this says
  // only that there is one.
  const hasVia = barriers.some((barrier) => barrier.mechanic === 'dogleg')
  const explainingNow = explaining.queue[explaining.at] ?? null
  // Anything holding the keyboard, now that a doubled hole can queue two
  // explanations behind each other.
  const modalUp = showHowToPlay || showRevealNotice || explainingNow !== null

  return (
    // `building` is on the shell because on a phone the builder is not an
    // overlay but a mode: see the coarse-pointer block in App.css.
    <div className={building ? 'app building' : 'app'}>
      <header className="topbar">
        <div className="brand">
          <h1>Borderline</h1>
          {state &&
            (state.puzzle.free ? (
              <button type="button" className="puzzle-no linkish" onClick={backToDaily}>
                Free play · back to today
              </button>
            ) : (
              <span className="puzzle-no">#{state.puzzle.id}</span>
            ))}
        </div>

        {state && (
          <EndpointSwap
            origin={origin(state, flipped)}
            destination={destination(state, flipped)}
            onSwap={swapDirection}
          />
        )}

        <button
          type="button"
          className="mute"
          onClick={building ? closeBuilder : openBuilder}
          aria-pressed={building}
          aria-label="Free play"
          title="Free play — build your own round"
        >
          {/* 19 at stroke 2.2, where every other icon in the bar is 17 at 2. The
              two beside it are a question mark and a speaker, which are read as
              labels; this one is the only thing up here that makes something,
              and a plus is legible in a way a drawing is not. It used to be a
              route with a plus above it — five units of this viewBox, which at
              17px is three and a half pixels of hairline, so the one mark the
              button is named for was the one you could not see. */}
          <svg
            viewBox="0 0 24 24"
            width="19"
            height="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

        {/* The rules are the round's, and read off it — with no round loaded
            there is nothing for them to be about. */}
        <button
          type="button"
          className="mute"
          onClick={() => setShowHowToPlay(true)}
          disabled={!state}
          aria-label="How to play"
          title="How to play"
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
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M9.2 9.3a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" />
            <path d="M12 17.5v.01" />
          </svg>
        </button>

        <button
          type="button"
          className="mute"
          onClick={toggleMuted}
          aria-pressed={muted}
          aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
          title={muted ? 'Sound off' : 'Sound on'}
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
            aria-hidden
          >
            <path d="M11 5 6 9H3v6h3l5 4z" />
            {muted ? (
              <>
                <path d="m17 9 4 6" />
                <path d="m21 9-4 6" />
              </>
            ) : (
              <>
                <path d="M16 9a4 4 0 0 1 0 6" />
                <path d="M19 6.5a8 8 0 0 1 0 11" />
              </>
            )}
          </svg>
        </button>

        {card && (
          <dl className="scores">
            <div>
              <dt>Par</dt>
              <dd>{card.par}</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>
                {card.score} <small>{formatDelta(card.delta)}</small>
              </dd>
            </div>
            <div>
              <dt>Misses</dt>
              <dd>
                {card.misses}
                {card.missPenalty > 0 && <small>+{card.missPenalty}</small>}
              </dd>
            </div>
            <div>
              <dt>Reveals</dt>
              <dd>
                {card.reveals}
                {card.revealPenalty > 0 && <small>+{card.revealPenalty}</small>}
              </dd>
            </div>
          </dl>
        )}
      </header>

      {/* The globe fills the stage, and both things floating over it are
          `pointer-events: none`, so a press landing here is a press on the
          globe — which is all "the player has started" needs to mean. */}
      <div className="stage" ref={stageRef} onPointerDown={arm}>
        {features && stageSize.width > 0 ? (
          <GlobeBoundary>
            <Suspense fallback={<p className="loading">Drawing the globe…</p>}>
              <GlobeView
                state={state ?? undefined}
                features={features}
                pick={pick}
                flipped={flipped}
                onSelect={guessFromGlobe}
                onExplore={explore}
                explored={explored}
                onExplainReveals={explainReveals}
                revealsExplained={revealsExplained}
                onHoldTooShort={holdTooShort}
                touch={touch}
                width={stageSize.width}
                height={stageSize.height}
              />
            </Suspense>
          </GlobeBoundary>
        ) : (
          // Distinct wording from the Suspense fallback above: if this one
          // sticks, the stage never got measured; if that one sticks, the
          // chunk never arrived.
          <p className="loading">Measuring…</p>
        )}

        {/* These speak for the round underneath, which the builder is not about
            — today's hazard over a draft of your own reads as a rule you are
            being held to.

            Outlasts a toast rather than being one: the hazard is a fact about
            the hole that stays true all round, and a player who arrives to it
            cold otherwise has to infer it from a red shape. It goes only once
            they are underway, by which point the shape says it too. */}
        {!building && notice !== 'gone' && barriers.length > 0 && (
          // Written out rather than looped over `barriers`: each has its own
          // sentence and its own colour, and the order here is the order to
          // read them in — what the round has done to the map, then what it
          // wants of you. `MECHANICS` order is the other way round, the dogleg
          // first. The stack is what keeps them off each other; nothing here
          // knows what else is up, and after `.notice-stack` nothing needs to.
          <div className="notice-stack">
            {onFairway && (
              <p
                className={
                  notice === 'leaving' ? 'closed-notice fairway leaving' : 'closed-notice fairway'
                }
                onAnimationEnd={() => setNotice('gone')}
              >
                <span aria-hidden>⛳</span> Only the fairway is open today — the rough costs two,
                and past it is out of bounds
              </p>
            )}

            {shut && (
              <p
                className={
                  notice === 'leaving' ? 'closed-notice shut leaving' : 'closed-notice shut'
                }
                onAnimationEnd={() => setNotice('gone')}
              >
                <span aria-hidden>⛔</span> {shut.label} {shut.plural ? 'are' : 'is'} closed today
              </p>
            )}

            {ruledOff && (
              <p
                className={
                  notice === 'leaving' ? 'closed-notice shut leaving' : 'closed-notice shut'
                }
                onAnimationEnd={() => setNotice('gone')}
              >
                <span aria-hidden>⛔</span> {ruledOff.label} {ruledOff.plural ? 'are' : 'is'} out of
                bounds today
              </p>
            )}

            {hasVia && (
              <p
                className={notice === 'leaving' ? 'closed-notice via leaving' : 'closed-notice via'}
                onAnimationEnd={() => setNotice('gone')}
              >
                <MarkerPost /> Your route has to run through the marked country
              </p>
            )}

            {rough && (
              <p
                className={
                  notice === 'leaving' ? 'closed-notice rough leaving' : 'closed-notice rough'
                }
                onAnimationEnd={() => setNotice('gone')}
              >
                <span aria-hidden>⛰</span> {rough.label} {rough.plural ? 'are' : 'is'} rough today —
                costs two to cross
              </p>
            )}
          </div>
        )}

        {/* Keyed, so the same words twice are two toasts. The fade is the whole
            clock — see `toast-life` in App.css — and its end is what clears the
            message, which is why nothing here holds a timer. */}
        {!building && message && (
          <p
            key={message.id}
            className={`toast ${message.tone}`}
            role="status"
            onAnimationEnd={() => setMessage((m) => (m?.id === message.id ? null : m))}
          >
            {message.text}
          </p>
        )}
      </div>

      {state && (
        <footer className="controls">
          <ChainRail state={state} flipped={flipped} />

          {won && card ? (
            <p className="verdict">
              Joined up in {card.countries} {card.countries === 1 ? 'country' : 'countries'} —
              scored {card.score} against a par of {card.par} ({formatDelta(card.delta)}).{' '}
              <button type="button" className="linkish" onClick={() => setShowResult(true)}>
                See result
              </button>
            </p>
          ) : (
            <div className="entry">
              <GuessInput
                onGuess={guessTyped}
                placeholder="Name a country…"
                touch={touch}
                open={typing}
                onOpenChange={setTyping}
                // A modal that is up owns the keyboard: typing into the rules
                // would otherwise fill a field nobody can see. The builder is
                // the same case — its own three fields want those letters.
                captureTyping={!modalUp && !building}
              />
            </div>
          )}

          {/* The rules go without saying on a phone, where every line of them is
              a line of globe. They are still one tap away under the ? button. */}
          {(won || !touch) && (
            <p className="hint-note">
              {won ? (
                <>
                  Round over — tap any country to see what it&apos;s called. Nothing costs anything
                  now.
                </>
              ) : (
                <>
                  Anywhere you could legally go is lit. Know it? Type it — free. Don&apos;t? Press
                  and <strong>hold</strong> the shape to buy its name for +1.
                </>
              )}
            </p>
          )}
        </footer>
      )}

      {building && (
        <FreePlay
          draft={draft}
          slot={slot}
          onPick={pickForDraft}
          onDraft={setDraft}
          onSlot={setSlot}
          onPlay={playFree}
          onCancel={backToDaily}
          onClose={closeBuilder}
        />
      )}

      {state && showHowToPlay && (
        <HowToPlay
          start={origin(state, flipped)}
          end={destination(state, flipped)}
          par={state.puzzle.par}
          free={state.puzzle.free ?? false}
          barrier={barriers[0] ?? null}
          onDismiss={dismissHowToPlay}
        />
      )}

      {showRevealNotice && <RevealNotice onDismiss={dismissRevealNotice} />}
      {/* Keyed, so the second of two remounts rather than swapping its text
          inside a node the first one left behind. */}
      {explainingNow && (
        <MechanicNotice
          key={explainingNow}
          mechanic={explainingNow}
          first={explaining.at === 0}
          onDismiss={dismissExplaining}
        />
      )}

      {state && showResult && won && (
        <ResultModal
          state={state}
          stats={stats}
          showSupport={supportOffered && stats.rounds >= SUPPORT_AFTER_ROUNDS}
          onDismissSupport={dismissSupport}
          onClose={() => setShowResult(false)}
        />
      )}
    </div>
  )
}
