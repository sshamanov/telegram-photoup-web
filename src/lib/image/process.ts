import type { Adjustments, NormalizedCrop, Rect, Size, SourceType } from './types'
import { clamp, fitWithin, cropToPixels, autoExposureEV } from './math'
import { decodeRaw, type DecodedRaw } from './raw'
import { extractJpegExif, type ExifInfo } from './exif'
import { downscalePlane, downscaleCrop } from './resize'
import { encodeJpeg444InWorker } from './encode'

const SRGB_TO_LINEAR = (() => {
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return lut
})()

function linearToSrgbByte(v: number): number {
  const c = clamp(v, 0, 1)
  const out = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.round(clamp(out, 0, 1) * 255)
}

/** Mild highlight rolloff in linear space — knee near 1.0, short transition, then hard clip. */
function highlightRolloff(x: number): number {
  const knee = 0.9
  const softness = 0.12
  if (x <= knee) return x
  const t = (x - knee) / softness
  return knee + softness * (1 - Math.exp(-t))
}

/** Camera "Standard"-style tone curve: mid-tone contrast + slight shadow lift, applied in sRGB. */
const CAMERA_CONTRAST = 1.4 // S-curve steepness around mid-gray (1 = identity)
const CAMERA_SHADOW_LIFT = 0.04

export function cameraCurveByte(v: number): number {
  const x = clamp(v / 255, 0, 1)
  // Smooth S-curve through (0,0), (0.5,0.5), (1,1): deepens mid-tones and compresses
  // shadows/highlights (which protects highlights alongside the linear rolloff).
  let y = Math.pow(x, CAMERA_CONTRAST) / (Math.pow(x, CAMERA_CONTRAST) + Math.pow(1 - x, CAMERA_CONTRAST))
  y = y * (1 - CAMERA_SHADOW_LIFT) + CAMERA_SHADOW_LIFT
  return Math.round(clamp(y, 0, 1) * 255)
}

/**
 * Precomputed linear→sRGB-byte LUT folding in the highlight rolloff (and, for RAW,
 * the camera-Standard curve). Replaces Math.pow/exp per pixel — the hot path of a
 * 2560px export. Index = linear value * 32767.5 covering linear [0, 2] (the rolloff
 * saturates by 2); larger values clip to white.
 */
function buildToneLut(applyCameraCurve: boolean, hardClip = false): Uint8Array {
  const lut = new Uint8Array(65536)
  for (let i = 0; i < 65536; i++) {
    const x = (i / 65535) * 2
    let b = hardClip ? linearToSrgbByte(x) : linearToSrgbByte(highlightRolloff(x))
    if (applyCameraCurve) b = cameraCurveByte(b)
    lut[i] = b
  }
  return lut
}

const JPEG_TONE_LUT = buildToneLut(false)
const RAW_TONE_LUT = buildToneLut(true)
// Aggressive auto ("film slide"): no highlight rolloff — highlights clip hard.
const JPEG_HARD_LUT = buildToneLut(false, true)
const RAW_HARD_LUT = buildToneLut(true, true)

function toneIndex(v: number): number {
  return clamp(v * 32767.5, 0, 65535) | 0
}

/** Warmth offset + hue as per-channel WB gains (exposure is separate). */
function wbGains(adjustments: Adjustments): { r: number; g: number; b: number } {
  // Relative warmth offset: 0 = no change. + = warmer (more R, less B).
  const tempR = Math.pow(2, adjustments.wbOffset * 0.5)
  const tempB = Math.pow(2, -adjustments.wbOffset * 0.5)
  // Hue: green↔magenta axis. +1 = magenta (more R/B, less G); -1 = green.
  const hueG = Math.pow(2, -adjustments.hue * 0.5)
  const hueRB = Math.pow(2, adjustments.hue * 0.25)
  return { r: tempR * hueRB, g: hueG, b: tempB * hueRB }
}

function gainCoefficients(ev: number, adjustments: Adjustments): { r: number; g: number; b: number } {
  const gain = Math.pow(2, ev)
  const wb = wbGains(adjustments)
  return { r: gain * wb.r, g: gain * wb.g, b: gain * wb.b }
}

export function invert3x3(m: number[][]): number[][] {
  const a0 = m[0]![0]!
  const a1 = m[0]![1]!
  const a2 = m[0]![2]!
  const b0 = m[1]![0]!
  const b1 = m[1]![1]!
  const b2 = m[1]![2]!
  const c0 = m[2]![0]!
  const c1 = m[2]![1]!
  const c2 = m[2]![2]!
  // Cofactors.
  const C00 = b1 * c2 - b2 * c1
  const C01 = b2 * c0 - b0 * c2
  const C02 = b0 * c1 - b1 * c0
  const C10 = a2 * c1 - a1 * c2
  const C11 = a0 * c2 - a2 * c0
  const C12 = a1 * c0 - a0 * c1
  const C20 = a1 * b2 - a2 * b1
  const C21 = a2 * b0 - a0 * b2
  const C22 = a0 * b1 - a1 * b0
  const det = a0 * C00 + b0 * C10 + c0 * C20
  if (Math.abs(det) < 1e-12) return []
  const inv = 1 / det
  return [
    [inv * C00, inv * C10, inv * C20],
    [inv * C01, inv * C11, inv * C21],
    [inv * C02, inv * C12, inv * C22],
  ]
}

/**
 * The preview WB transform that reproduces the pre-matrix userMul export:
 * T = M · diag(wb) · M⁻¹ applied to the baked camera-WB sRGB-linear data.
 * Returns the 3×3 as a flat row-major [t00,t01,t02,t10,...,t22].
 */
export function wbTransform3x3(M: number[][], Minv: number[][], wb: { r: number; g: number; b: number }): number[] | null {
  // M·diag(wb) — scale columns of M.
  const a = [
    M[0]![0]! * wb.r, M[0]![1]! * wb.g, M[0]![2]! * wb.b,
    M[1]![0]! * wb.r, M[1]![1]! * wb.g, M[1]![2]! * wb.b,
    M[2]![0]! * wb.r, M[2]![1]! * wb.g, M[2]![2]! * wb.b,
  ]
  if (Minv.length !== 3) return null
  const t: number[] = []
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      t.push(a[i * 3]! * Minv[0]![j]! + a[i * 3 + 1]! * Minv[1]![j]! + a[i * 3 + 2]! * Minv[2]![j]!)
    }
  }
  return t
}

/** Auto WB ("happy day" look): grey-world on a neutral reference, applied gently.
 * The temperature is corrected moderately, but the green↔magenta tint is kept
 * very conservative so it can't drift into visible green/magenta casts. */
export function autoWb(r: number, g: number, b: number, camMatrix?: number[][] | null): { offset: number; hue: number } {
  const wb = wbFromPick(r, g, b, camMatrix)
  const offsetStrength = 0.6 // apply a fraction of the grey-world warmth
  const hueStrength = 0.3 // keep the tint very gentle
  const warmBias = 0.15 // "happy day" warmth, avoids a blue shift
  return { offset: clamp(wb.offset * offsetStrength + warmBias, -2, 2), hue: wb.hue * hueStrength }
}

/** Map a picked grey pixel onto the warmth + hue sliders. With the camera color
 * matrix, invert through T = M·diag(wb)·M⁻¹ so the pixel lands exactly neutral. */
export function wbFromPick(r: number, g: number, b: number, camMatrix?: number[][] | null): { offset: number; hue: number } {
  if (camMatrix && camMatrix.length === 3) {
    const Minv = invert3x3(camMatrix)
    if (Minv.length === 3) {
      // q = M⁻¹·pixel (camera-RGB domain), s = M⁻¹·(1,1,1). Gains that neutralize:
      // wb = gray·s / q. (Assumes the current WB is neutral.)
      const q0 = Minv[0]![0]! * r + Minv[0]![1]! * g + Minv[0]![2]! * b
      const q1 = Minv[1]![0]! * r + Minv[1]![1]! * g + Minv[1]![2]! * b
      const q2 = Minv[2]![0]! * r + Minv[2]![1]! * g + Minv[2]![2]! * b
      const s0 = Minv[0]![0]! + Minv[0]![1]! + Minv[0]![2]!
      const s1 = Minv[1]![0]! + Minv[1]![1]! + Minv[1]![2]!
      const s2 = Minv[2]![0]! + Minv[2]![1]! + Minv[2]![2]!
      const gray = (r + g + b) / 3
      const gr = gray * s0 / Math.max(q0, 1e-6)
      const gg = gray * s1 / Math.max(q1, 1e-6)
      const gb = gray * s2 / Math.max(q2, 1e-6)
      const hue = clamp(-2 * Math.log2(Math.max(gg, 1e-6)) || 0, -2, 2)
      const hueRB = Math.pow(2, hue * 0.25)
      const tempR = gr / Math.max(hueRB, 1e-6)
      const offset = clamp(2 * Math.log2(Math.max(tempR, 1e-6)), -2, 2)
      return { offset, hue }
    }
  }
  const gray = (r + g + b) / 3
  const hueG = gray / Math.max(g, 1)
  const hue = clamp(-2 * Math.log2(hueG) || 0, -2, 2)
  const hueRB = Math.pow(2, hue * 0.25)
  const tempR = gray / (Math.max(r, 1) * hueRB)
  // tempR = 2^(offset*0.5) → offset = 2*log2(tempR)
  return { offset: clamp(2 * Math.log2(tempR), -2, 2), hue }
}

/**
 * Effective WB multipliers for the final export: the camera as-shot WB (camMul)
 * scaled by the user's warmth offset + hue. Passed to libraw's userMul so the
 * final WB is applied BEFORE the camera color matrix (the colorimetrically
 * correct order), giving the exported photo the proper WB.
 */
export function exportWbMul(camMul: number[], adjustments: Adjustments): [number, number, number, number] {
  const rc = camMul[0] ?? 1
  const gc = camMul[1] ?? 1
  const bc = camMul[2] ?? 1
  const g2c = camMul[3] ?? gc
  const tempR = Math.pow(2, adjustments.wbOffset * 0.5)
  const tempB = Math.pow(2, -adjustments.wbOffset * 0.5)
  const hueG = Math.pow(2, -adjustments.hue * 0.5)
  const hueRB = Math.pow(2, adjustments.hue * 0.25)
  const r = rc * tempR * hueRB
  const g = gc * hueG
  const b = bc * tempB * hueRB
  const g2 = g2c * hueG
  return [r / g, 1, b / g, g2 / g]
}

function applyPixelTransform(data: Uint8ClampedArray, ev: number, adjustments: Adjustments, hardClip = false): void {
  const { r: gainR, g: gainG, b: gainB } = gainCoefficients(ev, adjustments)
  const lut = hardClip ? JPEG_HARD_LUT : JPEG_TONE_LUT
  for (let i = 0; i < data.length; i += 4) {
    const r = SRGB_TO_LINEAR[data[i]!]!
    const g = SRGB_TO_LINEAR[data[i + 1]!]!
    const b = SRGB_TO_LINEAR[data[i + 2]!]!
    data[i] = lut[toneIndex(r * gainR)]!
    data[i + 1] = lut[toneIndex(g * gainG)]!
    data[i + 2] = lut[toneIndex(b * gainB)]!
  }
}

function applyLinearTransform(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  ev: number,
  adjustments: Adjustments,
  out: Uint8ClampedArray,
  camMatrix: number[][] | null = null,
  hardClip = false,
): void {
  const gain = Math.pow(2, ev)
  const wb = wbGains(adjustments)
  const lut = hardClip ? RAW_HARD_LUT : RAW_TONE_LUT
  // With the camera color matrix, apply the WB as T = M·diag(wb)·M⁻¹ so the
  // preview matches the pre-matrix userMul export. Fall back to per-channel gains.
  const Minv = camMatrix ? invert3x3(camMatrix) : []
  const t = camMatrix ? wbTransform3x3(camMatrix, Minv, wb) : null

  if (t) {
    for (let i = 0; i < r.length; i++) {
      const o = i * 4
      const r0 = r[i]!
      const g0 = g[i]!
      const b0 = b[i]!
      const r1 = (t[0]! * r0 + t[1]! * g0 + t[2]! * b0) * gain
      const g1 = (t[3]! * r0 + t[4]! * g0 + t[5]! * b0) * gain
      const b1 = (t[6]! * r0 + t[7]! * g0 + t[8]! * b0) * gain
      out[o] = lut[toneIndex(r1)]!
      out[o + 1] = lut[toneIndex(g1)]!
      out[o + 2] = lut[toneIndex(b1)]!
      out[o + 3] = 255
    }
    return
  }

  for (let i = 0; i < r.length; i++) {
    const o = i * 4
    // Combined rolloff + sRGB + camera-Standard curve via LUT.
    out[o] = lut[toneIndex(r[i]! * gain * wb.r)]!
    out[o + 1] = lut[toneIndex(g[i]! * gain * wb.g)]!
    out[o + 2] = lut[toneIndex(b[i]! * gain * wb.b)]!
    out[o + 3] = 255
  }
}

function sampleLuminances(
  source: CanvasImageSource,
  crop: { x: number; y: number; width: number; height: number },
): Uint8Array {
  const scale = Math.min(1, 128 / Math.max(crop.width, crop.height))
  const w = Math.max(1, Math.round(crop.width * scale))
  const h = Math.max(1, Math.round(crop.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const lums = new Uint8Array(w * h)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    lums[j] = Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!)
  }
  return lums
}

async function renderCanvas(
  source: CanvasImageSource,
  crop: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
  ev: number,
  adjustments: Adjustments,
  hardClip = false,
): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height)
  const imageData = ctx.getImageData(0, 0, size.width, size.height)
  applyPixelTransform(imageData.data, ev, adjustments, hardClip)
  ctx.putImageData(imageData, 0, 0)
  return canvas
}

async function encodeThumbnail(canvas: OffscreenCanvas): Promise<Blob> {
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
}

/** Single export format: JPEG 4:4:4 Q100 — measured best, survives Telegram re-encoding. */
async function encodeExport(canvas: OffscreenCanvas): Promise<Blob> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return encodeJpeg444InWorker(imageData, { quality: 100, chroma: 1 })
}

/** 256-bin luminance histogram over the final sRGB pixels (post exposure/WB/rolloff). */
function computeHistogram(canvas: OffscreenCanvas): Uint32Array {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const bins = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
    bins[l | 0]!++
  }
  return bins
}

export interface RenderedResult {
  canvas: OffscreenCanvas
  autoEV: number
}

/**
 * A decoded source, ready to render at any size. `render` applies exposure/WB/
 * rolloff and returns an sRGB 8-bit canvas plus the auto-exposure EV. Held outside
 * the reactive store; released via `dispose` when no longer needed.
 */
export interface DecodedBase {
  readonly width: number
  readonly height: number
  render(crop: NormalizedCrop | null, size: Size, adjustments: Adjustments): Promise<RenderedResult>
  dispose(): void
}

export function cropRect(width: number, height: number, crop: NormalizedCrop | null): Rect {
  return crop ? cropToPixels(crop, width, height) : { x: 0, y: 0, width, height }
}

/** The size the export would be rendered at, for display purposes. */
export function exportDimensions(
  base: DecodedBase,
  adjustments: Adjustments,
  exportEdge = 2560,
): Size {
  const rect = cropRect(base.width, base.height, adjustments.crop)
  return fitWithin(rect.width, rect.height, exportEdge)
}

class CanvasBase implements DecodedBase {
  readonly width: number
  readonly height: number

  constructor(
    private readonly source: CanvasImageSource,
    width: number,
    height: number,
    private readonly closeOnDispose: boolean,
  ) {
    this.width = width
    this.height = height
  }

  async render(crop: NormalizedCrop | null, size: Size, adjustments: Adjustments): Promise<RenderedResult> {
    const rect = cropRect(this.width, this.height, crop)
    const luminances = sampleLuminances(this.source, rect)
    const aggressive = adjustments.exposureMode === 'aggressive'
    const autoEV = autoExposureEV(luminances, { maxEV: 4, target: aggressive ? 230 : 180, percentile: 0.6 })
    const ev = adjustments.exposureMode === 'manual' ? adjustments.exposureEV : autoEV
    const canvas = await renderCanvas(this.source, rect, size, ev, adjustments, aggressive)
    return { canvas, autoEV }
  }

  dispose(): void {
    if (this.closeOnDispose && this.source instanceof ImageBitmap) this.source.close()
  }
}

/** Preview edge: edits render from a small linear copy so slider feedback stays instant. */
const PREVIEW_EDGE = 1024

class LinearRgbBase implements DecodedBase {
  readonly width: number
  readonly height: number
  private readonly camMatrix: number[][] | null

  constructor(private readonly full: DecodedRaw, private readonly preview: DecodedRaw) {
    this.width = full.width
    this.height = full.height
    this.camMatrix = full.camMatrix ?? null
  }

  async render(crop: NormalizedCrop | null, size: Size, adjustments: Adjustments): Promise<RenderedResult> {
    const src = Math.max(size.width, size.height) <= Math.max(this.preview.width, this.preview.height)
      ? this.preview
      : this.full
    const rect = cropRect(src.width, src.height, crop)

    const evSample = fitWithin(rect.width, rect.height, 128)
    const lums = this.luminances(src, rect, evSample)
    const aggressive = adjustments.exposureMode === 'aggressive'
    const autoEV = autoExposureEV(lums, { maxEV: 4, target: aggressive ? 230 : 180, percentile: 0.6 })
    const ev = adjustments.exposureMode === 'manual' ? adjustments.exposureEV : autoEV

    const r = downscaleCrop(src.r, src.width, src.height, rect, size.width, size.height)
    const g = downscaleCrop(src.g, src.width, src.height, rect, size.width, size.height)
    const b = downscaleCrop(src.b, src.width, src.height, rect, size.width, size.height)

    const imageData = new ImageData(size.width, size.height)
    applyLinearTransform(r, g, b, ev, adjustments, imageData.data, this.camMatrix, aggressive)

    const canvas = new OffscreenCanvas(size.width, size.height)
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(imageData, 0, 0)
    return { canvas, autoEV }
  }

  private luminances(src: DecodedRaw, rect: Rect, size: Size): Uint8Array {
    const r = downscaleCrop(src.r, src.width, src.height, rect, size.width, size.height)
    const g = downscaleCrop(src.g, src.width, src.height, rect, size.width, size.height)
    const b = downscaleCrop(src.b, src.width, src.height, rect, size.width, size.height)
    const n = size.width * size.height
    const lums = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const sr = linearToSrgbByte(clamp(r[i]!, 0, 1))
      const sg = linearToSrgbByte(clamp(g[i]!, 0, 1))
      const sb = linearToSrgbByte(clamp(b[i]!, 0, 1))
      lums[i] = Math.round(0.2126 * sr + 0.7152 * sg + 0.0722 * sb)
    }
    return lums
  }

  dispose(): void {
    // Planar Float32Arrays are reclaimed by GC; nothing to close.
  }
}

function makePreview(full: DecodedRaw): DecodedRaw {
  if (Math.max(full.width, full.height) <= PREVIEW_EDGE) return full
  const size = fitWithin(full.width, full.height, PREVIEW_EDGE)
  return {
    width: size.width,
    height: size.height,
    r: downscalePlane(full.r, full.width, full.height, size.width, size.height),
    g: downscalePlane(full.g, full.width, full.height, size.width, size.height),
    b: downscalePlane(full.b, full.width, full.height, size.width, size.height),
  }
}

export async function decodeBase(
  buffer: ArrayBuffer,
  sourceType: SourceType,
  opts: { fullSize?: boolean; userMul?: [number, number, number, number] | null } = {},
): Promise<{ base: DecodedBase; exif: ExifInfo | null; camMul: number[] | null; camMatrix: number[][] | null }> {
  if (sourceType === 'raw') {
    const decoded = await decodeRaw(buffer, { fullSize: opts.fullSize, userMul: opts.userMul })
    // Full-size export bases skip the small preview (we only render from the full).
    const preview = opts.fullSize ? decoded : makePreview(decoded)
    return {
      base: new LinearRgbBase(decoded, preview),
      exif: decoded.exif ?? null,
      camMul: decoded.camMul ?? null,
      camMatrix: decoded.camMatrix ?? null,
    }
  }

  const bitmap = await createImageBitmap(new Blob([buffer]))
  return {
    base: new CanvasBase(bitmap, bitmap.width, bitmap.height, true),
    exif: extractJpegExif(buffer),
    camMul: null,
    camMatrix: null,
  }
}

export async function renderThumb(
  base: DecodedBase,
  adjustments: Adjustments,
  thumbEdge = 1024,
): Promise<{ blob: Blob; autoEV: number; width: number; height: number; histogram: Uint32Array }> {
  const rect = cropRect(base.width, base.height, adjustments.crop)
  const size = fitWithin(rect.width, rect.height, thumbEdge)
  const { canvas, autoEV } = await base.render(adjustments.crop, size, adjustments)
  const histogram = computeHistogram(canvas)
  const blob = await encodeThumbnail(canvas)
  return { blob, autoEV, width: size.width, height: size.height, histogram }
}

/** Render the final ≤2560px sRGB canvas (no encode) for a photo. */
export async function renderExportCanvas(
  base: DecodedBase,
  adjustments: Adjustments,
  exportEdge = 2560,
): Promise<OffscreenCanvas> {
  const rect = cropRect(base.width, base.height, adjustments.crop)
  const size = fitWithin(rect.width, rect.height, exportEdge)
  const { canvas } = await base.render(adjustments.crop, size, adjustments)
  return canvas
}

export async function renderExport(
  base: DecodedBase,
  adjustments: Adjustments,
  exportEdge = 2560,
): Promise<Blob> {
  return encodeExport(await renderExportCanvas(base, adjustments, exportEdge))
}
