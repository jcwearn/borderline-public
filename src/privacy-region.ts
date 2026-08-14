/**
 * Where analytics does not run.
 *
 * The game is a US project offering nothing to anybody in Europe, which is most
 * of what decides whether GDPR reaches it — but the other half of that test is
 * about monitoring behaviour, and per-player analytics is the thing it is about.
 * Rather than argue the point, nobody in these countries is measured at all: no
 * events, no identifier written to their device, nothing to have a basis for.
 *
 * The EEA because of GDPR, the UK because it kept its own copy of it, and
 * Switzerland because the FADP asks close enough to the same questions. Held as
 * one list, shared by the endpoint that decides and the proxy that enforces, so
 * the two can never come to different conclusions.
 */

/**
 * Written out rather than left to Cloudflare's own `isEUCountry`, which is
 * documented as the string "1" and arrives from wrangler's local runtime as the
 * boolean false. A flag whose type is not the same everywhere is a flag that can
 * quietly stop matching, and the failure it would fail into is the whole of
 * Europe going measured. The list is the belt; the flag below is the braces.
 *
 * Membership changes about once a decade, so this going stale is a slower
 * problem than the one it prevents. EU-27, then the rest of the EEA, then the UK
 * for its own copy of GDPR and Switzerland for the FADP.
 */
const GATED = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
  'GB', 'CH',
]) // prettier-ignore

/**
 * Whether this request should be left alone entirely.
 *
 * An unknown country is gated. That is the fail-closed direction — the cost of
 * being wrong is a player who goes uncounted, against a player who is measured
 * in a country where they should not have been.
 */
export function isGated(
  country?: string | null,
  isEUCountry?: string | boolean | number | null,
): boolean {
  // Every shape Cloudflare's flag has been seen in, because the point of having
  // it as well as the list is that it catches what the list has not heard about.
  if (isEUCountry === '1' || isEUCountry === true || isEUCountry === 1) return true
  if (!country) return true
  return GATED.has(country.toUpperCase())
}
