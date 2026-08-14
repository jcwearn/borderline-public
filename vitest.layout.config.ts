import { defineConfig } from 'vitest/config'

/**
 * The layout suite, kept out of `vitest.config.ts` so that `npm test` stays a
 * few seconds of pure logic with no browser to download. Everything here needs
 * a real engine doing real layout: the bug it exists to catch is a grid track
 * that outgrows its container, which no amount of jsdom will ever notice.
 */
export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    environment: 'node',
    globalSetup: './e2e/serve.ts',
    // A handful of tests apiece, and a setup that drives a browser through a
    // whole opening. Verbose so that a failure on a machine nobody can open
    // reads as a list of steps with times against them rather than as one
    // silent hook.
    reporters: ['verbose'],
    // Launching Chrome and playing five countries on an on-screen keyboard is
    // not a five-second test.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
