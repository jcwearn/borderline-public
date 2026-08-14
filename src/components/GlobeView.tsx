/**
 * The globe.
 *
 * Deliberately unlabeled: a country's name is drawn only once the player has
 * earned it — by placing it, or by paying to reveal it. Hover outlines a shape
 * but never names it, so pointing at somewhere you cannot identify stays a
 * genuine gamble.
 *
 * It does two jobs. Most of the time it is the board. While the free-play
 * builder is open it is the picker for the round being built — same instance,
 * never remounted, because tearing down a three.js scene to put an identical
 * one back is a visible stutter on a phone and loses the camera the player set.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import * as THREE from 'three'
import crossings from '../data/crossings.json' with { type: 'json' }
import { EMPTY_DRAFT, type Draft } from '../game/freeplay'
import { GRAPH, type CountryCode } from '../game/graph'
import {
  crossingMatters,
  draftRoleResolver,
  draftTerrainResolver,
  roleResolver,
  terrainResolver,
  visibleLabels,
  waypointLabel,
  type Label,
  type Role,
} from '../game/presentation'
import { isClosed, isNamed, type GameState } from '../game/rules'
import { fitLabels, type CountryFeature } from '../geometry'
import HoldRing from './HoldRing'
import { markerPostNode } from './MarkerPost'
import { roughMaterial } from './roughFill'

const OCEAN = '#0d1428'
const STROKE = 'rgba(12, 18, 36, 0.9)'
const STROKE_LIT = 'rgba(232, 236, 248, 0.75)'

/**
 * The edge of the rough, once the hatch is doing the talking.
 *
 * This was gold and alone, and it did not work: an outline reads as *selected*
 * rather than as ground, and gold sat a shade from the amber the start endpoint
 * already wears, so a rough region looked like something the player had chosen.
 * The hatch in `roughFill.ts` carries the meaning now, and the edge only has to
 * close the shape — so it is the same warm brown as the bands, dark enough to
 * be an edge and nowhere near any colour that means something else.
 */
const STROKE_ROUGH = 'rgba(122, 84, 52, 0.95)'

/** The extruded wall every country stands on. */
const SIDE = 'rgba(20, 28, 54, 0.9)'

/*
 * The rough deliberately has no lift of its own, and this was tried the other
 * way. Raising it made a mirror of the closure — sunk for a hole in the board,
 * proud for ground you climb over — and the argument was better than the
 * result: the extra height threw a wall around the whole region, which read as
 * a plateau the route had to get on top of rather than as ground it crosses,
 * and the shadow on the near edge fought the hatch that was already saying it.
 *
 * A country's height means one thing here, which is what it is to the round:
 * placed, lit, an end. The rough is not one of those, so it borrows none of it.
 */

/**
 * One vocabulary, said once: green is the route you have built, blue is where
 * you may go next, amber and pink are the two ends, purple is a name you bought,
 * grey is shut. `available` is deliberately a lit version of `unknown` rather
 * than a second green — a legal move is the same anonymous shape with a light on
 * it, and green that meant both "yours" and "open" read as neither.
 *
 * That leaves no blue for the far end, which is why it is pink: with every legal
 * move lit blue, a blue destination was one more lit shape, and it is what the
 * whole round is aimed at. Cyan was the other candidate and sits too close to
 * the mint of the placed route.
 */
const FILL: Record<Role, string> = {
  inert: 'rgba(30, 38, 66, 0.55)',
  unknown: 'rgba(58, 70, 112, 0.85)',
  known: 'rgba(120, 106, 168, 0.9)',
  placed: 'rgba(90, 209, 160, 0.92)',
  start: 'rgba(242, 177, 52, 0.95)',
  end: 'rgba(240, 118, 178, 0.95)',
  available: 'rgba(112, 148, 226, 0.9)',
  // Neutral, and the only shape on the board with no colour in it at all: a
  // closure is not a country you failed to place, it is one nobody can, so it
  // reads as absence rather than as danger, and red is left meaning only
  // "wrong". Light rather than dark, which is the deliberate part — a darker
  // grey receded until a coastal closure was lost against the ocean, and the
  // hole in the route is worth seeing from across the globe. What keeps it from
  // reading as playable is the lift: alone among the roles, it is sunk.
  closed: 'rgba(112, 116, 130, 0.92)',
  // Bone, and chosen by elimination as much as by taste. A waypoint is a third
  // marked place, so it has to read alongside amber and pink without becoming a
  // third endpoint: cyan sits too near the mint of the route, violet too near
  // the purple of a bought name, and red is kept meaning only "wrong". Nothing
  // else on this globe is close to white, so a pale shape reads as marked out
  // rather than as any of the states a country can otherwise be in.
  required: 'rgba(232, 226, 208, 0.95)',
}

/** Brighter than `available`, since it now has to read on a lit shape too. */
const HOVER_FILL = 'rgba(162, 194, 252, 0.95)'

const LIFT: Record<Role, number> = {
  inert: 0.004,
  unknown: 0.006,
  available: 0.013,
  known: 0.008,
  placed: 0.02,
  start: 0.028,
  end: 0.028,
  // Sunk rather than raised, so a hazard reads as a hole in the board.
  closed: 0.005,
  // As high as the two ends, because it is the same kind of thing: somewhere
  // the round has to get to. Once it is reached the role becomes `placed` and
  // it drops to the height of the route, which is the dogleg being turned.
  required: 0.028,
}

/** How much the shape under the pointer stands off its resting height. */
const HOVER_LIFT = 0.008

/**
 * Whether the pointer does anything to this role. The two ends, the route and a
 * closure are already saying what they are, and a shape that lit up under the
 * pointer regardless would say the pointer matters where it does not.
 */
function hoverable(role: Role): boolean {
  return role === 'unknown' || role === 'available'
}

/** Where a name floats, clear of the lift on the shape underneath it. */
const LABEL_ALTITUDE = 0.032

const CROSSING_COLOR = 'rgba(138, 198, 255, 0.8)'

/** Kilometres between two [lat, lng] points, as the crow flies. */
function greatCircle([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const rad = Math.PI / 180
  const half =
    0.5 -
    Math.cos((lat2 - lat1) * rad) / 2 +
    (Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * (1 - Math.cos((lng2 - lng1) * rad))) / 2
  return 2 * 6371 * Math.asin(Math.sqrt(half))
}

type Crossing = { link: [string, string]; from: [number, number]; to: [number, number] }

/**
 * Every sea crossing, drawn as a dashed arc lifting off the globe.
 *
 * Load-bearing rather than decorative. The globe draws no other edges because
 * it does not have to — a land border is visible from orbit — but a crossing is
 * not, so without these a player has no way to know Japan can be reached from
 * South Korea, and the mechanic reads as a bug. Drawn on the water instead of
 * over it turned out to be much harder to pick out, hence the lift.
 *
 * Between the two coasts the crossing is really made at, not the countries'
 * middles: centroids ran the Bering Strait from Siberia to Kansas. It gives
 * nothing away — both ends stay as anonymous as any other shape.
 *
 * The lift has a floor, because auto-scaling it by length would leave the
 * shortest crossings — the 43 km Channel, the 51 km Palk Strait — flat against
 * the globe and invisible, which is the problem this is here to solve.
 */
const CROSSINGS = (crossings as Crossing[]).map(({ link, from, to }) => ({
  link,
  startLat: from[0],
  startLng: from[1],
  endLat: to[0],
  endLng: to[1],
  altitude: Math.min(0.12, Math.max(0.035, greatCircle(from, to) / 12000)),
}))

/** A name's height on screen: the dot, the gap, and one line of text. */
const LABEL_HEIGHT = 24

/** Clear air demanded between two names before both are drawn. */
const LABEL_GAP = 5

/**
 * How much of the visible face counts as "the player can see it".
 *
 * The globe shows a circular cap, but the stage is a rectangle inside it, so
 * anything out towards the limb is off the edges of the screen or too far
 * foreshortened to read. Two thirds of the way out is a safe line.
 */
const ON_SCREEN = 0.66

const DEG = Math.PI / 180

/** Great-circle angle between two points on the globe, in degrees. */
function angleBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const cosine =
    Math.sin(aLat * DEG) * Math.sin(bLat * DEG) +
    Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.cos((bLng - aLng) * DEG)
  return Math.acos(Math.min(1, Math.max(-1, cosine))) / DEG
}

/** How far round the curve you can see from a given altitude, in degrees. */
function horizon(altitude: number): number {
  return Math.acos(1 / (1 + altitude)) / DEG
}

/**
 * The width a name will actually take on screen.
 *
 * Measured against the real stylesheet rather than estimated from the character
 * count, because the collision test is only as good as the widths going into
 * it — and "Bosnia and Herzegovina" against "Chad" is not a difference any
 * average-glyph-width guess survives. One hidden span, one measurement per
 * name, kept for the life of the page.
 *
 * The waypoint's marker goes through the same span rather than being added on
 * as a constant afterwards, because its width is set in `em` by the stylesheet
 * and a number written here would be free to drift away from it.
 */
const widths = new Map<string, number>()
let ruler: HTMLElement | null = null

/**
 * What goes inside one label's name span.
 *
 * Written once because it is built twice — painted by `labelElement` and
 * measured by `labelWidth` — and the collision test is only honest while the
 * two agree. The space before a marked name is a node rather than a margin for
 * the same reason: the ruler is a bare `.globe-label-name` with no role class
 * on any ancestor, so a rule scoped to the waypoint would be missing from the
 * measurement and present in the paint.
 */
function nameNodes(name: string, marked: boolean): Node[] {
  const nodes: Node[] = []
  if (marked) nodes.push(markerPostNode())
  if (name) nodes.push(document.createTextNode(marked ? ` ${name}` : name))
  return nodes
}

function labelWidth(name: string, marked: boolean): number {
  const key = marked ? `⚑${name}` : name
  const known = widths.get(key)
  if (known !== undefined) return known

  if (!ruler) {
    ruler = document.createElement('span')
    ruler.className = 'globe-label-name'
    ruler.style.cssText =
      'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap'
    document.body.appendChild(ruler)
  }
  ruler.replaceChildren(...nameNodes(name, marked))

  const width = ruler.getBoundingClientRect().width
  widths.set(key, width)
  return width
}

function sameCodes(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((code) => b.has(code))
}

/**
 * One name on the globe: a dot on the country's centre, and the name under it.
 *
 * These are real DOM nodes rather than text drawn into the scene, because a
 * name is nearly always wider than the country it belongs to — "Montenegro"
 * spills over half the Adriatic — so it has to stay legible against the ocean
 * and against a bright fill at the same time. Only CSS can put a halo behind
 * text. The styling lives in `App.css` under `.globe-label`.
 *
 * The waypoint takes a marker as well, and the role is the whole test: it is
 * still `required` once the name has been bought and stops being `required` the
 * moment the country is played, so the stake stays on the shape for exactly as
 * long as the round still owes it a visit. The marker goes *inside* the name's
 * span rather than beside it as a third child, which leaves the dot-above-name
 * grid in `App.css` alone and keeps the halo behind both.
 *
 * Before the name is earned the waypoint is the stake and nothing else — no
 * dot, and no `?` under it. The dot exists to say which point a name belongs
 * to, which is a job a stake planted on the country already does; drawn as well
 * it was a second mark saying the same thing, and the `?` a third.
 *
 * That case gets `globe-label-mark` as well, because a lone stake has to be
 * centred on the country and an inline one is not: the span still carries the
 * font's ascent and descent around it, so the stake sat high in a box taller
 * than itself and the anchor landed under empty space. The class turns the box
 * off. See `App.css`.
 */
function labelElement(datum: object): HTMLElement {
  const { name, role } = datum as Label
  const element = document.createElement('div')
  element.className = `globe-label globe-label-${role}`
  if (!name) element.classList.add('globe-label-mark')

  const text = document.createElement('span')
  text.className = 'globe-label-name'
  text.append(...nameNodes(name, role === 'required'))

  if (name) {
    const dot = document.createElement('span')
    dot.className = 'globe-label-dot'
    element.append(dot)
  }
  element.append(text)
  return element
}

/** How long a press must be held before a name is bought. */
const HOLD_MS = 620

/** Move further than this and the press becomes a drag of the globe instead. */
const DRAG_TOLERANCE = 9

const NOTHING: ReadonlySet<string> = new Set()

/**
 * `state` and `pick` are what decide which job this is doing. Three shapes are
 * passed, and no fourth: a round with no builder over it, a round with one, and
 * a builder with no round behind it at all — which is what a cold `?free` link
 * is, and the reason the round's half is optional rather than required.
 */
type Props = {
  /** The round on the board, if one has loaded. */
  state?: GameState
  features: CountryFeature[]
  /**
   * The builder is open: colour the draft it is assembling, and send every
   * click to it. What is underneath — a round, or nothing — is left alone, so
   * closing the builder puts the board back exactly as it was, camera included.
   */
  pick?: { draft: Draft; onPick: (code: CountryCode) => void }
  /** Which endpoint reads as the origin. Colouring only — no rule depends on it. */
  flipped?: boolean
  onSelect?: (code: string) => void
  /**
   * A country the player pointed at after the round was over. Free, and outside
   * the game entirely — nothing is placed and nothing is scored.
   */
  onExplore?: (code: string) => void
  /** Names the player has asked for since winning. */
  explored?: ReadonlySet<string>
  /**
   * The player reached for an unnamed country before being told what it costs.
   * Nothing is charged; the caller explains first.
   */
  onExplainReveals?: () => void
  /** Whether that explanation has already been given. */
  revealsExplained?: boolean
  /** A press too brief to buy anything. */
  onHoldTooShort?: (code: string) => void
  /** Coarse pointer — the ring has to clear the finger that is drawing it. */
  touch: boolean
  width: number
  height: number
}

export default function GlobeView({
  state,
  features,
  pick,
  flipped = false,
  onSelect,
  onExplore,
  explored = NOTHING,
  onExplainReveals,
  revealsExplained = true,
  onHoldTooShort,
  touch,
  width,
  height,
}: Props) {
  const globe = useRef<GlobeMethods | undefined>(undefined)
  const [hovered, setHovered] = useState<CountryFeature | null>(null)
  const [hold, setHold] = useState<{ code: string; x: number; y: number } | null>(null)
  const [progress, setProgress] = useState(0)

  /** Set once a hold completes, so the click that follows is not also acted on. */
  const consumed = useRef(false)
  const origin = useRef({ x: 0, y: 0 })

  const won = !pick && state?.status === 'won'

  // One pass over the board per state, rather than once per polygon.
  const roleOfShape = useMemo(() => {
    if (pick) return draftRoleResolver(pick.draft)
    if (state) return roleResolver(state, flipped, explored)
    // No round and no builder: there is nothing to say about any shape yet.
    return draftRoleResolver(EMPTY_DRAFT)
  }, [pick, state, flipped, explored])

  // Most crossings cannot bear on a given puzzle at all, and drawing them
  // anyway is clutter standing over water the round will never touch. Recomputed
  // per move rather than per frame, since hovering must not pay for it.
  //
  // The builder gets all of them: `crossingMatters` answers "could this round
  // use it", and a round being assembled has no route to answer against — while
  // an island's only way off the map is exactly what you want to see before
  // making it an endpoint.
  const shownCrossings = useMemo(
    () =>
      state && !pick
        ? CROSSINGS.filter(({ link }) => crossingMatters(state, link[0], link[1]))
        : CROSSINGS,
    [state, pick],
  )

  /**
   * Whether the pointer does anything to this shape right now. Picking answers
   * differently from playing: every country is a legal choice, including the
   * ones already chosen, since tapping one again is how it is given back.
   */
  const respondsToPointer = useCallback(
    (role: Role) => (pick ? role !== 'inert' : hoverable(role)),
    [pick],
  )

  const capColor = useCallback(
    (shape: object) => {
      const role = roleOfShape((shape as CountryFeature).code)
      // Amber, pink and grey are already answers, and lighting one would paint
      // over the very thing the player is pointing at to check.
      if (shape === hovered && respondsToPointer(role) && (!pick || role === 'unknown'))
        return HOVER_FILL
      return FILL[role]
    },
    [roleOfShape, hovered, respondsToPointer, pick],
  )

  const terrainOfShape = useMemo(() => {
    if (pick) return draftTerrainResolver(pick.draft)
    if (state) return terrainResolver(state)
    return draftTerrainResolver(EMPTY_DRAFT)
  }, [pick, state])

  const strokeColor = useCallback(
    (shape: object) =>
      shape === hovered
        ? STROKE_LIT
        : terrainOfShape((shape as CountryFeature).code) === 'rough'
          ? STROKE_ROUGH
          : STROKE,
    [hovered, terrainOfShape],
  )

  const altitude = useCallback(
    (shape: object) => {
      const role = roleOfShape((shape as CountryFeature).code)
      if (shape === hovered && respondsToPointer(role)) return LIFT[role] + HOVER_LIFT
      return LIFT[role]
    },
    [roleOfShape, hovered, respondsToPointer],
  )

  /**
   * A hatched material for the rough, and nothing for everywhere else.
   *
   * Returning nothing is not a fallthrough that happens to work: three-globe
   * reads `capMaterial || __defaultCapMaterial`, so an absent one leaves the
   * ordinary colour-driven material in place. Only the rough pays for a texture.
   *
   * Colour transitions are unaffected, which is worth saying because it looks
   * like it should be a cost: `polygonsTransitionDuration` animates altitude
   * alone, and the fill has always been set outright.
   */
  const capMaterial = useCallback(
    (shape: object) => {
      const code = (shape as CountryFeature).code
      if (!code || terrainOfShape(code) !== 'rough') return undefined
      return roughMaterial(FILL[roleOfShape(code)])
    },
    [terrainOfShape, roleOfShape],
  )

  /**
   * Typed as always returning a material, but three-globe reads the accessor as
   * `capMaterial || __defaultCapMaterial` — so "nothing for this shape" is part
   * of the contract even though the types cannot say it.
   */
  const capMaterialProp = capMaterial as unknown as (shape: object) => THREE.Material

  /**
   * Names, drawn only where the player has earned them. The decision lives in
   * `presentation.ts` and is tested there — a leak would be invisible here.
   *
   * Ordered by what the player would least like to lose, because that is the
   * order the layout below drops them in when they will not all fit: the
   * waypoint, then the two endpoints, then the route in the order it was built,
   * then everything else.
   *
   * The waypoint outranks even the ends, and it is the one entry here that is
   * not a name — `waypointLabel` adds it, carrying a `?`. Dropping it would
   * leave a round whose notice says to run through the marked country with
   * nothing on the globe marking one, which is worse than losing any single
   * name: a name the player has earned can be read off the rail instead.
   *
   * None at all while picking. The builder names what you chose in its own
   * fields, and a globe that named the shapes would be a different game — the
   * one where you can read the answer off the map.
   */
  const labels = useMemo(() => {
    if (pick || !state) return []
    const rank = (label: Label) => {
      if (label.role === 'required') return -2
      if (label.role === 'start' || label.role === 'end') return -1
      const played = state.placed.indexOf(label.code)
      return played === -1 ? state.placed.length : played
    }
    const marker = waypointLabel(state, flipped, explored)
    const named = visibleLabels(state, flipped, explored)
    return (marker ? [marker, ...named] : named).sort((a, b) => rank(a) - rank(b))
  }, [pick, state, flipped, explored])

  /** Names that currently have the room to be drawn. See `layoutLabels`. */
  const [fitted, setFitted] = useState<ReadonlySet<string>>(new Set())
  const layoutFrame = useRef(0)

  const shown = useMemo(() => labels.filter((l) => fitted.has(l.code)), [labels, fitted])

  /**
   * Work out which names fit at the camera's current position.
   *
   * A name is constant-size on screen while the world under it is not, so
   * whether two of them collide is a question only the live camera can answer.
   */
  const layoutLabels = useCallback(() => {
    const instance = globe.current
    if (!instance) return

    const view = instance.pointOfView()
    const limit = horizon(view.altitude)

    const boxes = labels
      // Past the limb a name is hidden anyway, and a hidden name must not
      // crowd out one the player can actually see.
      .filter((l) => angleBetween(view.lat, view.lng, l.lat, l.lng) < limit)
      .map((l) => {
        const { x, y } = instance.getScreenCoords(l.lat, l.lng, LABEL_ALTITUDE)
        const width = labelWidth(l.name, l.role === 'required')
        return { code: l.code, x, y, width, height: LABEL_HEIGHT }
      })

    const fits = fitLabels(boxes, LABEL_GAP)
    setFitted((current) => (sameCodes(current, fits) ? current : fits))
  }, [labels])

  // The camera reports every frame of a drag; the layout only needs the frame
  // it settles on, and re-renders only when the set of names actually changes.
  const scheduleLayout = useCallback(() => {
    if (layoutFrame.current) return
    layoutFrame.current = requestAnimationFrame(() => {
      layoutFrame.current = 0
      layoutLabels()
    })
  }, [layoutLabels])

  useEffect(() => {
    scheduleLayout()
    return () => {
      cancelAnimationFrame(layoutFrame.current)
      layoutFrame.current = 0
    }
  }, [scheduleLayout, width, height])

  const globeMaterial = useMemo(
    () => new THREE.MeshPhongMaterial({ color: OCEAN, shininess: 6 }),
    [],
  )

  useEffect(() => {
    const controls = globe.current?.controls()
    if (!controls) return
    controls.autoRotate = false
    controls.enableDamping = true
  }, [])

  /** Put the camera where both of these can be seen at once. */
  const frame = useCallback((a: CountryCode, b: CountryCode, ms: number) => {
    const from = GRAPH[a]
    const to = GRAPH[b]
    globe.current?.pointOfView(
      {
        lat: midpoint(from.latlng[0], to.latlng[0]),
        lng: midLng(from.latlng[1], to.latlng[1]),
        altitude: 2.4,
      },
      ms,
    )
  }, [])

  // Frame the two endpoints on load so the player can see what they are up
  // against. After this the camera is the player's, and stays where they put it
  // — the builder opening and closing over the top is not a change of puzzle,
  // so these deps must not move when it does.
  const puzzleStart = state?.puzzle.start
  const puzzleEnd = state?.puzzle.end
  useEffect(() => {
    if (puzzleStart && puzzleEnd) frame(puzzleStart, puzzleEnd, 0)
  }, [puzzleStart, puzzleEnd, frame])

  /**
   * While picking, follow the round being built.
   *
   * A single end only pulls the camera when it is somewhere the player cannot
   * already see — the same rule as a placement, and for the same reason: most
   * picks are made by clicking a shape that is by definition already on screen,
   * and a camera that lurched after every one of those would be unusable. Both
   * ends together is the moment the round becomes real, so that one always
   * frames, which is also what makes "Random" show you what it rolled.
   */
  // Keyed on the two ends and not on the draft, which is a fresh object every
  // time a border is shut — and shutting a border must not swing the camera.
  const draftStart = pick?.draft.start ?? null
  const draftEnd = pick?.draft.end ?? null
  useEffect(() => {
    const instance = globe.current
    if (!instance) return

    if (draftStart && draftEnd) {
      frame(draftStart, draftEnd, 700)
      return
    }
    const alone = draftStart ?? draftEnd
    if (!alone) return

    const [lat, lng] = GRAPH[alone].latlng
    const view = instance.pointOfView()
    if (angleBetween(view.lat, view.lng, lat, lng) < horizon(view.altitude) * ON_SCREEN) return
    instance.pointOfView({ lat, lng, altitude: view.altitude }, 700)
  }, [draftStart, draftEnd, frame])

  /**
   * Go to whatever just landed on the board — but only when it is somewhere the
   * player cannot already see, and never at a zoom they did not choose.
   *
   * Most placements border something already on screen, so the old
   * fly-to-everything hauled the camera off a view the player had deliberately
   * framed, several times a round. Reserve the move for a placement that
   * genuinely happened out of sight, and keep their altitude when making it.
   */
  const lastPlaced = state?.placed.at(-1)
  useEffect(() => {
    const instance = globe.current
    if (!lastPlaced || !instance) return

    const [lat, lng] = GRAPH[lastPlaced].latlng
    const view = instance.pointOfView()
    if (angleBetween(view.lat, view.lng, lat, lng) < horizon(view.altitude) * ON_SCREEN) return

    instance.pointOfView({ lat, lng, altitude: view.altitude }, 700)
  }, [lastPlaced])

  // Run the ring while a press is held. Completing it is what buys the name.
  useEffect(() => {
    if (!hold) {
      setProgress(0)
      return
    }
    const started = performance.now()
    let frame = 0
    const tick = () => {
      const done = Math.min(1, (performance.now() - started) / HOLD_MS)
      setProgress(done)
      if (done < 1) {
        frame = requestAnimationFrame(tick)
        return
      }
      consumed.current = true
      setHold(null)
      onSelect?.(hold.code)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [hold, onSelect])

  const handleClick = useCallback(
    (shape: object) => {
      // A completed hold already acted; the click that follows it is noise.
      if (consumed.current) {
        consumed.current = false
        return
      }
      const { code } = shape as CountryFeature
      if (!code) return

      // Building a round: every country is simply a choice, free and instant.
      // Nothing below applies — there is no board to be legal against and no
      // name to buy, because the builder is naming these in its own fields.
      if (pick) {
        pick.onPick(code)
        return
      }
      if (!state) return

      // Once the round is over there is nothing left to buy, so a click just
      // answers the question: what is that one called?
      if (won) {
        onExplore?.(code)
        return
      }

      // A name the player already has is free, so a plain click places it. A
      // shut country goes the same way, and never has a name — not to play it,
      // but so `attemptReveal` can refuse it and say why. Anything else costs,
      // and costs are never charged on a single click.
      if (isNamed(state, code) || isClosed(state, code)) onSelect?.(code)
      else if (!revealsExplained) onExplainReveals?.()
      else onHoldTooShort?.(code)
    },
    [pick, state, won, onSelect, onExplore, revealsExplained, onExplainReveals, onHoldTooShort],
  )

  const handleHover = useCallback((shape: object | null) => {
    const candidate = shape as CountryFeature | null
    setHovered(candidate?.code ? candidate : null)
  }, [])

  const startHold = useCallback(
    (event: PointerEvent) => {
      const code = hovered?.code
      // Nothing is for sale in the builder — a name there is free and a tap is
      // the whole gesture, so a hold must not start a ring it will never fill.
      if (pick || !state) return
      if (!code || isNamed(state, code)) return
      // Nothing is for sale on a shut country, so a ring that filled would be
      // promising a purchase that cannot happen. This is the whole of that
      // guard now — a lone closure used to be stopped by the line above,
      // because it was named.
      if (isClosed(state, code)) return
      if (won) return // a plain click names it, and nothing is for sale
      // The first reach for a name is explained rather than charged, and the
      // explaining has to happen here: globe.gl calls a press with any movement
      // in it a drag and swallows the click that would otherwise have done it,
      // so a player following the rules got silence.
      if (!revealsExplained) {
        onExplainReveals?.()
        return
      }
      origin.current = { x: event.clientX, y: event.clientY }
      setHold({ code, x: event.clientX, y: event.clientY })
    },
    [hovered, pick, state, won, revealsExplained, onExplainReveals],
  )

  const trackHold = useCallback((event: PointerEvent) => {
    // Past the tolerance this is a drag of the globe, not a press on a country.
    const { x, y } = origin.current
    if (Math.hypot(event.clientX - x, event.clientY - y) > DRAG_TOLERANCE) setHold(null)
  }, [])

  const cancelHold = useCallback(() => setHold(null), [])

  return (
    <div
      className="globe-surface"
      onPointerDown={startHold}
      onPointerMove={trackHold}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
    >
      {hold && <HoldRing x={hold.x} y={hold.y} progress={progress} lifted={touch} />}
      <Globe
        ref={globe}
        width={width}
        height={height}
        backgroundColor="rgba(0,0,0,0)"
        globeMaterial={globeMaterial}
        atmosphereColor="#4a6da8"
        atmosphereAltitude={0.18}
        polygonsData={features}
        polygonCapColor={capColor}
        polygonCapMaterial={capMaterialProp}
        polygonSideColor={() => SIDE}
        polygonStrokeColor={strokeColor}
        polygonAltitude={altitude}
        polygonsTransitionDuration={220}
        // Never a tooltip: hovering must not name anything.
        polygonLabel={() => ''}
        onPolygonClick={handleClick}
        onPolygonHover={handleHover}
        onZoom={scheduleLayout}
        arcsData={shownCrossings}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcAltitude="altitude"
        arcColor={() => CROSSING_COLOR}
        arcStroke={0.42}
        // Dotted and still. Dash lengths are fractions of the arc, so every
        // crossing gets the same twenty-odd dots however long it is — the
        // earlier 0.5/0.22 left a short crossing as one stub and a gap, which
        // read as a rendering fault. Tight enough here to scan as a line, open
        // enough to say "crossing" rather than "border".
        arcDashLength={0.035}
        arcDashGap={0.015}
        arcDashAnimateTime={0}
        arcsTransitionDuration={0}
        arcLabel={() => ''}
        htmlElementsData={shown}
        htmlLat="lat"
        htmlLng="lng"
        htmlAltitude={LABEL_ALTITUDE}
        htmlElement={labelElement}
      />
    </div>
  )
}

function midpoint(a: number, b: number): number {
  return (a + b) / 2
}

/** Averages longitudes the short way round, so a pair either side of the
 * antimeridian frames across the Pacific rather than the whole globe. */
function midLng(a: number, b: number): number {
  let delta = b - a
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  const mid = a + delta / 2
  return ((mid + 540) % 360) - 180
}
