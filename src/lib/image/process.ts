import type { Adjustments, NormalizedCrop, SourceType, WbGains } from './types'
import { clamp, fitWithin, cropToPixels, autoExposureEV } from './math'
import { decodeRaw } from './raw'
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

function applyPixelTransform(data: Uint8ClampedArray, ev: number, adjustments: Adjustments): void {
  const gain = Math.pow(2, ev)
  const wb: WbGains = adjustments.neutralGains ?? { r: 1, g: 1, b: 1 }
  const temp = adjustments.temperature
  const tempR = Math.pow(2, temp * 0.15)
  const tempB = Math.pow(2, -temp * 0.15)
  const gainR = gain * wb.r * tempR
  const gainG = gain * wb.g
  const gainB = gain * wb.b * tempB

  for (let i = 0; i < data.length; i += 4) {
    const r = SRGB_TO_LINEAR[data[i]!]!
    const g = SRGB_TO_LINEAR[data[i + 1]!]!
    const b = SRGB_TO_LINEAR[data[i + 2]!]!
    data[i] = linearToSrgbByte(highlightRolloff(r * gainR))
    data[i + 1] = linearToSrgbByte(highlightRolloff(g * gainG))
    data[i + 2] = linearToSrgbByte(highlightRolloff(b * gainB))
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
  ctx.imageSmoothingQuality = 'high'
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

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface RenderedResult {
  canvas: OffscreenCanvas
  autoEV: number
}

/**
 * A decoded source, ready to render at any size. Renders the (cropped) region
 * at `size`, applying exposure/WB/rolloff, and returns an sRGB 8-bit canvas plus
 * the auto-exposure EV it would use. Held outside the reactive store; released
 * when no longer needed (see `dispose`).
 */
export interface DecodedBase {
  readonly width: number
  readonly height: number
  render(crop: Rect, size: Size, adjustments: Adjustments): Promise<RenderedResult>
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

  async render(crop: Rect, size: Size, adjustments: Adjustments): Promise<RenderedResult> {
    const luminances = sampleLuminances(this.source, crop)
    const autoEV = autoExposureEV(luminances, { maxEV: 4 })
    const ev = adjustments.exposureMode === 'auto' ? autoEV : adjustments.exposureEV
    const canvas = await renderCanvas(this.source, crop, size, ev, adjustments)
    return { canvas, autoEV }
  }

  dispose(): void {
    if (this.closeOnDispose && this.source instanceof ImageBitmap) this.source.close()
  }
}

export async function decodeBase(buffer: ArrayBuffer, sourceType: SourceType): Promise<DecodedBase> {
  if (sourceType === 'raw') {
    const decoded = await decodeRaw(buffer)
    const canvas = new OffscreenCanvas(decoded.width, decoded.height)
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(new ImageData(decoded.rgba, decoded.width, decoded.height), 0, 0)
    return new CanvasBase(canvas, decoded.width, decoded.height, false)
  }

  const bitmap = await createImageBitmap(new Blob([buffer]))
  return new CanvasBase(bitmap, bitmap.width, bitmap.height, true)
}

export async function renderThumb(
  base: DecodedBase,
  adjustments: Adjustments,
  thumbEdge = 512,
): Promise<{ blob: Blob; autoEV: number; width: number; height: number }> {
  const rect = cropRect(base.width, base.height, adjustments.crop)
  const size = fitWithin(rect.width, rect.height, thumbEdge)
  const { canvas, autoEV } = await base.render(rect, size, adjustments)
  const blob = await encodeThumbnail(canvas)
  return { blob, autoEV, width: size.width, height: size.height }
}

export async function renderExport(
  base: DecodedBase,
  adjustments: Adjustments,
  exportEdge = 2560,
): Promise<Blob> {
  const rect = cropRect(base.width, base.height, adjustments.crop)
  const size = fitWithin(rect.width, rect.height, exportEdge)
  const { canvas } = await base.render(rect, size, adjustments)
  return encodeExport(canvas)
}
