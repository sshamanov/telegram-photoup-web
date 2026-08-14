import type { Adjustments, SourceType, WbGains } from './types'
import { clamp, fitWithin, cropToPixels, autoExposureEV } from './math'
import { decodeRaw } from './raw'
import { encode as encodeJpeg444 } from '@jsquash/jpeg'

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
  const buffer = await encodeJpeg444(imageData, {
    quality: 100,
    chroma_subsample: 1,
    auto_subsample: false,
  })
  return new Blob([buffer], { type: 'image/jpeg' })
}

export interface ProcessedImage {
  thumbnailBlob: Blob
  outputBlob: Blob
  width: number
  height: number
  autoEV: number
}

export interface ProcessOptions {
  thumbEdge?: number
  exportEdge?: number
}

async function processDecoded(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  adjustments: Adjustments,
  opts: ProcessOptions,
  maxAutoEV: number,
): Promise<ProcessedImage> {
  const { thumbEdge = 512, exportEdge = 2560 } = opts
  const crop = adjustments.crop
    ? cropToPixels(adjustments.crop, srcWidth, srcHeight)
    : { x: 0, y: 0, width: srcWidth, height: srcHeight }

  const luminances = sampleLuminances(source, crop)
  const autoEV = autoExposureEV(luminances, { maxEV: maxAutoEV })
  const ev = adjustments.exposureMode === 'auto' ? autoEV : adjustments.exposureEV

  const exportSize = fitWithin(crop.width, crop.height, exportEdge)
  const exportCanvas = await renderCanvas(source, crop, exportSize, ev, adjustments)
  const outputBlob = await encodeExport(exportCanvas)

  const thumbSize = fitWithin(crop.width, crop.height, thumbEdge)
  const thumbCanvas = await renderCanvas(source, crop, thumbSize, ev, adjustments)
  const thumbnailBlob = await encodeThumbnail(thumbCanvas)

  return {
    thumbnailBlob,
    outputBlob,
    width: exportSize.width,
    height: exportSize.height,
    autoEV,
  }
}

export async function processJpeg(
  buffer: ArrayBuffer,
  adjustments: Adjustments,
  opts: ProcessOptions = {},
): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(new Blob([buffer]))
  try {
    // JPEG needs up to +4 EV for the dark samples (measured: +3.2 to +4.0 EV)
    return await processDecoded(bitmap, bitmap.width, bitmap.height, adjustments, opts, 4)
  } finally {
    bitmap.close()
  }
}

export async function processRaw(
  buffer: ArrayBuffer,
  adjustments: Adjustments,
  opts: ProcessOptions = {},
): Promise<ProcessedImage> {
  const decoded = await decodeRaw(buffer)
  const canvas = new OffscreenCanvas(decoded.width, decoded.height)
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(new ImageData(decoded.rgba, decoded.width, decoded.height), 0, 0)
  return processDecoded(canvas, decoded.width, decoded.height, adjustments, opts, 4)
}

export async function processImage(
  buffer: ArrayBuffer,
  sourceType: SourceType,
  adjustments: Adjustments,
  opts: ProcessOptions = {},
): Promise<ProcessedImage> {
  return sourceType === 'raw' ? processRaw(buffer, adjustments, opts) : processJpeg(buffer, adjustments, opts)
}
