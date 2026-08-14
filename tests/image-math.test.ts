import { describe, it, expect } from 'vitest'
import { fitWithin, cropToPixels, autoExposureEV, highlightShoulderLut, channelMeans, clamp } from '../src/lib/image/math'

describe('fitWithin', () => {
  it('downscales a landscape image to the max long edge', () => {
    expect(fitWithin(7360, 4912, 2560)).toEqual({ width: 2560, height: 1709 })
  })

  it('does not upscale a small image', () => {
    expect(fitWithin(800, 600, 2560)).toEqual({ width: 800, height: 600 })
  })
})

describe('cropToPixels', () => {
  it('maps a center half crop to pixel coordinates', () => {
    expect(cropToPixels({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 400, 200)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 100,
    })
  })
})

describe('autoExposureEV', () => {
  it('brightens a dark image', () => {
    const dark = new Uint8Array(1000).fill(30)
    expect(autoExposureEV(dark)).toBeGreaterThan(0)
  })

  it('darkens an overbright image', () => {
    const bright = new Uint8Array(1000).fill(230)
    expect(autoExposureEV(bright)).toBeLessThan(0)
  })

  it('returns near zero for a mid-toned image', () => {
    const mid = new Uint8Array(1000).fill(128)
    expect(Math.abs(autoExposureEV(mid))).toBeLessThan(0.2)
  })

  it('respects the JPEG max EV ceiling', () => {
    const dark = new Uint8Array(1000).fill(10)
    expect(autoExposureEV(dark, { maxEV: 2 })).toBeLessThanOrEqual(2)
  })
})

describe('highlightShoulderLut', () => {
  it('is monotonic with fixed endpoints', () => {
    const lut = highlightShoulderLut(0.5)
    expect(lut[0]).toBe(0)
    expect(lut[255]).toBe(255)
    let prev = -1
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('is identity at strength 0', () => {
    const lut = highlightShoulderLut(0)
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i)
  })
})

describe('channelMeans', () => {
  it('computes per-channel averages', () => {
    const rgb = new Uint8Array([10, 20, 30, 30, 40, 50])
    expect(channelMeans(rgb)).toEqual({ r: 20, g: 30, b: 40 })
  })
})

describe('clamp', () => {
  it('clamps within bounds', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })
})
