/**
 * The built app, served for the layout test to point a browser at.
 *
 * Built and not `vite dev`, though dev is the shorter road. In dev the globe
 * arrives as three.js's several hundred separate modules, each transformed on
 * demand, and on a two-core CI runner that work starves everything else — the
 * same five countries that type in half a second here took over a minute there,
 * and then ran out of patience. A build is one chunk the browser fetches and
 * fails to draw, and it has the better claim anyway: these assertions are about
 * the CSS that ships.
 *
 * In-process rather than a spawned `npm run dev`, so there is no port to guess
 * and nothing left running if the test throws. No `/api` is needed either: the
 * layout test plays a `?free=` round, which is built entirely in the client.
 */
import { build, preview, type PreviewServer } from 'vite'

let server: PreviewServer | undefined

export async function setup(): Promise<void> {
  await build({ logLevel: 'error' })
  server = await preview({ preview: { port: 0 }, logLevel: 'error' })
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP port')
  process.env.BORDERLINE_URL = `http://localhost:${address.port}`
}

export async function teardown(): Promise<void> {
  await server?.close()
}
