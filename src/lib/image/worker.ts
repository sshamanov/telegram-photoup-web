/// <reference lib="webworker" />

import { encode as encodeJpeg } from '@jsquash/jpeg'

/** Telegram rejects photos above ~10 MiB with PHOTO_SAVE_FILE_INVALID. */
export const MAX_PHOTO_BYTES = 10_000_000

interface EncodeRequest {
  id: number
  /** RGBA bytes, transferred from the caller. */
  data: ArrayBuffer
  width: number
  height: number
  chroma: number
  /** If set, the worker picks the highest quality whose file fits this budget. */
  maxBytes?: number
}

interface EncodeOk {
  id: number
  buffer: ArrayBuffer
}

interface EncodeErr {
  id: number
  error: string
}

declare const self: DedicatedWorkerGlobalScope

// mozjpeg options that shrink the file without lowering the quality level.
function makeOptions(quality: number, chroma: number): Parameters<typeof encodeJpeg>[1] {
  return {
    quality,
    chroma_subsample: chroma,
    auto_subsample: false,
    optimize_coding: true,
    baseline: true,
    trellis_multipass: true,
    trellis_opt_zero: true,
    trellis_opt_table: true,
    trellis_loops: 1,
  }
}

async function encodeAdaptive(imageData: ImageData, chroma: number, maxBytes: number): Promise<ArrayBuffer> {
  // Try maximum quality first; only lower it if the file would exceed the budget.
  let best = await encodeJpeg(imageData, makeOptions(100, chroma))
  if (best.byteLength <= maxBytes) return best
  let lo = 40
  let hi = 100
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const buf = await encodeJpeg(imageData, makeOptions(mid, chroma))
    if (buf.byteLength <= maxBytes) {
      best = buf
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { id, data, width, height, chroma, maxBytes } = event.data
  try {
    const imageData = new ImageData(new Uint8ClampedArray(data), width, height)
    const buffer = await encodeAdaptive(imageData, chroma, maxBytes ?? MAX_PHOTO_BYTES)
    self.postMessage({ id, buffer } satisfies EncodeOk, [buffer])
  } catch (error) {
    const msg: EncodeErr = { id, error: error instanceof Error ? error.message : String(error) }
    self.postMessage(msg)
  }
}
