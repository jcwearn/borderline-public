import { describe, expect, it } from 'vitest'
import { fitLabels, type LabelBox } from './geometry'

function box(code: string, x: number, y: number, width = 100, height = 24): LabelBox {
  return { code, x, y, width, height }
}

describe('fitLabels', () => {
  it('keeps every name when they are nowhere near each other', () => {
    const fits = fitLabels([box('MNE', 0, 0), box('AZE', 400, 0), box('TUR', 0, 300)])
    expect([...fits].sort()).toEqual(['AZE', 'MNE', 'TUR'])
  })

  it('drops the name that lands on one already drawn', () => {
    const fits = fitLabels([box('SRB', 0, 0), box('BIH', 40, 0)])
    expect([...fits]).toEqual(['SRB'])
  })

  it('gives the collision to whoever comes first, so the caller sets priority', () => {
    expect([...fitLabels([box('MNE', 0, 0), box('SRB', 40, 0)])]).toEqual(['MNE'])
    expect([...fitLabels([box('SRB', 40, 0), box('MNE', 0, 0)])]).toEqual(['SRB'])
  })

  it('separates on either axis alone', () => {
    // Same row, far apart horizontally.
    expect(fitLabels([box('A', 0, 0), box('B', 120, 0)]).size).toBe(2)
    // Same column, far apart vertically.
    expect(fitLabels([box('A', 0, 0), box('B', 0, 40)]).size).toBe(2)
    // Close on both: only one survives.
    expect(fitLabels([box('A', 0, 0), box('B', 90, 20)]).size).toBe(1)
  })

  it('counts the gap as part of the footprint', () => {
    // Exactly touching is not a collision, until a gap is demanded.
    expect(fitLabels([box('A', 0, 0), box('B', 100, 0)]).size).toBe(2)
    expect(fitLabels([box('A', 0, 0), box('B', 100, 0)], 6).size).toBe(1)
  })

  it('measures each name against every name kept, not just the last one', () => {
    // C clears B but sits under A, so it must still be dropped.
    const fits = fitLabels([box('A', 0, 0), box('B', 400, 0), box('C', 30, 0)])
    expect([...fits]).toEqual(['A', 'B'])
  })

  it('has nothing to say about an empty globe', () => {
    expect(fitLabels([]).size).toBe(0)
  })
})
