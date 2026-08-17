import { describe, expect, it } from 'vitest'
import { wbFromPick, cameraCurveByte } from '../src/lib/image/process'

describe('wbFromPick', () => {
  it('a neutral pixel maps to a neutral offset and hue', () => {
    expect(wbFromPick(128, 128, 128)).toEqual({ offset: 0, hue: 0 })
  })

  it('a warm pixel (r ≫ b) maps to a cool (negative) offset and green hue', () => {
    const r = wbFromPick(200, 100, 50)
    expect(r.offset).toBeLessThan(0) // cool to neutralize the warm pixel
    expect(r.hue).toBeLessThan(0) // boost the low green channel
  })

  it('too much green maps to a magenta (positive) hue to neutralize it', () => {
    const { hue } = wbFromPick(100, 200, 100)
    expect(hue).toBeGreaterThan(0)
  })

  it('clamps offset and hue to the slider range', () => {
    const r = wbFromPick(255, 60, 40)
    expect(r.offset).toBeGreaterThanOrEqual(-2)
    expect(r.offset).toBeLessThanOrEqual(2)
    expect(r.hue).toBeGreaterThanOrEqual(-2)
    expect(r.hue).toBeLessThanOrEqual(2)
  })

  it('a strongly warm pixel maps to an offset beyond -1 (previously clipped)', () => {
    const r = wbFromPick(200, 100, 50)
    expect(r.offset).toBeLessThan(-1)
  })
})

describe('cameraCurveByte', () => {
  it('adds mid-tone contrast (shadows deeper, highlights brighter)', () => {
    expect(cameraCurveByte(60)).toBeLessThan(60) // shadows compressed down
    expect(cameraCurveByte(200)).toBeGreaterThan(200) // highlights lifted up
  })

  it('preserves white and lifts blacks only slightly', () => {
    expect(cameraCurveByte(255)).toBe(255)
    expect(cameraCurveByte(0)).toBeLessThan(12) // ~3% shadow lift, not washed
  })

  it('keeps mid-gray near neutral', () => {
    expect(cameraCurveByte(128)).toBeGreaterThan(124)
    expect(cameraCurveByte(128)).toBeLessThan(136)
  })
})
