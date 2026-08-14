/**
 * GET /api/region — whether this visitor gets measured.
 *
 * The client asks before it loads anything, because the point is not to drop a
 * gated player's events at the edge but never to write an identifier to their
 * device in the first place: storing it is the act that would need consenting
 * to, and a decision taken after the fact is not a gate. `functions/ingest/`
 * refuses the same countries anyway, so a stale or lying client cannot get
 * anything through — but by then the storage has happened, which is why this
 * exists as well rather than instead.
 *
 * Nothing is counted here. How much of the audience the gate hides is already
 * answerable from Cloudflare's own traffic-by-country view, which is a property
 * of hosting the site rather than a second thing to collect.
 *
 * Never cached. The answer is different per country and an edge holding one for
 * everybody is the whole failure mode.
 */
import { isGated } from '../../src/privacy-region'

/** Cloudflare's own view of where the request came from. */
type Located = Request & { cf?: { country?: string; isEUCountry?: string | boolean } }

type RequestContext = { request: Located }

export function onRequestGet({ request }: RequestContext): Response {
  const country = request.cf?.country ?? request.headers.get('cf-ipcountry')
  const gated = isGated(country, request.cf?.isEUCountry)

  return new Response(JSON.stringify({ analytics: !gated }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
