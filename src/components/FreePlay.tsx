/**
 * Building your own puzzle.
 *
 * Deliberately thin: everything that could be wrong about a puzzle is decided
 * in `src/game/freeplay.ts`, which is testable, and this only collects three
 * fields and shows what that module says. The rule of the codebase is that no
 * rule lives in a component, and a builder is exactly where one would try to.
 * What a pick does to the draft is `assign`, for the same reason — the globe
 * and these fields are two ways into one decision and must not disagree.
 *
 * A panel over the game rather than a screen instead of it. The globe behind is
 * the same instance the round was using, still where the player left it, and
 * while this is open it colours the draft: the field marked below is the one a
 * tap on a country fills. That is the whole point of the panel — closing a
 * border is a thing you do to a map, and the old form had no map on it.
 *
 * **Only the two ends are named here, and only they can be typed.** A round
 * withholds every other country it uses, so a builder that spelled them out
 * would be the one screen where the answers are written down — and the screen
 * immediately before somebody plays. Closures, rough and the waypoint are
 * chosen by pointing, held as anonymous chips, and named only where a whole
 * curated region is, which names a place rather than its members.
 *
 * The two fields that remain are real inputs on a phone, unlike the one on the
 * game screen. What the game's own keypad protects is the scorecard above the
 * globe, which iOS scrolls away to reach a focused field — and the panel
 * scrolls anyway. Giving this the keypad instead cost it its keyboard and left
 * nothing that could be typed into at all.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { GRAPH, type CountryCode } from '../game/graph'
import {
  EMPTY_DRAFT,
  assignRegion,
  buildPuzzle,
  isEmptyDraft,
  randomRecipe,
  recipeOfDraft,
  type Draft,
  type Slot,
} from '../game/freeplay'
import { REGIONS, boundsFor, regionOf, roughFor, type Region } from '../game/regions'
import { FAIRWAY_LIMIT, type Puzzle } from '../game/rules'
import GuessInput from './GuessInput'
import { MarkerPost } from './MarkerPost'

/** An endpoint: the two countries a round is allowed to say out loud. */
function Chip({ code, onRemove }: { code: CountryCode; onRemove?: () => void }) {
  return (
    <span className="chip placed">
      <span className="flag">{GRAPH[code].flag}</span>
      <span className="chip-name">{GRAPH[code].name}</span>
      {onRemove && (
        <button
          type="button"
          className="chip-remove"
          onClick={onRemove}
          aria-label={`Remove ${GRAPH[code].name}`}
        >
          ×
        </button>
      )}
    </span>
  )
}

/**
 * Everything else: one country, kept to itself.
 *
 * The marker goes in `.chip-anon` and never in `.chip-name`, for the reason
 * `ChainRail` gives — `.chip-name` is hidden under
 * `(hover: none) and (pointer: coarse)`, so a chip carrying a flag and a hidden
 * marker collapses to a lone flag on a phone, and a flag is a country's name.
 * These carry no flag at all.
 */
function AnonChip({
  kind,
  mark,
  what,
  onRemove,
}: {
  kind: string
  /** A glyph, or the drawn marker the waypoint uses. Never a name. */
  mark: ReactNode
  /** What it is, for a screen reader and for the remove button. */
  what: string
  onRemove: () => void
}) {
  return (
    <span className={`chip ${kind}`}>
      <span className="chip-anon" aria-label={what}>
        {mark}
      </span>
      <button
        type="button"
        className="chip-remove"
        onClick={onRemove}
        aria-label={`Remove ${what}`}
      >
        ×
      </button>
    </span>
  )
}

/**
 * One field's worth of hazard: the region if the player took one, a single
 * chip for the whole list once it is past being a list, and otherwise a chip
 * apiece.
 *
 * The middle case is what a carve reopened from a link arrives as. A `Recipe`
 * carries no corridor, and a generated course has had its band repaired — so
 * `draftOf` cannot always give the corridor back, and the round comes in as the
 * ~130 closures it plays as. A chip per country is not an editable round: it is
 * a wall of identical shapes in which removing any one of them silently breaks
 * the carve, with nothing to say which. One chip says the true thing about it
 * and offers the only edit that leaves a coherent round behind — take the whole
 * thing off and paint something else.
 *
 * `FAIRWAY_LIMIT` is the threshold because it is already the line where a
 * closure stops being some shut borders and becomes the shape of the round.
 */
function HazardChips({
  codes,
  kind,
  mark,
  what,
  region,
  onChange,
}: {
  codes: CountryCode[]
  kind: string
  mark: string
  what: { one: string; many: (count: number) => string }
  region?: Region
  onChange: (codes: CountryCode[]) => void
}) {
  if (region) return <RegionChip region={region} kind={kind} onRemove={() => onChange([])} />
  if (codes.length > FAIRWAY_LIMIT) {
    return (
      <AnonChip
        kind={kind}
        mark={`${mark.split(' ')[0]} ${codes.length}`}
        what={what.many(codes.length)}
        onRemove={() => onChange([])}
      />
    )
  }
  return codes.map((code) => (
    <AnonChip
      key={code}
      kind={kind}
      mark={mark}
      what={what.one}
      onRemove={() => onChange(codes.filter((other) => other !== code))}
    />
  ))
}

/** A whole region, which names a place rather than the countries in it. */
function RegionChip({
  region,
  kind,
  onRemove,
}: {
  region: Region
  kind: string
  onRemove: () => void
}) {
  return (
    <span className={`chip ${kind}`}>
      <span className="chip-name">{region.name}</span>
      <button
        type="button"
        className="chip-remove"
        onClick={onRemove}
        aria-label={`Remove ${region.name}`}
      >
        ×
      </button>
    </span>
  )
}

export default function FreePlay({
  draft,
  slot,
  onPick,
  onDraft,
  onSlot,
  onPlay,
  onCancel,
  onClose,
}: {
  /** The round being assembled. Held by App, because the globe draws it too. */
  draft: Draft
  /** Which field the next country goes into, wherever it is picked. */
  slot: Slot
  /** Choosing a country. The same one the globe calls — see App. */
  onPick: (code: CountryCode) => void
  onDraft: (draft: Draft) => void
  onSlot: (slot: Slot) => void
  onPlay: (puzzle: Puzzle, draft: Draft) => void
  /** Leave for today's puzzle, whatever was on screen before. */
  onCancel: () => void
  /** Put back the round the builder was opened from. */
  onClose: () => void
}) {
  const { start, end, closed, rough, required, fairway } = draft

  // The one piece of state here, and it decides nothing: the fields keep their
  // own half-typed text, which the draft has never heard of, so clearing the
  // form has to remount them to empty it. A token, not a rule.
  const [cleared, setCleared] = useState(0)

  // Keyed on the fields rather than on the draft, which is a new object every
  // render in the caller and would rebuild the puzzle on every keystroke.
  // Through `recipeOfDraft` rather than straight to `buildPuzzle`, because a
  // painted fairway compiles to closed and rough there and nowhere else.
  const built = useMemo(() => {
    if (!start || !end) return null
    const recipe = recipeOfDraft({ start, end, closed, rough, required, fairway })
    return recipe && buildPuzzle(recipe)
  }, [start, end, closed, rough, required, fairway])
  const puzzle = built && 'puzzle' in built ? built.puzzle : null

  // While a fairway is being painted the closed and rough fields are derived
  // ground, so the mark cannot sit on them — App advances it to `closed` after
  // the second endpoint, which is reachable with a corridor already down. This
  // moves it; `assign` is what refuses the pick, because a rule enforced only
  // by a component is a rule the next way in does not have.
  useEffect(() => {
    if (fairway.length > 0 && (slot === 'closed' || slot === 'rough')) onSlot('fairway')
  }, [fairway.length, slot, onSlot])

  // Escape leaves the builder. A field with something in it takes the key
  // first, to clear itself, so this only ever fires on an empty form.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // What each region would do to this route, priced over the *open* route: a
  // figure that changed every time a hazard was taken would be no help at all.
  // Every region is offered either way — a dropdown that grew and shrank as the
  // draft changed would be a different list of twelve things each time — and
  // the ones missing from these maps are simply the ones that change nothing.
  const roughGain = useMemo(
    () =>
      start && end && puzzle
        ? new Map(roughFor(start, end).map((option) => [option.region.name, option.best]))
        : new Map<string, number>(),
    [start, end, puzzle],
  )

  const boundsGain = useMemo(
    () =>
      start && end && puzzle
        ? new Map(boundsFor(start, end).map((option) => [option.region.name, option.best]))
        : new Map<string, number>(),
    [start, end, puzzle],
  )

  /**
   * The whole region a field holds, if the player took one — the only thing
   * below the two ends that gets a name here, and the same call `placeNamed`
   * makes for the banner. A place is not the countries in it.
   */
  const roughRegion = useMemo(() => regionOf(rough), [rough])
  const closedRegion = useMemo(() => regionOf(closed), [closed])

  /** Back to a blank form, aimed where a freshly opened one is. */
  function clear() {
    onDraft(EMPTY_DRAFT)
    onSlot('start')
    setCleared((count) => count + 1)
  }

  function shuffle(crossing: boolean) {
    const next = randomRecipe({ crossing })
    onDraft({ ...EMPTY_DRAFT, start: next.start, end: next.end })
    onSlot('closed')
  }

  /** One field: its name is also the button that aims the globe at it. */
  function label(which: Slot, text: string) {
    return (
      <button
        type="button"
        className="free-slot"
        aria-pressed={slot === which}
        onClick={() => onSlot(which)}
      >
        {text}
      </button>
    )
  }

  /** The invitation to point, which is how every field but the two ends fills. */
  function aim(which: Slot) {
    return (
      <button type="button" className="free-aim linkish" onClick={() => onSlot(which)}>
        Tap a country on the globe…
      </button>
    )
  }

  /**
   * Every curated region, on the field it belongs to. All twelve rather than
   * the handful that bite: this is the only place the builder names anything
   * beyond the two ends, and a list that reshuffled itself as the draft changed
   * would be a different menu every time. What each one would do to the route
   * rides along where it does anything.
   */
  function regionPicker(which: 'closed' | 'rough', gain: Map<string, number>, held?: Region) {
    return (
      <select
        className="free-region"
        value={held?.name ?? ''}
        onChange={(event) => {
          const region = REGIONS.find((one) => one.name === event.target.value)
          if (!region) return
          onSlot(which)
          onDraft(assignRegion(draft, which, region.countries))
        }}
        aria-label={which === 'rough' ? 'Roughen a whole region' : 'Rule off a whole region'}
      >
        <option value="">Or a whole region…</option>
        {REGIONS.map((region) => {
          const best = gain.get(region.name)
          return (
            <option key={region.name} value={region.name}>
              {region.name}
              {best === undefined ? '' : ` → ${best}`}
            </option>
          )
        })}
      </select>
    )
  }

  return (
    <aside className="free-drawer" aria-label="Free play">
      <div className="free-panel">
        <div className="free-head">
          <h1>Free play</h1>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="free-note">
          Tap a country on the globe to fill the field you have picked out. Only the two ends can be
          typed — everything else a round does is meant to be a shape, not a word. Nothing here
          counts towards your record or touches today&apos;s puzzle.
        </p>

        <div className={slot === 'start' ? 'free-field aimed' : 'free-field'}>
          {label('start', 'From')}
          {start ? (
            <Chip code={start} onRemove={() => onDraft({ ...draft, start: null })} />
          ) : (
            <GuessInput
              key={cleared}
              onGuess={onPick}
              onFocus={() => onSlot('start')}
              placeholder="Start country…"
            />
          )}
        </div>

        <div className={slot === 'end' ? 'free-field aimed' : 'free-field'}>
          {label('end', 'To')}
          {end ? (
            <Chip code={end} onRemove={() => onDraft({ ...draft, end: null })} />
          ) : (
            <GuessInput
              key={cleared}
              onGuess={onPick}
              onFocus={() => onSlot('end')}
              placeholder="End country…"
            />
          )}
        </div>

        {/* From here down there is nothing to type into, and that is the rule
            rather than an omission: what a round does to the map is withheld
            from whoever plays it, so a box to spell it into would make the
            builder the one place the answers are words. Point at the globe, or
            take a whole region by name — which names a place, not its members. */}
        <div className={slot === 'fairway' ? 'free-field aimed' : 'free-field'}>
          {label('fairway', 'Fairway')}
          <div className="free-hazards">
            {fairway.length > 0 && (
              <AnonChip
                kind="placed"
                mark={`⛳ ${fairway.length}`}
                what={`a fairway of ${fairway.length} ${fairway.length === 1 ? 'country' : 'countries'}`}
                onRemove={() => onDraft({ ...draft, fairway: [] })}
              />
            )}
            {aim('fairway')}
          </div>
        </div>

        {fairway.length > 0 ? (
          // Painted course: the two hazard fields are no longer the player's
          // to fill — everything with a border into the corridor is the rough
          // band, and the rest of the world is out of bounds. Said here, where
          // the fields would be, so their disappearance reads as a consequence
          // rather than a bug.
          <p className="free-note">
            The band beside the fairway is rough{puzzle?.rough ? ` (${puzzle.rough.length})` : ''};
            everything further is out of bounds{puzzle?.closed ? ` (${puzzle.closed.length})` : ''}.
          </p>
        ) : (
          <>
            <div className={slot === 'closed' ? 'free-field aimed' : 'free-field'}>
              {label('closed', 'Closed')}
              <div className="free-hazards">
                <HazardChips
                  codes={closed}
                  kind="placed"
                  mark="⛔ ?"
                  what={{
                    one: 'a closed country',
                    many: (count) => `${count} closed countries`,
                  }}
                  region={closedRegion ?? undefined}
                  onChange={(next) => onDraft({ ...draft, closed: next })}
                />
                {aim('closed')}
                {regionPicker('closed', boundsGain, closedRegion)}
              </div>
            </div>

            <div className={slot === 'rough' ? 'free-field aimed' : 'free-field'}>
              {label('rough', 'Rough')}
              <div className="free-hazards">
                {/* One chip for a whole region, because that is what was chosen —
                listing five countries says less than naming the Maghreb. */}
                <HazardChips
                  codes={rough}
                  kind="rough"
                  mark="⛰ ?"
                  what={{
                    one: 'a rough country',
                    many: (count) => `${count} rough countries`,
                  }}
                  region={roughRegion ?? undefined}
                  onChange={(next) => onDraft({ ...draft, rough: next })}
                />
                {aim('rough')}
                {regionPicker('rough', roughGain, roughRegion)}
              </div>
            </div>
          </>
        )}

        <div className={slot === 'required' ? 'free-field aimed' : 'free-field'}>
          {label('required', 'Via')}
          <div className="free-hazards">
            {required.map((code) => (
              <AnonChip
                key={code}
                kind="required"
                mark={<MarkerPost />}
                what="the country to run through"
                onRemove={() => onDraft({ ...draft, required: [] })}
              />
            ))}
            {/* The one field where this goes away once it is filled: `required`
                replaces rather than accumulates, so there is never a second. */}
            {required.length === 0 && aim('required')}
          </div>
        </div>

        {/* Where a list of the closures worth making used to be. It named five
            countries and priced them, which is the leak this panel is now built
            to avoid — and it was the last thing read before Play. The regions
            above carry what survives of it; anything narrower has to be found on
            the globe, which is where the round will be played from anyway. */}

        <p className="free-verdict">
          {built && 'error' in built && <span className="free-error">{built.error}</span>}
          {puzzle && (
            <span>
              Shortest route {puzzle.best}, par {puzzle.par}.
            </span>
          )}
          {!built && <span className="free-error">Pick two countries.</span>}
        </p>

        <div className="free-actions">
          <button type="button" className="linkish" onClick={() => shuffle(false)}>
            Random
          </button>
          <button type="button" className="linkish" onClick={() => shuffle(true)}>
            Random with a crossing
          </button>
          <button type="button" className="linkish" disabled={isEmptyDraft(draft)} onClick={clear}>
            Clear
          </button>
          <button type="button" className="linkish" onClick={onCancel}>
            Back to today
          </button>
        </div>

        <button
          type="button"
          className="share"
          disabled={!puzzle}
          onClick={() => puzzle && onPlay(puzzle, draft)}
        >
          Play this
        </button>
      </div>
    </aside>
  )
}
