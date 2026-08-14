/**
 * /ingest/* — the analytics endpoint, on our own domain.
 *
 * PostHog's own hostnames are on every blocklist there is, so a third of the
 * events never leave the browser and the third that goes missing is not a random
 * third. Served from the site's own origin, it is indistinguishable from the
 * game asking for a puzzle. The client points at `/ingest` — see
 * `src/analytics.ts`; nothing here knows what an event is.
 *
 * Two upstreams, because PostHog splits them: `/static/*` is the session replay
 * recorder and lives on the assets host, everything else is ingestion.
 *
 * Cost: Pages Functions are 100,000 requests a day on the free plan, shared with
 * `/api/daily`. posthog-js batches — a flush every few seconds rather than a
 * request per event — so a round costs a handful of these, not one a guess.
 */
import { isGated } from '../../src/privacy-region'
/**
 * US cloud, matching where the project and the people running it are. Nobody in
 * Europe is measured at all — see `functions/api/region.ts` — so there is no
 * transfer to site in Frankfurt instead.
 */
const INGEST = 'https://us.i.posthog.com'
const ASSETS = 'https://us-assets.i.posthog.com'

/**
 * The slice of Cloudflare's Pages Function context this handler uses. Declared
 * here rather than pulled from @cloudflare/workers-types, whose globals conflict
 * with the Node types the build scripts need — the same reasoning as
 * `functions/api/daily.ts`.
 */
type RequestContext = { request: Request & { cf?: { country?: string; isEUCountry?: string } } }

export async function onRequest({ request }: RequestContext): Promise<Response> {
  // The backstop behind `/api/region`. A client that asked and was told no does
  // not get here at all; this is for the one that never asked, or that was
  // built before the gate existed and is still sitting in somebody's tab.
  if (
    isGated(request.cf?.country ?? request.headers.get('cf-ipcountry'), request.cf?.isEUCountry)
  ) {
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  }

  const url = new URL(request.url)
  const path = url.pathname.slice('/ingest'.length) || '/'
  const upstream = new URL(path + url.search, path.startsWith('/static/') ? ASSETS : INGEST)

  const headers = new Headers(request.headers)
  // `host` would name us rather than PostHog, and the runtime sets the right one
  // anyway. The cookie is this site's business and no part of an event.
  headers.delete('host')
  headers.delete('cookie')
  // Otherwise every event geolocates to a Cloudflare data centre.
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) headers.set('x-forwarded-for', ip)

  // Buffered rather than streamed: the payloads are batches of a few kilobytes,
  // and a streamed body would need `duplex`, which is not in the lib this is
  // typechecked against.
  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()

  const response = await fetch(upstream, { method: request.method, headers, body })

  // The whole point of the client's `persistence: 'localStorage'` is that this
  // site sets no cookies. Upstream is not allowed to undo that through us.
  const out = new Headers(response.headers)
  out.delete('set-cookie')
  return new Response(response.body, { status: response.status, headers: out })
}
