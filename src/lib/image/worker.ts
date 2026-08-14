/// <reference lib="webworker" />

import { processJpeg } from './process'
import type { ProcessRequest, ProcessResult, ProcessError } from './types'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = async (event: MessageEvent<ProcessRequest>) => {
  const req = event.data
  if (req.sourceType === 'raw') {
    const msg: ProcessError = { id: req.id, status: 'error', error: 'RAW decode not yet wired (spike pending)' }
    self.postMessage(msg)
    return
  }

  try {
    const out = await processJpeg(req.buffer, req.adjustments)
    const msg: ProcessResult = {
      id: req.id,
      status: 'ready',
      thumbnailBlob: out.thumbnailBlob,
      outputBlob: out.outputBlob,
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
