/// <reference lib="webworker" />

import { processImage } from './process'
import type { ProcessRequest, ProcessResult, ProcessError } from './types'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = async (event: MessageEvent<ProcessRequest>) => {
  const req = event.data
  try {
    const out = await processImage(req.buffer, req.sourceType, req.adjustments)
    const msg: ProcessResult = {
      id: req.id,
      status: 'ready',
      thumbnailBlob: out.thumbnailBlob,
      outputs: out.outputs,
      width: out.width,
      height: out.height,
      autoEV: out.autoEV,
    }
    self.postMessage(msg)
  } catch (error) {
    const msg: ProcessError = { id: req.id, status: 'error', error: error instanceof Error ? error.message : String(error) }
    self.postMessage(msg)
  }
}
