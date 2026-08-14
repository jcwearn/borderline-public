/**
 * Builds the "Borderline" dashboard in PostHog from the events in
 * src/analytics.ts.
 *
 *   POSTHOG_PERSONAL_API_KEY=phx_... npm run posthog:dashboard -- --dry-run
 *   POSTHOG_PERSONAL_API_KEY=phx_... npm run posthog:dashboard
 *
 * The dashboard is written down here rather than clicked together because the
 * events it reads are written down in src/analytics.ts: a property renamed there
 * silently empties a tile, and a tile is much easier to fix in a diff than to
 * find in a UI. Re-running is the point — the script matches insights by name
 * and updates them in place, so amending a tile means editing TILES and running
 * it again.
 *
 * That also means tile names are keys. Renaming one leaves the old insight on
 * the dashboard; the script says so at the end rather than deleting anything,
 * since a stray tile is cheaper than a deleted one somebody was using.
 *
 * The key is a *personal* API key (`phx_`), not the project key the browser
 * carries — Settings, Personal API keys, scoped to project:read, dashboard:write
 * and insight:write. It grants write access to the whole project, so it belongs
 * in the shell or an untracked .env.local and nowhere near a commit.
 */

const HOST = process.env.POSTHOG_HOST ?? 'https://us.posthog.com'
const TOKEN = process.env.POSTHOG_PERSONAL_API_KEY
const DRY_RUN = process.argv.includes('--dry-run')

const DASHBOARD = 'Borderline'

/** Every tile reads the last month a day at a time unless it says otherwise. */
const RANGE = { date_from: '-30d' }

type Props = Record<string, unknown>

/** A property filter, spelled the way `EventPropertyFilter` wants it. */
function where(key: string, value: string): Props {
  return { type: 'event', key, operator: 'exact', value: [value] }
}

/** One series: an event, optionally aggregated over one of its properties. */
function series(event: string, math = 'total', property?: string, properties?: Props[]): Props {
  return {
    kind: 'EventsNode',
    event,
    math,
    ...(property ? { math_property: property } : {}),
    ...(properties ? { properties } : {}),
  }
}

function trends(source: {
  series: Props[]
  breakdown?: string
  display?: string
  interval?: string
  formula?: string
}): Props {
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'TrendsQuery',
      series: source.series,
      dateRange: RANGE,
      interval: source.interval ?? 'day',
      ...(source.breakdown
        ? { breakdownFilter: { breakdown: source.breakdown, breakdown_type: 'event' } }
        : {}),
      trendsFilter: {
        display: source.display ?? 'ActionsLineGraph',
        ...(source.formula ? { formula: source.formula } : {}),
      },
    },
  }
}

type Tile = { name: string; description: string; query: Props }

/**
 * The dashboard itself.
 *
 * Ordered the way a round is: who turned up, what they did with it, how it went,
 * and only then the things that broke. `free_round_built` and the two failure
 * events carry no round properties, so they sit on tiles of their own rather
 * than being broken down by a `mode` they do not have.
 */
const TILES: Tile[] = [
  {
    name: 'Rounds started per day',
    description: 'Daily against free. The top of everything else here.',
    query: trends({ series: [series('round_started')], breakdown: 'mode' }),
  },
  {
    name: 'Daily players',
    description: 'People, not rounds — one player opening four free rounds counts once.',
    query: trends({ series: [series('round_started', 'dau')] }),
  },
  {
    name: 'Started against finished',
    description:
      'Conversion within a day. round_won fires on a win only, so the gap is everyone who ' +
      'gave up or is still mid-round.',
    query: {
      kind: 'InsightVizNode',
      source: {
        kind: 'FunnelsQuery',
        series: [
          { kind: 'EventsNode', event: 'round_started' },
          { kind: 'EventsNode', event: 'round_won' },
        ],
        dateRange: RANGE,
        funnelsFilter: { funnelWindowInterval: 1, funnelWindowIntervalUnit: 'day' },
      },
    },
  },
  {
    name: 'Score against par',
    description:
      'delta is score minus par, so below zero is under par. The spread matters more than ' +
      'the mean: p90 is the round that went wrong.',
    query: trends({
      series: [
        series('round_won', 'avg', 'delta'),
        series('round_won', 'median', 'delta'),
        series('round_won', 'p90', 'delta'),
      ],
    }),
  },
  {
    name: 'Hardest puzzles',
    description:
      'Average delta by puzzle. A puzzle well above the rest is mis-parred or has a border ' +
      'nobody believes in. Free rounds have no id and drop out.',
    query: trends({
      series: [series('round_won', 'avg', 'delta')],
      breakdown: 'puzzle_id',
      display: 'ActionsTable',
    }),
  },
  {
    name: 'Wasted moves',
    description: 'waste is score minus the shortest route that exists — how much was left on it.',
    query: trends({
      series: [series('round_won', 'avg', 'waste'), series('round_won', 'p90', 'waste')],
    }),
  },
  {
    name: 'Guess outcomes',
    description: 'Every attempt: placed, bought with a reveal, a miss, or refused for nothing.',
    query: trends({
      series: [series('guess')],
      breakdown: 'result',
      display: 'ActionsStackedBar',
    }),
  },
  {
    name: 'Why guesses miss',
    description:
      'not-adjacent is someone wrong about the map; unreachable and closed are the puzzle ' +
      'being the puzzle. A country already on the board is no longer here — it costs ' +
      'nothing and counts under refusals.',
    query: trends({
      series: [series('guess', 'total', undefined, [where('result', 'miss')])],
      breakdown: 'reason',
      display: 'ActionsPie',
    }),
  },
  {
    name: 'What gets refused',
    description:
      'Attempts the board turned away for free: already-in-play is a mis-tap or a re-read of ' +
      'the rail, closed is somebody pressing a shut country. Neither costs a stroke, so this ' +
      'is a readability measure rather than a difficulty one.',
    query: trends({
      series: [series('guess', 'total', undefined, [where('result', 'refused')])],
      breakdown: 'reason',
      display: 'ActionsPie',
    }),
  },
  {
    name: 'Typed against globe',
    description: 'Which input the guess came through. Read next to the touch split.',
    query: trends({ series: [series('guess')], breakdown: 'source' }),
  },
  {
    name: 'How far in a guess happens',
    description:
      'Average move number of a miss against a placement. Misses drifting later means the ' +
      'endgame is where people stall.',
    query: trends({
      series: [
        series('guess', 'avg', 'guess_index', [where('result', 'placed')]),
        series('guess', 'avg', 'guess_index', [where('result', 'miss')]),
      ],
    }),
  },
  {
    name: 'Finished against abandoned',
    description:
      'round_left goes out over sendBeacon as the tab closes and is lossy by nature — read ' +
      'it as a floor, and trust started-minus-won for the real gap.',
    query: trends({ series: [series('round_won'), series('round_left')] }),
  },
  {
    name: 'How far before leaving',
    description:
      'Countries placed at the point of giving up. Near zero is a bounce, not a loss. ' +
      'round_left calls its miss counter miss_count, where round_won calls it misses.',
    query: trends({
      series: [
        series('round_left', 'avg', 'placed_count'),
        series('round_left', 'avg', 'miss_count'),
      ],
    }),
  },
  {
    name: 'Time to finish',
    description: 'Milliseconds from the round starting. A resumed round times the sitting only.',
    query: trends({
      series: [
        series('round_won', 'median', 'elapsed_ms'),
        series('round_won', 'p90', 'elapsed_ms'),
      ],
    }),
  },
  {
    name: 'Shares',
    description:
      'Native sheet against clipboard. A dismissed sheet still counts as shared — the browser ' +
      'does not say.',
    query: trends({ series: [series('share_clicked')], breakdown: 'outcome' }),
  },
  {
    name: 'Support link',
    description:
      'Coffees taken up against the ask being waved away, once it starts showing at twenty ' +
      'finished rounds. A dismissal is permanent, so these are people rather than clicks — and ' +
      'if the second series runs away from the first, the ask is either too early or too loud.',
    query: trends({ series: [series('support_clicked'), series('support_dismissed')] }),
  },
  {
    name: 'When the ask lands',
    description:
      'Rounds finished at the moment the support link was clicked or dismissed. Twenty is a ' +
      'guess; this is what would move it.',
    query: trends({
      series: [
        series('support_clicked', 'median', 'rounds'),
        series('support_dismissed', 'median', 'rounds'),
      ],
    }),
  },
  {
    name: 'Free rounds built',
    description:
      'Rounds made in the builder. Carries start, end and a count per barrier only — no mode, no par.',
    query: trends({ series: [series('free_round_built')] }),
  },
  {
    name: 'Touch against desktop',
    description: 'The pointer super-property, on every event. Is the phone layout costing rounds?',
    query: trends({
      series: [series('round_started')],
      breakdown: 'pointer',
      display: 'ActionsPie',
    }),
  },
  {
    name: 'How players arrive',
    description:
      'daily is the puzzle, free_link is somebody acting on a share, free_builder is making ' +
      'one. free_link is the only real measure of a share.',
    query: trends({
      series: [series('round_started')],
      breakdown: 'entry_mode',
      display: 'ActionsPie',
    }),
  },
  {
    name: 'Failures',
    description:
      'The puzzle not loading and the globe not drawing, by message. Should be flat at zero.',
    query: trends({
      series: [series('daily_fetch_failed'), series('globe_failed')],
      breakdown: 'message',
      display: 'ActionsTable',
    }),
  },
  {
    name: 'Coming back tomorrow',
    description: 'The whole point of a daily. Starting a round, then starting another.',
    query: {
      kind: 'InsightVizNode',
      source: {
        kind: 'RetentionQuery',
        retentionFilter: {
          period: 'Day',
          totalIntervals: 14,
          retentionType: 'retention_recurring',
          targetEntity: { id: 'round_started', name: 'round_started', type: 'events' },
          returningEntity: { id: 'round_started', name: 'round_started', type: 'events' },
        },
      },
    },
  },
]

async function api(path: string, init?: RequestInit): Promise<Props> {
  const response = await fetch(`${HOST}/api${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} — ${response.status}\n${body}`)
  }
  return body ? (JSON.parse(body) as Props) : {}
}

/**
 * Which project to write to. Asking is nicer than a number pasted out of a URL,
 * and the public project key is deliberately not in this repo to match against —
 * so one project is taken as obvious and several are a question.
 */
async function projectId(): Promise<number> {
  const override = process.env.POSTHOG_PROJECT_ID
  if (override) return Number(override)

  const projects = (await api('/projects/')).results as Array<{ id: number; name: string }>
  if (projects.length === 1) return projects[0].id
  const listed = projects.map((p) => `  ${p.id}  ${p.name}`).join('\n')
  throw new Error(`Set POSTHOG_PROJECT_ID to one of:\n${listed}`)
}

async function dashboardId(project: number): Promise<number> {
  const existing = (await api(`/projects/${project}/dashboards/`)).results as Array<{
    id: number
    name: string
  }>
  const found = existing.find((d) => d.name === DASHBOARD)
  if (found) return found.id

  if (DRY_RUN) {
    console.log(`create dashboard "${DASHBOARD}"`)
    return -1
  }
  const made = await api(`/projects/${project}/dashboards/`, {
    method: 'POST',
    body: JSON.stringify({
      name: DASHBOARD,
      description: 'Generated by scripts/posthog-dashboard.ts',
    }),
  })
  console.log(`created dashboard "${DASHBOARD}"`)
  return made.id as number
}

async function main(): Promise<void> {
  if (!TOKEN) {
    throw new Error(
      'POSTHOG_PERSONAL_API_KEY is not set. Create one at ' +
        `${HOST}/settings/user-api-keys with project:read, dashboard:write and insight:write.`,
    )
  }

  const project = await projectId()
  const dashboard = await dashboardId(project)

  // The dashboard's own tiles rather than every insight in the project, so a
  // tile named the same as some unrelated saved insight is not mistaken for it.
  const onDashboard = new Map<string, number>()
  if (dashboard !== -1) {
    const detail = await api(`/projects/${project}/dashboards/${dashboard}/`)
    const tiles = (detail.tiles ?? []) as Array<{ insight?: { id: number; name: string } }>
    for (const tile of tiles) {
      if (tile.insight?.name) onDashboard.set(tile.insight.name, tile.insight.id)
    }
  }

  for (const tile of TILES) {
    const existing = onDashboard.get(tile.name)
    const body = { name: tile.name, description: tile.description, query: tile.query }

    if (DRY_RUN) {
      console.log(`${existing ? 'update' : 'create'}  ${tile.name}`)
      continue
    }
    if (existing) {
      await api(`/projects/${project}/insights/${existing}/`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      console.log(`updated  ${tile.name}`)
    } else {
      await api(`/projects/${project}/insights/`, {
        method: 'POST',
        body: JSON.stringify({ ...body, dashboards: [dashboard] }),
      })
      console.log(`created  ${tile.name}`)
    }
  }

  const named = new Set(TILES.map((t) => t.name))
  for (const name of onDashboard.keys()) {
    if (!named.has(name)) {
      console.warn(`left alone, not in TILES: "${name}" — rename it or remove it by hand`)
    }
  }

  if (dashboard !== -1) console.log(`\n${HOST}/project/${project}/dashboard/${dashboard}`)
}

// A missing key and a rejected request are both things to read, not to debug, and
// PostHog puts the reason in the body — a stack trace over the top of it helps
// nobody.
try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
