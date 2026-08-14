import { describe, expect, it } from 'vitest'
import { readEntry } from '../freeplay-url'
import { LINK_CODES } from '../link-codes'
import { buildPuzzle, type Recipe } from './freeplay'
import { CODES, GRAPH } from './graph'
import { attemptReveal, newGame, place, type GameState, type Puzzle } from './rules'
import { SITE, shareText } from './share'

const FRA_POL: Puzzle = { id: 142, date: '2026-05-22', start: 'FRA', end: 'POL', best: 1, par: 2 }

function play(puzzle: Puzzle, codes: string[]): GameState {
  return codes.reduce((state, code) => place(state, code).state, newGame(puzzle))
}

describe('shareText', () => {
  it('reads as a result card', () => {
    expect(shareText(play(FRA_POL, ['DEU']))).toBe(
      ['Borderline #142  🇫🇷→🇵🇱', 'Par 2 · 1 (-1) Birdie', '🇫🇷🟩🇵🇱', 'www.borderline.golf'].join(
        '\n',
      ),
    )
  })

  it('ends on something a message client will turn into a link', () => {
    const last = shareText(play(FRA_POL, ['DEU']))
      .split('\n')
      .at(-1)
    // A bare `borderline.golf` is not detected as a URL by iMessage, so the card
    // pastes as plain text and gets no preview. Only a scheme or a `www.` does it.
    expect(last).toMatch(/^(https?:\/\/|www\.)/)
  })

  it('only mentions penalties that happened', () => {
    const clean = shareText(play(FRA_POL, ['DEU']))
    expect(clean).not.toContain('❌')
    expect(clean).not.toContain('💡')
  })

  it('tallies misses and reveals when there were some', () => {
    let state = newGame(FRA_POL)
    // Neither borders France or Poland, so both are misses.
    state = place(state, 'MAR').state
    state = place(state, 'EGY').state
    state = attemptReveal(state, 'DEU').state // buys the name, and wins
    const text = shareText(state)
    expect(text).toContain('❌2')
    expect(text).toContain('💡1')
    // One country, two misses (+1) and one reveal (+1) against a par of 2.
    expect(text).toContain('Par 2 · 3 (+1)')
  })

  describe('a free round', () => {
    const FREE: Puzzle = { ...FRA_POL, id: 0, date: '', free: true }

    it('quotes free play rather than a day nobody else played', () => {
      const text = shareText(play(FREE, ['DEU']))
      expect(text).toContain('Borderline · free play')
      expect(text).not.toContain('#')
    })

    it('links to the round itself, so the card can be played back', () => {
      const text = shareText(play(FREE, ['DEU']))
      expect(text.split('\n').at(-1)).toBe('www.borderline.golf/?g=M3g')
    })

    it('carries the closed borders into the link', () => {
      const shut: Puzzle = { ...FREE, best: 3, par: 4, closed: ['DEU'] }
      const text = shareText(play(shut, ['CHE', 'AUT', 'CZE']))
      expect(text.split('\n').at(-1)).toBe('www.borderline.golf/?g=M3gm')
      expect(text).toContain('⛔')
    })

    it('carries the rough into the link, which needs the tagged form', () => {
      const rough: Puzzle = { ...FREE, best: 3, par: 4, rough: ['DEU'] }
      const text = shareText(play(rough, ['BEL', 'NLD', 'DEU']))
      expect(text.split('\n').at(-1)).toBe('www.borderline.golf/?g=_zN4AgEm')
    })

    it('carries the dogleg into the link', () => {
      // Not France to Poland: a waypoint may not touch either end, and nothing
      // fits between two countries one apart.
      const via: Puzzle = { ...FREE, end: 'TUR', best: 6, par: 7, required: ['SVK'] }
      expect(shareText(newGame(via)).split('\n').at(-1)).toBe('www.borderline.golf/?g=_zOXAwGK')
    })

    it('shares the round that was reported, waypoint and all', () => {
      // Yemen -> Algeria via Egypt. The card for this one used to end on
      // `?g=oSo` — the same two ends with the bend quietly straightened out.
      const dogleg: Puzzle = {
        ...FREE,
        start: 'YEM',
        end: 'DZA',
        best: 5,
        par: 6,
        required: ['EGY'],
      }
      const text = shareText(play(dogleg, ['SAU', 'JOR', 'ISR', 'EGY', 'LBY']))
      expect(text.split('\n').at(-1)).toBe('www.borderline.golf/?g=_6EqAwEs')
    })

    it('still ends on something a message client will linkify', () => {
      const last = shareText(play(FREE, ['DEU']))
        .split('\n')
        .at(-1)
      expect(last).toMatch(/^(https?:\/\/|www\.)/)
    })

    it('scores the round exactly as the daily would', () => {
      expect(shareText(play(FREE, ['DEU']))).toContain('Par 2 · 1 (-1) Birdie')
    })

    it('still names no country but the two endpoints', () => {
      const text = shareText(play(FREE, ['DEU']))
      expect(text).not.toContain('Germany')
    })
  })

  /**
   * The invariant the card was missing: the link on it rebuilds the round the
   * card is about.
   *
   * Stated over the whole `Puzzle` rather than over the bytes, because the
   * failure was never a broken link. A round whose rough or waypoint had fallen
   * out still loaded — as a different and easier puzzle, with a different `best`
   * and a different par, and nothing to tell the recipient so. Comparing what
   * the link rebuilds against what was played is the only assertion that sees
   * that; comparing codes would only see the ones that changed length.
   */
  describe('the link on the card rebuilds the round', () => {
    // Every combination of the three barriers, each one chosen so it actually
    // bites: `best` differs from the plain round's, so a barrier lost on the way
    // through the card shows up in the par as well as in the bytes.
    const CONFIGURATIONS: Array<[string, Recipe]> = [
      ['no barriers at all', { start: 'FRA', end: 'TUR' }],
      ['a closure', { start: 'FRA', end: 'TUR', closed: ['DEU'] }],
      ['some rough', { start: 'FRA', end: 'TUR', rough: ['DEU', 'CHE'] }],
      ['a dogleg', { start: 'FRA', end: 'TUR', required: ['SVK'] }],
      ['a closure and rough', { start: 'FRA', end: 'TUR', closed: ['DEU'], rough: ['ITA', 'AUT'] }],
      ['a closure and a dogleg', { start: 'FRA', end: 'TUR', closed: ['DEU'], required: ['SVK'] }],
      [
        'rough and a dogleg',
        { start: 'FRA', end: 'TUR', rough: ['DEU', 'CHE'], required: ['SVK'] },
      ],
      [
        'all three at once',
        { start: 'FRA', end: 'TUR', closed: ['ITA'], rough: ['DEU', 'CHE'], required: ['SVK'] },
      ],
      [
        // The one configuration whose barriers do NOT move `best` — a fairway
        // leaves the floor where it was by definition — so par would not betray
        // a barrier lost on the way through the card. The deep equality below
        // is the whole guard, and the closed list coming back sorted from the
        // complement section is part of what it checks.
        'a fairway',
        {
          start: 'CIV',
          end: 'ZAF',
          closed: LINK_CODES.filter(
            (code) =>
              ![
                ...['BFA', 'BWA', 'CAF', 'CIV', 'COD', 'NER', 'TCD', 'ZAF', 'ZMB'],
                ...['AGO', 'BEN', 'CMR', 'COG', 'GHA', 'MLI', 'MOZ', 'NGA', 'TGO', 'ZWE'],
              ].includes(code),
          ).sort(),
          rough: ['AGO', 'BEN', 'CMR', 'COG', 'GHA', 'MLI', 'MOZ', 'NGA', 'TGO', 'ZWE'],
        },
      ],
    ]

    for (const [name, recipe] of CONFIGURATIONS) {
      it(`survives ${name}`, () => {
        const built = buildPuzzle(recipe)
        if ('error' in built) throw new Error(`${name} is not playable: ${built.error}`)

        const link = shareText(newGame(built.puzzle)).split('\n').at(-1)!
        expect(link.startsWith(`${SITE}/?`), link).toBe(true)

        const back = readEntry(link.slice(SITE.length + 1))
        expect(back.mode, link).toBe('free')
        if (back.mode !== 'free' || !back.recipe) throw new Error(`unreadable link: ${link}`)

        const again = buildPuzzle(back.recipe)
        if ('error' in again) throw new Error(`${name} did not survive: ${again.error}`)
        expect(again.puzzle).toEqual(built.puzzle)
      })
    }
  })

  it('marks a hole that played closed, without naming what was shut', () => {
    const SHUT: Puzzle = { ...FRA_POL, best: 3, par: 4, closed: ['DEU'] }
    const text = shareText(play(SHUT, ['CHE', 'AUT', 'CZE']))
    expect(text).toContain('⛔')
    expect(text).not.toContain('Germany')
  })

  it('says nothing about closures on an open day', () => {
    expect(shareText(play(FRA_POL, ['DEU']))).not.toContain('⛔')
  })

  it('marks detours yellow and the route green', () => {
    const text = shareText(play(FRA_POL, ['BEL', 'NLD', 'DEU']))
    expect(text).toContain('🇫🇷🟩🟨🟨🇵🇱')
  })

  it('names the two endpoints and no other country', () => {
    const state = play(FRA_POL, ['BEL', 'NLD', 'DEU'])
    const text = shareText(state)
    for (const code of CODES) {
      if (code === 'FRA' || code === 'POL') continue
      expect(text, `leaked ${code}`).not.toContain(GRAPH[code].name)
      expect(text, `leaked ${code} flag`).not.toContain(GRAPH[code].flag)
    }
  })

  it('gives away nothing but squares between the endpoint flags', () => {
    const state = play(FRA_POL, ['BEL', 'NLD', 'DEU'])
    const grid = shareText(state).split('\n')[2]
    expect(grid).toMatch(/^🇫🇷[🟩🟨]+🇵🇱$/u)
  })

  it('carries the puzzle number so results are comparable', () => {
    expect(shareText(play(FRA_POL, ['DEU']))).toContain('#142')
  })
})
