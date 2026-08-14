let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ id: number; buffer?: ArrayBuffer; error?: string }>) => {
      const msg = event.data
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.buffer) entry.resolve(msg.buffer)
      else entry.reject(new Error(msg.error ?? 'encode worker error'))
    }
    worker.onerror = (event) => {
      const error = new Error(event.message || 'encode worker error')
      for (const entry of pending.values()) entry.reject(error)
      pending.clear()
    }
  }
  return worker
}

/** Encode an 8-bit RGBA ImageData to JPEG in the worker; returns a Blob. */
export function encodeJpeg444InWorker(
  imageData: ImageData,
  opts: { quality: number; chroma: number },
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, {
      resolve: (buffer) => resolve(new Blob([buffer], { type: 'image/jpeg' })),
      reject,
    })
    const buffer = imageData.data.buffer
    getWorker().postMessage(
      {
        id,
        data: buffer,
        width: imageData.width,
        height: imageData.height,
        quality: opts.quality,
        chroma: opts.chroma,
      },
      [buffer],
    )
  })
}
