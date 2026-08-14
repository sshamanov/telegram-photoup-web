import type { ProcessRequest, ProcessResult, ProcessError } from './types'

let worker: Worker | null = null
const pending = new Map<string, { resolve: (r: ProcessResult) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<ProcessResult | ProcessError>) => {
      const msg = event.data
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.status === 'ready') entry.resolve(msg)
      else entry.reject(new Error(msg.error))
    }
    worker.onerror = (event) => {
      const error = new Error(event.message || 'worker error')
      for (const entry of pending.values()) entry.reject(error)
      pending.clear()
    }
  }
  return worker
}

/** Run one process request in the image worker. */
export function processInWorker(req: ProcessRequest): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const workerInstance = getWorker()
    pending.set(req.id, { resolve, reject })
    workerInstance.postMessage(req)
  })
}
