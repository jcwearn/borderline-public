import { describe, expect, it } from 'vitest'
import { BACKSPACE, KEY_ROWS, MAX_QUERY, ROW_UNITS, SPACE, applyKey } from './keys'
import { resolve } from './game/search'

const KEYS = KEY_ROWS.flatMap((row) => row.keys)

describe('KEY_ROWS', () => {
  it('is three rows, each filling the grid once indented on both sides', () => {
    expect(KEY_ROWS).toHaveLength(3)
    for (const { offset, keys } of KEY_ROWS) {
      const span = keys.reduce((total, key) => total + key.span, 0)
      expect(offset * 2 + span).toBe(ROW_UNITS)
    }
  })

  /** A typo in a row would otherwise leave a letter quietly untypable. */
  it('carries all twenty-six letters exactly once', () => {
    const letters = KEYS.map((key) => key.value).filter((value) => /^[a-z]$/.test(value))
    expect(letters).toHaveLength(26)
    expect([...letters].sort().join('')).toBe('abcdefghijklmnopqrstuvwxyz')
  })

  it('offers a space and a backspace, and nothing else', () => {
    const extras = KEYS.map((key) => key.value).filter((value) => !/^[a-z]$/.test(value))
    expect(extras.sort()).toEqual([SPACE, BACKSPACE].sort())
  })
})

describe('applyKey', () => {
  it('appends a letter', () => {
    expect(applyKey('cha', 'd')).toBe('chad')
  })

  it('deletes backwards, and does nothing at the start', () => {
    expect(applyKey('chad', BACKSPACE)).toBe('cha')
    const empty = ''
    expect(applyKey(empty, BACKSPACE)).toBe(empty)
  })

  it('refuses a leading or doubled space', () => {
    const empty = ''
    expect(applyKey(empty, SPACE)).toBe(empty)
    const trailing = 'south '
    expect(applyKey(trailing, SPACE)).toBe(trailing)
    expect(applyKey('south', SPACE)).toBe('south ')
  })

  it('ignores anything that is not a key', () => {
    const query = 'chad'
    expect(applyKey(query, 'D')).toBe(query)
    expect(applyKey(query, '7')).toBe(query)
    expect(applyKey(query, 'de')).toBe(query)
  })

  it('stops well past the longest name there is', () => {
    const full = 'a'.repeat(MAX_QUERY)
    expect(applyKey(full, 'b')).toBe(full)
    expect(MAX_QUERY).toBeGreaterThan('central african republic'.length)
  })

  it('types the awkward ones end to end', () => {
    for (const [typed, code] of [
      ['timor leste', 'TLS'],
      ['guinea bissau', 'GNB'],
      ['central african republic', 'CAF'],
    ] as const) {
      expect([...typed].reduce(applyKey, '')).toBe(typed)
      expect(resolve(typed)).toBe(code)
    }
  })
})
