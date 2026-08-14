import { describe, it, expect } from 'vitest'
import { downscalePlane, downscaleCrop } from '../src/lib/image/resize'

describe('downscalePlane', () => {
  it('area-averages a 4x4 plane into a 2x2 plane', () => {
    const plane = new Float32Array([
      0, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 10, 11,
      12, 13, 14, 15,
    ])
    const out = downscalePlane(plane, 4, 4, 2, 2)
    expect([...out]).toEqual([2.5, 4.5, 10.5, 12.5])
  })

  it('returns the same array when size is unchanged', () => {
    const plane = new Float32Array([1, 2, 3, 4])
    expect(downscalePlane(plane, 2, 2, 2, 2)).toBe(plane)
  })

  it('preserves a constant plane', () => {
    const plane = new Float32Array(16).fill(0.5)
    const out = downscalePlane(plane, 4, 4, 2, 2)
    for (const v of out) expect(v).toBeCloseTo(0.5)
  })

  it('downscales a single column of height 4 to height 2', () => {
    const plane = new Float32Array([10, 20, 30, 40])
    const out = downscalePlane(plane, 1, 4, 1, 2)
    expect([...out]).toEqual([15, 35])
  })
})

describe('downscaleCrop', () => {
  it('extracts and downscales a crop region', () => {
    const plane = new Float32Array([
      0, 0, 0, 0,
      0, 10, 20, 0,
      0, 30, 40, 0,
      0, 0, 0, 0,
    ])
    // Crop the 2x2 block at (1,1); downscaling 2x2 -> 1x1 averages it.
    const out = downscaleCrop(plane, 4, 4, { x: 1, y: 1, width: 2, height: 2 }, 1, 1)
    expect(out[0]).toBeCloseTo(25)
  })
})
