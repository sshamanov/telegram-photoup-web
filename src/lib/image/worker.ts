/// <reference lib="webworker" />

import { encode as encodeJpeg444 } from '@jsquash/jpeg'

interface EncodeRequest {
  id: number
  /** RGBA bytes, transferred from the caller. */
  data: ArrayBuffer
  width: number
  height: number
  quality: number
  chroma: number
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

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
  const { id, data, width, height, quality, chroma } = event.data
  try {
    const imageData = new ImageData(new Uint8ClampedArray(data), width, height)
    const buffer = await encodeJpeg444(imageData, {
      quality,
      chroma_subsample: chroma,
      auto_subsample: false,
    })
    self.postMessage({ id, buffer } satisfies EncodeOk, [buffer])
  } catch (error) {
    const msg: EncodeErr = { id, error: error instanceof Error ? error.message : String(error) }
    self.postMessage(msg)
  }
}
