import { describe, expect, it } from 'vitest'
import { wbFromPick } from '../src/lib/image/process'

describe('wbFromPick', () => {
  it('a neutral pixel maps to neutral sliders', () => {
    expect(wbFromPick(128, 128, 128, true)).toEqual({ temp: 5500, hue: 0 })
    expect(wbFromPick(128, 128, 128, false)).toEqual({ temp: 0, hue: 0 })
  })

  it('a warm pixel (r ≫ b) cools down the temperature', () => {
    const raw = wbFromPick(200, 100, 50, true)
    expect(raw.temp).toBeGreaterThan(5500) // cooler
    expect(raw.hue).toBeLessThan(0) // boost the low green channel

    const jpeg = wbFromPick(200, 100, 50, false)
    expect(jpeg.temp).toBeLessThan(0) // negative offset = cool
  })

  it('too much green maps to a magenta (positive) hue to neutralize it', () => {
    const { hue } = wbFromPick(100, 200, 100, false)
    expect(hue).toBeGreaterThan(0)
  })

  it('clamps temperature to the slider range', () => {
    const raw = wbFromPick(255, 60, 40, true)
    expect(raw.temp).toBeGreaterThanOrEqual(2500)
    expect(raw.temp).toBeLessThanOrEqual(10000)
    const jpeg = wbFromPick(255, 60, 40, false)
    expect(jpeg.temp).toBeGreaterThanOrEqual(-1)
    expect(jpeg.temp).toBeLessThanOrEqual(1)
  })
})
