const POOL_SIZE = typeof navigator !== 'undefined' ? Math.min(4, navigator.hardwareConcurrency || 4) : 4

let workers: Worker[] | null = null
let nextId = 1
let roundRobin = 0
const pending = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }>()

function getWorkers(): Worker[] {
  if (!workers) {
    workers = []
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (event: MessageEvent<{ id: number; buffer?: ArrayBuffer; error?: string }>) => {
        const msg = event.data
        const entry = pending.get(msg.id)
        if (!entry) return
        pending.delete(msg.id)
        if (msg.buffer) entry.resolve(msg.buffer)
        else entry.reject(new Error(msg.error ?? 'encode worker error'))
      }
      w.onerror = (event) => {
        const error = new Error(event.message || 'encode worker error')
        for (const entry of pending.values()) entry.reject(error)
        pending.clear()
      }
      workers.push(w)
    }
  }
  return workers
}

/** Encode an 8-bit RGBA ImageData to JPEG in a worker pool; returns a Blob. */
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
    const pool = getWorkers()
    const worker = pool[roundRobin++ % pool.length]!
    worker.postMessage(
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
