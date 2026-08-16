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
function buildToneLut(applyCameraCurve: boolean): Uint8Array {
  const lut = new Uint8Array(65536)
  for (let i = 0; i < 65536; i++) {
    const x = (i / 65535) * 2
    let b = linearToSrgbByte(highlightRolloff(x))
    if (applyCameraCurve) b = cameraCurveByte(b)
    lut[i] = b
  }
  return lut
}

const JPEG_TONE_LUT = buildToneLut(false)
const RAW_TONE_LUT = buildToneLut(true)

function toneIndex(v: number): number {
  return clamp(v * 32767.5, 0, 65535) | 0
}

function gainCoefficients(ev: number, adjustments: Adjustments, raw: boolean): { r: number; g: number; b: number } {
  const gain = Math.pow(2, ev)
  // RAW: color temperature (Kelvin) → warm/cool gains. 5500K neutral: lower warms,
  // higher cools. JPEG: no Kelvin reference, so a relative offset around 0.
  const tempR = raw
    ? Math.pow(1 / (adjustments.temperature / 5500), 0.6)
    : Math.pow(2, adjustments.wbOffset * 0.5)
  const tempB = raw
    ? Math.pow(adjustments.temperature / 5500, 0.6)
    : Math.pow(2, -adjustments.wbOffset * 0.5)
  // Hue: green↔magenta axis. +1 = magenta (more R/B, less G); -1 = green.
  const hueG = Math.pow(2, -adjustments.hue * 0.5)
  const hueRB = Math.pow(2, adjustments.hue * 0.25)
  return { r: gain * tempR * hueRB, g: gain * hueG, b: gain * tempB * hueRB }
}

/** Map a picked grey pixel onto the temperature + hue sliders (Lightroom-style). */
export function wbFromPick(r: number, g: number, b: number, raw: boolean): { temp: number; hue: number } {
  const gray = (r + g + b) / 3
  const hueG = gray / Math.max(g, 1)
  const hue = clamp(-2 * Math.log2(hueG) || 0, -1, 1)
  const hueRB = Math.pow(2, hue * 0.25)
  const tempR = gray / (Math.max(r, 1) * hueRB)
  if (raw) {
    // tempR = (5500/temp)^0.6  →  temp = 5500 / tempR^(1/0.6)
    return { temp: clamp(5500 / Math.pow(tempR, 1 / 0.6), 2500, 10000), hue }
  }
  // tempR = 2^(offset*0.5) → offset = 2*log2(tempR)
  return { temp: clamp(2 * Math.log2(tempR), -1, 1), hue }
}

function applyPixelTransform(data: Uint8ClampedArray, ev: number, adjustments: Adjustments): void {
  const { r: gainR, g: gainG, b: gainB } = gainCoefficients(ev, adjustments, false)
  for (let i = 0; i < data.length; i += 4) {
    const r = SRGB_TO_LINEAR[data[i]!]!
    const g = SRGB_TO_LINEAR[data[i + 1]!]!
    const b = SRGB_TO_LINEAR[data[i + 2]!]!
    data[i] = JPEG_TONE_LUT[toneIndex(r * gainR)]!
    data[i + 1] = JPEG_TONE_LUT[toneIndex(g * gainG)]!
    data[i + 2] = JPEG_TONE_LUT[toneIndex(b * gainB)]!
  }
}

function applyLinearTransform(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  ev: number,
  adjustments: Adjustments,
  out: Uint8ClampedArray,
): void {
  const { r: gainR, g: gainG, b: gainB } = gainCoefficients(ev, adjustments, true)
  for (let i = 0; i < r.length; i++) {
    const o = i * 4
    // Combined rolloff + sRGB + camera-Standard curve via LUT.
    out[o] = RAW_TONE_LUT[toneIndex(r[i]! * gainR)]!
    out[o + 1] = RAW_TONE_LUT[toneIndex(g[i]! * gainG)]!
    out[o + 2] = RAW_TONE_LUT[toneIndex(b[i]! * gainB)]!
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
): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'medium'
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height)
  const imageData = ctx.getImageData(0, 0, size.width, size.height)
  applyPixelTransform(imageData.data, ev, adjustments)
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
    const autoEV = autoExposureEV(luminances, { maxEV: 4 })
    const ev = adjustments.exposureMode === 'auto' ? autoEV : adjustments.exposureEV
    const canvas = await renderCanvas(this.source, rect, size, ev, adjustments)
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

  constructor(private readonly full: DecodedRaw, private readonly preview: DecodedRaw) {
    this.width = full.width
    this.height = full.height
  }

  async render(crop: NormalizedCrop | null, size: Size, adjustments: Adjustments): Promise<RenderedResult> {
    const src = Math.max(size.width, size.height) <= Math.max(this.preview.width, this.preview.height)
      ? this.preview
      : this.full
    const rect = cropRect(src.width, src.height, crop)

    const evSample = fitWithin(rect.width, rect.height, 128)
    const lums = this.luminances(src, rect, evSample)
    const autoEV = autoExposureEV(lums, { maxEV: 4 })
    const ev = adjustments.exposureMode === 'auto' ? autoEV : adjustments.exposureEV

    const r = downscaleCrop(src.r, src.width, src.height, rect, size.width, size.height)
    const g = downscaleCrop(src.g, src.width, src.height, rect, size.width, size.height)
    const b = downscaleCrop(src.b, src.width, src.height, rect, size.width, size.height)

    const imageData = new ImageData(size.width, size.height)
    applyLinearTransform(r, g, b, ev, adjustments, imageData.data)

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
): Promise<{ base: DecodedBase; exif: ExifInfo | null }> {
  if (sourceType === 'raw') {
    const decoded = await decodeRaw(buffer)
    return { base: new LinearRgbBase(decoded, makePreview(decoded)), exif: decoded.exif ?? null }
  }

  const bitmap = await createImageBitmap(new Blob([buffer]))
  return { base: new CanvasBase(bitmap, bitmap.width, bitmap.height, true), exif: extractJpegExif(buffer) }
}

export async function renderThumb(
  base: DecodedBase,
  adjustments: Adjustments,
  thumbEdge = 512,
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
