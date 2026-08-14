/**
 * What each barrier is told to the player, in one place.
 *
 * The modal a barrier gets the first time somebody meets one, and the rules
 * card's fourth step, are the same rule said to two different people — one
 * mid-round, one before their first — and they were written out twice and
 * maintained once. They drifted: the rules card said the rough was "outlined in
 * ochre and standing proud of the map" when it is hatched in warm brown and has
 * deliberately never had any lift at all.
 *
 * So the step sits beside the modal copy rather than in a table of its own.
 * Exhaustiveness would be enforced either way; adjacency is what keeps the
 * *voice* matched, because adding a barrier is then one contiguous block in one
 * diff rather than two blocks that slowly stop sounding like each other. That
 * is the failure the compiler was never going to catch.
 *
 * Which barriers a round carries, and what today's instance of each is called,
 * is `barriersIn` in `src/game/mechanics.ts`.
 */
import type { ReactNode } from 'react'
import type { Mechanic } from '../game/mechanics'
import { MarkerPost } from './MarkerPost'

type Copy = {
  /** The dialog's accessible name. */
  label: string
  title: string
  /**
   * Everything between the heading and the button: the prose, and the picture
   * where there is one. One slot rather than prose-then-figure because the
   * dogleg's rail fragment sits *between* its two paragraphs, and a fixed
   * order could not hold it.
   */
  body: ReactNode
  /**
   * The rules card's fourth step, given today's instance and whether it reads
   * as more than one thing — "The Maghreb is rough today", "2 countries are".
   * The agreement is `barriersIn`'s, because it is the only place a test can
   * reach it. The dogleg takes no argument at all and `noUnusedParameters`
   * keeps it that way, which is the type saying out loud that this one is
   * never named.
   */
  step: (label: string, plural: boolean) => ReactNode
}

/**
 * The copy, one entry per `Mechanic`. A fifth barrier is a type error here
 * until every line of it exists.
 *
 * Deliberately generic — never today's region by name. The banner behind the
 * modal already says which one, and nothing arms its timer until the player
 * acts, so the two are read back to back. It also keeps this a lookup table
 * rather than a set of sentences with holes in.
 */
export const MECHANIC_COPY: Record<Mechanic, Copy> = {
  fairway: {
    label: 'Today is a fairway',
    title: 'Only the course is open today.',
    body: (
      <>
        <p className="notice-body">
          Most of the world is <strong>greyed out and sunk</strong> today. What is left is the
          course: a <strong>fairway</strong> of open ground running between the two ends, with a
          band of <strong>rough</strong> along its edges.
        </p>

        {/* The rough band is the course's one texture, so the modal shows it —
            the same swatch the rough's own modal uses, because it is the same
            ground. */}
        <p className="notice-how">
          <span className="notice-swatch rough" aria-hidden />
          <span>
            The hatched rough still plays, at <strong>two</strong> instead of one. The grey beyond
            it is out of bounds — nothing there may be played, and no route may pass through.
          </span>
        </p>

        <p className="notice-body">
          Stay on the fairway and par is in reach. Stray into the rough and it costs a stroke; off
          the course there is no playing at all.
        </p>
      </>
    ),
    step: () => (
      <>
        <strong>Today is a fairway.</strong> Most of the world is greyed out and sunk, and the open
        corridor between the two ends is the course. The hatched rough along its edges still plays
        at two instead of one; beyond it is out of bounds — nothing there may be played, and no
        route may pass through.
      </>
    ),
  },

  dogleg: {
    label: 'Today is a dogleg',
    title: 'Your route has to run through one country.',
    body: (
      <>
        <p className="notice-body">
          One shape on the globe is <strong>marked in bone</strong>, stands proud of the map, and
          carries a <strong>flag on a post</strong>. Your route has to go{' '}
          <strong>in one border of it and out another</strong> — reaching it is not enough, and a
          dead end that touches it does not count.
        </p>

        {/* The rail as it will actually read, so the chip in the notice and the
            chip under the globe are plainly the same thing. */}
        <p className="notice-how notice-rail">
          <span className="chip start">
            <span className="flag" aria-hidden>
              🇪🇸
            </span>
            <span className="chip-name">Spain</span>
          </span>
          <span className="link dashed" aria-hidden />
          <span className="chip required">
            <span className="chip-anon">
              <MarkerPost />
            </span>
          </span>
          <span className="link dashed" aria-hidden />
          <span className="chip end">
            <span className="flag" aria-hidden>
              🇸🇪
            </span>
            <span className="chip-name">Sweden</span>
          </span>
        </p>

        <p className="notice-body">
          The flag is the whole of what the globe gives you: it marks the country and will{' '}
          <strong>not</strong> name it. Type it if you know it, or press and hold to buy it like any
          other. Par already allows for the bend.
        </p>
      </>
    ),
    step: () => (
      <>
        <strong>Today is a dogleg.</strong> One country is marked in bone, stands proud of the map,
        and flies a flag — your route has to run <em>through</em> it, in one border and out another.
        Touching it is not enough. The flag is all the globe will give you: it never names that
        country, so recall it or buy it like any other, and par already allows for the bend.
      </>
    ),
  },

  rough: {
    label: 'Today has rough ground',
    title: 'Some ground costs double to cross.',
    body: (
      <>
        <p className="notice-body">
          A stretch of the globe is <strong>hatched</strong> and outlined in the same warm brown. It
          is not shut, and it does not stand off the map — it is ground, and you may walk straight
          over it.
        </p>

        {/* The rough's whole tell is a texture, so the modal shows one. A
            sentence that says "hatched" and shows nothing sends the player
            hunting for a colour instead. */}
        <p className="notice-how">
          <span className="notice-swatch rough" aria-hidden />
          <span>
            Every country in it costs <strong>two</strong> instead of one, so the short way through
            and the long way round are both open and only one of them is cheaper.
          </span>
        </p>
      </>
    ),
    step: (label, plural) => (
      <>
        <strong>
          {label} {plural ? 'are' : 'is'} rough today.
        </strong>{' '}
        Hatched and outlined in warm brown. You can still cross it — every country in it just costs
        two instead of one, so going round may be cheaper.
      </>
    ),
  },

  bounds: {
    label: 'A region is out of bounds today',
    title: 'A whole region is out today.',
    body: (
      <>
        <p className="notice-body">
          A part of the world is <strong>greyed out and sunk</strong> into the board. Not ground
          that costs more — ground the round has ruled off altogether.
        </p>

        <p className="notice-body">
          Nothing in there may be played, and <strong>no route may pass through</strong> it either.
          So the short way across is not the way across, and par is measured on the way round.
        </p>
      </>
    ),
    step: (label, plural) => (
      <>
        <strong>
          {label} {plural ? 'are' : 'is'} out of bounds today.
        </strong>{' '}
        Greyed out and sunk, every country in it — nothing in there may be played and no route may
        pass through, so the short way across is not the way across.
      </>
    ),
  },

  closed: {
    label: 'A border is closed today',
    title: 'A border is shut today.',
    body: (
      <>
        <p className="notice-body">
          A country is <strong>greyed out and sunk</strong> into the board, and{' '}
          <strong>not named</strong> — the shape is the whole of what you get. Nothing on this board
          is named for free except the two ends.
        </p>

        <p className="notice-body">
          Nothing may be played there, and <strong>no route may pass through</strong> it either. So
          the short way across is not the way across, and par is measured on the way round. Pressing
          it costs nothing, so a shut shape is safe to ask about.
        </p>
      </>
    ),
    step: (label, plural) => (
      <>
        <strong>
          {label} {plural ? 'are' : 'is'} closed today.
        </strong>{' '}
        Greyed out and sunk, and no country in it is named. Nothing may be played there and no route
        may pass through, so the short way across is not the way across.
      </>
    ),
  },
}
