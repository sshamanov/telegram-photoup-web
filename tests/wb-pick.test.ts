import { describe, expect, it } from 'vitest'
import { wbFromPick, cameraCurveByte, invert3x3, wbTransform3x3 } from '../src/lib/image/process'

function matVec(m: number[][], v: number[]): number[] {
  return [
    m[0]![0]! * v[0]! + m[0]![1]! * v[1]! + m[0]![2]! * v[2]!,
    m[1]![0]! * v[0]! + m[1]![1]! * v[1]! + m[1]![2]! * v[2]!,
    m[2]![0]! * v[0]! + m[2]![1]! * v[1]! + m[2]![2]! * v[2]!,
  ]
}

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
})

describe('preview WB transform matches the pre-matrix export', () => {
  // A plausible camera→sRGB matrix (row-major).
  const M = [
    [2.24, -0.93, -0.31],
    [-0.72, 1.68, 0.04],
    [-0.08, -0.24, 1.32],
  ]
  const camMul = [2.06, 1, 1.39]
  const camRGB = [0.4, 0.3, 0.2]
  const wb = { r: 1.414, g: 0.9, b: 0.707 } // warm-ish + hue

  it('T·(M·diag(camMul)) == M·diag(camMul·wb) for the same sensor pixel', () => {
    const Minv = invert3x3(M)
    expect(Minv.length).toBe(3)

    // Export: WB baked pre-matrix → M·diag(camMul·wb)·camRGB
    const exportVec = matVec(M, [
      camMul[0]! * wb.r * camRGB[0]!,
      camMul[1]! * wb.g * camRGB[1]!,
      camMul[2]! * wb.b * camRGB[2]!,
    ])

    // Preview: camera WB baked, then T = M·diag(wb)·M⁻¹
    const base = matVec(M, [camMul[0]! * camRGB[0]!, camMul[1]! * camRGB[1]!, camMul[2]! * camRGB[2]!])
    const t = wbTransform3x3(M, Minv, wb)
    expect(t).not.toBeNull()
    const previewVec = [
      t![0]! * base[0]! + t![1]! * base[1]! + t![2]! * base[2]!,
      t![3]! * base[0]! + t![4]! * base[1]! + t![5]! * base[2]!,
      t![6]! * base[0]! + t![7]! * base[1]! + t![8]! * base[2]!,
    ]

    expect(previewVec[0]).toBeCloseTo(exportVec[0]!, 4)
    expect(previewVec[1]).toBeCloseTo(exportVec[1]!, 4)
    expect(previewVec[2]).toBeCloseTo(exportVec[2]!, 4)
  })

  it('a neutral pixel picks a neutral WB (offset 0, hue 0)', () => {
    // Neutral scene in camera domain maps to a neutral output (white-point M).
    const p = matVec(M, [0.5, 0.5, 0.5])
    const { offset, hue } = wbFromPick(p[0]!, p[1]!, p[2]!, M)
    expect(offset).toBeCloseTo(0, 2)
    expect(hue).toBeCloseTo(0, 2)
  })

  it('a warm-cast pixel picks a correction that reduces the cast', () => {
    const Minv = invert3x3(M)
    // A warm output pixel (R > B).
    const p = [0.62, 0.5, 0.4]
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v)
    const before = spread(p)

    const { offset, hue } = wbFromPick(p[0]!, p[1]!, p[2]!, M)
    const tempR = Math.pow(2, offset * 0.5)
    const tempB = Math.pow(2, -offset * 0.5)
    const hueG = Math.pow(2, -hue * 0.5)
    const hueRB = Math.pow(2, hue * 0.25)
    const g = { r: tempR * hueRB, g: hueG, b: tempB * hueRB }
    const t = wbTransform3x3(M, Minv, g)!
    const out = [
      t[0]! * p[0]! + t[1]! * p[1]! + t[2]! * p[2]!,
      t[3]! * p[0]! + t[4]! * p[1]! + t[5]! * p[2]!,
      t[6]! * p[0]! + t[7]! * p[1]! + t[8]! * p[2]!,
    ]
    // The 2-parameter WB model can't make it perfectly neutral, but it must reduce
    // the channel spread (the cast).
    expect(spread(out)).toBeLessThan(before)
  })

  it('is identity when the WB gains are neutral', () => {
    const Minv = invert3x3(M)
    const t = wbTransform3x3(M, Minv, { r: 1, g: 1, b: 1 })!
    const v = [0.5, 0.4, 0.3]
    const out = [t[0]! * v[0]! + t[1]! * v[1]! + t[2]! * v[2]!, t[3]! * v[0]! + t[4]! * v[1]! + t[5]! * v[2]!, t[6]! * v[0]! + t[7]! * v[1]! + t[8]! * v[2]!]
    expect(out[0]).toBeCloseTo(v[0]!, 4)
    expect(out[1]).toBeCloseTo(v[1]!, 4)
    expect(out[2]).toBeCloseTo(v[2]!, 4)
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
