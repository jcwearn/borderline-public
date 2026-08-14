import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    // Which build this is, for the daily puzzle's cache key — see
    // src/daily-client.ts. Cloudflare Pages sets CF_PAGES_COMMIT_SHA during the
    // build; anywhere else there is only one build, so the name does not matter.
    __BUILD_ID__: JSON.stringify(process.env.CF_PAGES_COMMIT_SHA?.slice(0, 8) ?? 'dev'),
  },
  server: {
    // `npm run dev` gives hot reload but no Pages Functions, so /api is handed
    // to a `npm run pages:dev` running alongside. Without one, the app shows
    // its retry screen rather than inventing a puzzle of its own. /ingest is the
    // analytics proxy, and goes the same way for the same reason.
    proxy: {
      '/api': { target: 'http://localhost:8788', changeOrigin: true },
      '/ingest': { target: 'http://localhost:8788', changeOrigin: true },
    },
  },
})
