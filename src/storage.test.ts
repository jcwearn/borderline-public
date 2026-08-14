import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MECHANICS } from './game/mechanics'
import { newGame, place, type GameState, type Puzzle } from './game/rules'
import {
  EMPTY_STATS,
  howToPlaySeen,
  loadFlipped,
  loadMuted,
  loadStats,
  markHowToPlaySeen,
  markRevealNoticeSeen,
  markMechanicSeen,
  markSupportDismissed,
  mechanicSeen,
  recordWin,
  resumeOrStart,
  revealNoticeSeen,
  saveFlipped,
  saveGame,
  saveMuted,
  supportDismissed,
} from './storage'

const TODAY: Puzzle = { id: 142, date: '2026-05-22', start: 'FRA', end: 'POL', best: 1, par: 2 }
const TOMORROW: Puzzle = { id: 143, date: '2026-05-23', start: 'ESP', end: 'DEU', best: 2, par: 3 }

/** A minimal localStorage, since these tests run in Node. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  })
  return store
}

function won(puzzle: Puzzle, codes: string[]): GameState {
  return codes.reduce((state, code) => place(state, code).state, newGame(puzzle))
}

let store: Map<string, string>
beforeEach(() => {
  store = installStorage()
})

describe('resumeOrStart', () => {
  it('starts fresh when nothing is saved', () => {
    expect(resumeOrStart(TODAY).placed).toEqual([])
  })

  it('picks up an in-progress game', () => {
    saveGame(place(newGame(TODAY), 'BEL').state)
    const resumed = resumeOrStart(TODAY)
    expect(resumed.placed).toEqual(['BEL'])
    expect(resumed.status).toBe('playing')
  })

  it('restores misses and reveals, so the score survives a reload', () => {
    let state = newGame(TODAY)
    state = place(state, 'MAR').state
    state = { ...state, revealed: ['ITA'] }
    saveGame(state)
    const resumed = resumeOrStart(TODAY)
    expect(resumed.misses).toEqual(['MAR'])
    expect(resumed.revealed).toEqual(['ITA'])
  })

  it('never carries yesterday into today', () => {
    saveGame(place(newGame(TODAY), 'BEL').state)
    expect(resumeOrStart(TOMORROW).placed).toEqual([])
  })

  it('ignores a save whose date matches but whose puzzle does not', () => {
    saveGame(place(newGame(TODAY), 'BEL').state)
    expect(resumeOrStart({ ...TODAY, id: 999 }).placed).toEqual([])
  })

  it('survives corrupt storage rather than refusing to start', () => {
    store.set('borderline:v1', '{ not json')
    expect(resumeOrStart(TODAY).placed).toEqual([])
    expect(loadStats()).toEqual(EMPTY_STATS)
  })

  it('keeps playing when storage throws, as in private browsing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(() => saveGame(newGame(TODAY))).not.toThrow()
    expect(resumeOrStart(TODAY).placed).toEqual([])
  })
})

describe('the one-time explanations', () => {
  it('are both unseen by a first-time player', () => {
    expect(howToPlaySeen()).toBe(false)
    expect(revealNoticeSeen()).toBe(false)
  })

  it('stay seen once dismissed', () => {
    markHowToPlaySeen()
    markRevealNoticeSeen()
    expect(howToPlaySeen()).toBe(true)
    expect(revealNoticeSeen()).toBe(true)
  })

  it('are independent — dismissing one does not dismiss the other', () => {
    markHowToPlaySeen()
    expect(revealNoticeSeen()).toBe(false)
  })

  it('outlive a finished game and the next one starting', () => {
    markHowToPlaySeen()
    recordWin(won(TODAY, ['DEU']))
    saveGame(newGame(TOMORROW))
    expect(howToPlaySeen()).toBe(true)
  })

  it('survive every other preference being changed around them', () => {
    markHowToPlaySeen()
    saveFlipped(true)
    saveMuted(true)
    markRevealNoticeSeen()
    expect(howToPlaySeen()).toBe(true)
    expect(loadFlipped()).toBe(true)
    expect(loadMuted()).toBe(true)
  })

  // Over every barrier rather than over the dogleg, so a fifth one is covered
  // here the moment it is named in `MECHANICS`.
  it.each(MECHANICS)('does not count %s as explained until it has been', (mechanic) => {
    expect(mechanicSeen(mechanic)).toBe(false)
    markMechanicSeen(mechanic)
    expect(mechanicSeen(mechanic)).toBe(true)
  })

  it.each(MECHANICS)('keeps %s apart from the rules and the reveal notice', (mechanic) => {
    markHowToPlaySeen()
    markRevealNoticeSeen()
    expect(mechanicSeen(mechanic)).toBe(false)
    markMechanicSeen(mechanic)
    expect(howToPlaySeen()).toBe(true)
    expect(revealNoticeSeen()).toBe(true)
  })

  it('gives every barrier its own record, so reading one is not reading another', () => {
    for (const mechanic of MECHANICS) {
      markMechanicSeen(mechanic)
      for (const other of MECHANICS) {
        expect(mechanicSeen(other), `${other} after ${mechanic}`).toBe(
          MECHANICS.indexOf(other) <= MECHANICS.indexOf(mechanic),
        )
      }
    }
  })

  it('accumulates them in the order they were marked', () => {
    // A doubled hole marks as it advances rather than up front, which is what
    // lets the queue survive a reload — so the order stored is the order read.
    markMechanicSeen('rough')
    markMechanicSeen('dogleg')
    expect(JSON.parse(localStorage.getItem('borderline:v1')!).mechanicsSeen).toEqual([
      'rough',
      'dogleg',
    ])
  })

  it('keeps a barrier from a later build through a downgrade', () => {
    // The promise the field's doc comment makes: a player who meets a new
    // mechanic and then loads an older build must not have it forgotten for
    // them, or they get the explanation again when they come back.
    localStorage.setItem('borderline:v1', JSON.stringify({ mechanicsSeen: ['sandtrap'] }))
    markMechanicSeen('rough')
    expect(JSON.parse(localStorage.getItem('borderline:v1')!).mechanicsSeen).toEqual([
      'sandtrap',
      'rough',
    ])
  })

  it('records a barrier once however many times it is marked', () => {
    // The list is the stored shape, so a mechanic marked on every reload would
    // otherwise grow it without bound.
    markMechanicSeen('dogleg')
    markMechanicSeen('dogleg')
    markMechanicSeen('dogleg')
    expect(JSON.parse(localStorage.getItem('borderline:v1')!).mechanicsSeen).toEqual(['dogleg'])
  })

  it('reads a record written before barrier notices existed', () => {
    // Every player already has one of these, and none of them names the field.
    localStorage.setItem('borderline:v1', JSON.stringify({ howToPlaySeen: true }))
    expect(howToPlaySeen()).toBe(true)
    expect(mechanicSeen('dogleg')).toBe(false)
    markMechanicSeen('dogleg')
    expect(mechanicSeen('dogleg')).toBe(true)
  })

  it('survives a record whose barrier list is not a list', () => {
    localStorage.setItem('borderline:v1', JSON.stringify({ mechanicsSeen: 'dogleg' }))
    expect(mechanicSeen('dogleg')).toBe(false)
  })

  it('read as unseen when storage is unavailable, so nobody is dropped in cold', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(howToPlaySeen()).toBe(false)
    expect(() => markHowToPlaySeen()).not.toThrow()
  })
})

describe('waving away the ask for a coffee', () => {
  it('is not dismissed by a player who has never been asked', () => {
    expect(supportDismissed()).toBe(false)
  })

  it('stays dismissed once said', () => {
    markSupportDismissed()
    expect(supportDismissed()).toBe(true)
  })

  // The point of the feature: a no is permanent, so it has to survive the thing
  // that happens immediately afterwards — another round, and another after that.
  it('outlives the rounds that follow it', () => {
    markSupportDismissed()
    recordWin(won(TODAY, ['DEU']))
    saveGame(newGame(TOMORROW))
    recordWin(won(TOMORROW, ['FRA']))
    expect(supportDismissed()).toBe(true)
  })

  it('survives every other preference being changed around it', () => {
    markSupportDismissed()
    saveFlipped(true)
    saveMuted(true)
    markHowToPlaySeen()
    markRevealNoticeSeen()
    expect(supportDismissed()).toBe(true)
  })

  it('is independent of the one-time explanations', () => {
    markHowToPlaySeen()
    markRevealNoticeSeen()
    expect(supportDismissed()).toBe(false)
  })

  it('leaves the record alone — dismissing is not a round', () => {
    recordWin(won(TODAY, ['DEU']))
    markSupportDismissed()
    expect(loadStats().rounds).toBe(1)
    expect(loadStats().currentStreak).toBe(1)
  })

  it('does not throw when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    // Reads as not-dismissed, which is safe only because the round count it is
    // gated behind comes from the same unreadable record and is therefore zero.
    expect(supportDismissed()).toBe(false)
    expect(() => markSupportDismissed()).not.toThrow()
    expect(loadStats().rounds).toBe(0)
  })
})

describe('preferences', () => {
  it('default to unflipped and unmuted', () => {
    expect(loadFlipped()).toBe(false)
    expect(loadMuted()).toBe(false)
  })

  it('persist independently of one another', () => {
    saveFlipped(true)
    expect(loadFlipped()).toBe(true)
    expect(loadMuted()).toBe(false)
    saveMuted(true)
    saveFlipped(false)
    expect(loadFlipped()).toBe(false)
    expect(loadMuted()).toBe(true)
  })

  it('do not disturb a game in progress', () => {
    saveGame(place(newGame(TODAY), 'BEL').state)
    saveFlipped(true)
    saveMuted(true)
    expect(resumeOrStart(TODAY).placed).toEqual(['BEL'])
  })
})

describe('the reveal notice', () => {
  it('has not been seen by a first-time player', () => {
    expect(revealNoticeSeen()).toBe(false)
  })

  it('stays seen once dismissed', () => {
    markRevealNoticeSeen()
    expect(revealNoticeSeen()).toBe(true)
  })

  it('survives finishing a game and starting the next', () => {
    markRevealNoticeSeen()
    recordWin(won(TODAY, ['DEU']))
    saveGame(newGame(TOMORROW))
    expect(revealNoticeSeen()).toBe(true)
  })

  it('does not disturb the record it is stored alongside', () => {
    recordWin(won(TODAY, ['DEU']))
    markRevealNoticeSeen()
    expect(loadStats()).toMatchObject({ rounds: 1, lastWonId: 142 })
  })

  it('reads as unseen when storage is unavailable, so the warning still shows', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    })
    expect(revealNoticeSeen()).toBe(false)
    expect(() => markRevealNoticeSeen()).not.toThrow()
  })
})

describe('carrying an older record forward', () => {
  it('keeps history that was written under the old field name', () => {
    store.set(
      'borderline:v1',
      JSON.stringify({
        stats: {
          played: 12,
          won: 12,
          currentStreak: 3,
          maxStreak: 5,
          distribution: { '0': 4 },
          lastWonId: 99,
        },
      }),
    )
    expect(loadStats()).toEqual({
      version: 2,
      rounds: 12,
      currentStreak: 3,
      maxStreak: 5,
      // Dropped on the way through: see the scoring-era test below.
      distribution: {},
      lastWonId: 99,
    })
  })

  it('drops a distribution recorded before par became beatable', () => {
    // Those deltas were measured against the shortest route rather than against
    // par, and the difficulty of a past round is not stored, so there is no
    // honest way to convert them. The streak is what a player has been building,
    // so it survives; only the chart starts again.
    store.set(
      'borderline:v1',
      JSON.stringify({
        stats: {
          rounds: 7,
          currentStreak: 2,
          maxStreak: 4,
          distribution: { '0': 5, '2': 2 },
          lastWonId: 60,
        },
      }),
    )
    const stats = loadStats()
    expect(stats.distribution).toEqual({})
    expect(stats.rounds).toBe(7)
    expect(stats.currentStreak).toBe(2)
    expect(stats.maxStreak).toBe(4)
    expect(stats.lastWonId).toBe(60)
  })

  it('leaves a record from the current era alone', () => {
    store.set(
      'borderline:v1',
      JSON.stringify({
        stats: {
          version: 2,
          rounds: 3,
          currentStreak: 1,
          maxStreak: 1,
          distribution: { '-1': 3 },
          lastWonId: 5,
        },
      }),
    )
    expect(loadStats().distribution).toEqual({ '-1': 3 })
  })

  it('stops rewriting the retired fields once it saves again', () => {
    store.set('borderline:v1', JSON.stringify({ stats: { played: 4, won: 4, lastWonId: 1 } }))
    recordWin(won({ ...TODAY, id: 2 }, ['DEU']))
    const raw = JSON.parse(store.get('borderline:v1')!)
    expect(raw.stats.rounds).toBe(5)
    expect(raw.stats).not.toHaveProperty('played')
    expect(raw.stats).not.toHaveProperty('won')
  })

  it('starts from zero for a record that never had stats at all', () => {
    store.set('borderline:v1', JSON.stringify({ game: null }))
    expect(loadStats()).toEqual(EMPTY_STATS)
  })
})

describe('recordWin', () => {
  it('counts a win and starts a streak', () => {
    const stats = recordWin(won(TODAY, ['DEU']))
    expect(stats).toMatchObject({ rounds: 1, currentStreak: 1, maxStreak: 1 })
  })

  it('counts rounds finished, since there is no way to lose', () => {
    recordWin(won(TODAY, ['DEU']))
    recordWin(won(TOMORROW, ['FRA', 'BEL']))
    expect(loadStats().rounds).toBe(2)
  })

  it('files the result under its score relative to par', () => {
    // The shortest route, played clean: one under par.
    expect(recordWin(won(TODAY, ['DEU'])).distribution).toEqual({ '-1': 1 })
  })

  it('will not count the same puzzle twice, however often the page reloads', () => {
    const game = won(TODAY, ['DEU'])
    recordWin(game)
    recordWin(game)
    const stats = recordWin(game)
    expect(stats.rounds).toBe(1)
    expect(stats.currentStreak).toBe(1)
  })

  it('extends the streak on consecutive puzzle numbers', () => {
    recordWin(won(TODAY, ['DEU']))
    const stats = recordWin(won(TOMORROW, ['FRA', 'BEL']))
    expect(stats.currentStreak).toBe(2)
    expect(stats.maxStreak).toBe(2)
  })

  it('breaks the streak when a day was skipped, but keeps the best', () => {
    recordWin(won(TODAY, ['DEU']))
    recordWin(won(TOMORROW, ['FRA', 'BEL']))
    const later = recordWin(won({ ...TODAY, id: 200, date: '2026-08-01' }, ['DEU']))
    expect(later.currentStreak).toBe(1)
    expect(later.maxStreak).toBe(2)
    expect(later.rounds).toBe(3)
  })

  it('persists across reads', () => {
    recordWin(won(TODAY, ['DEU']))
    expect(loadStats()).toMatchObject({ rounds: 1, lastWonId: 142 })
  })

  it('keeps the record when a new game is saved over the old one', () => {
    recordWin(won(TODAY, ['DEU']))
    saveGame(newGame(TOMORROW))
    expect(loadStats().rounds).toBe(1)
  })
})

describe('a free round leaves the daily alone', () => {
  const FREE: Puzzle = {
    id: 0,
    date: '',
    start: 'FRA',
    end: 'POL',
    best: 1,
    par: 2,
    free: true,
  }

  /** A daily mid-round, plus a record worth protecting. */
  function withDailyUnderway() {
    saveGame(place(newGame(TODAY), 'BEL').state)
    recordWin(won({ ...TODAY, id: 141 }, ['DEU']))
    return store.get('borderline:v1')!
  }

  it('does not evict the daily from the one game slot there is', () => {
    const before = withDailyUnderway()
    saveGame(place(newGame(FREE), 'DEU').state)
    expect(store.get('borderline:v1')).toBe(before)
  })

  it('leaves the whole record untouched, even on a win', () => {
    // The sharpest edge: `recordWin` resets the streak whenever the last win
    // was not the previous puzzle, so a free round with a made-up id would end
    // a real streak without anyone noticing.
    const before = withDailyUnderway()
    const stats = recordWin(won(FREE, ['DEU']))
    expect(store.get('borderline:v1')).toBe(before)
    expect(stats).toEqual(loadStats())
  })

  it('still lets the daily be resumed afterwards', () => {
    saveGame(place(newGame(TODAY), 'BEL').state)
    saveGame(place(newGame(FREE), 'DEU').state)
    recordWin(won(FREE, ['DEU']))
    expect(resumeOrStart(TODAY).placed).toEqual(['BEL'])
  })

  it('counts the daily exactly as it did before', () => {
    recordWin(won(FREE, ['DEU']))
    const after = recordWin(won(TODAY, ['DEU']))
    expect(after.rounds).toBe(1)
    expect(after.currentStreak).toBe(1)
    expect(after.distribution).toEqual({ '-1': 1 })
  })
})
