import type { NormalizedCrop } from './types'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Scale a size down so the longest edge is at most `maxEdge`, preserving aspect ratio. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Convert a normalized crop to integer pixel coordinates for a given source size. */
export function cropToPixels(crop: NormalizedCrop, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const x = Math.round(crop.x * width)
  const y = Math.round(crop.y * height)
  return {
    x,
    y,
    width: Math.max(1, Math.round(crop.width * width)),
    height: Math.max(1, Math.round(crop.height * height)),
  }
}

/**
 * Global auto-exposure as an EV offset, from a downsampled luminance distribution.
 * Uses an upper-middle percentile so dark shadows don't dominate, and a target
 * luminance. JPEG callers should pass a lower `maxEV` (already tone-mapped).
 */
export function autoExposureEV(
  luminances: Uint8Array | number[],
  opts: { target?: number; minEV?: number; maxEV?: number; percentile?: number } = {},
): number {
  const { target = 128, minEV = -3, maxEV = 4, percentile = 0.6 } = opts
  if (luminances.length === 0) return 0
  const sorted = [...luminances].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))
  const measured = sorted[idx] ?? 128
  const ev = Math.log2(target / Math.max(measured, 1))
  return clamp(ev, minEV, maxEV)
}

/**
 * 256-entry monotonic highlight-shoulder LUT.
 * strength 0 = linear; higher = softer rolloff of the top tonal range only.
 */
export function highlightShoulderLut(strength = 0.5): Uint8Array {
  const lut = new Uint8Array(256)
  const knee = 1 - clamp(strength, 0, 1) * 0.35
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    let y: number
    if (x <= knee) {
      y = x
    } else {
      const t = (x - knee) / (1 - knee)
      y = knee + (1 - knee) * (1 - Math.pow(1 - t, 1 + strength))
    }
    lut[i] = Math.round(y * 255)
  }
  return lut
}

/** Average channel means for a gray-world reference (used by neutral picker). */
export function channelMeans(rgb: Uint8Array): { r: number; g: number; b: number } {
  const n = rgb.length / 3
  if (n === 0) return { r: 0, g: 0, b: 0 }
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < rgb.length; i += 3) {
    r += rgb[i]!
    g += rgb[i + 1]!
    b += rgb[i + 2]!
  }
  return { r: r / n, g: g / n, b: b / n }
}
