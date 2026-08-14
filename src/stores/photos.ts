import { writable, get } from 'svelte/store'
import type { Adjustments, ProcessStatus, SourceType } from '../lib/image/types'
import { neutralAdjustments } from '../lib/image/types'
import { processInWorker } from '../lib/image/queue'
import { processRaw, type ProcessedImage } from '../lib/image/process'
import { pushToast } from './ui'
import { settings } from './settings'
import { debugLog } from '../lib/debug'

export interface Photo {
  id: string
  file: File
  name: string
  sourceType: SourceType
  status: ProcessStatus
  selected: boolean
  adjustments: Adjustments
  thumbUrl: string | null
  outputBlob: Blob | null
  width: number
  height: number
  autoEV: number | null
  error: string | null
}

export const photos = writable<Photo[]>([])

function detectSourceType(file: File): SourceType {
  return /\.(nef|cr2|arw|dng|raf|orf)$/i.test(file.name) ? 'raw' : 'jpeg'
}

const queue: string[] = []
let draining = false

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  while (queue.length > 0) {
    const id = queue.shift()!
    await processOne(id)
  }
  draining = false
}

function enqueue(id: string): void {
  queue.push(id)
  void drain()
}

function patchPhoto(id: string, patch: Partial<Photo>): void {
  photos.update((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)))
}

async function processOne(id: string): Promise<void> {
  const item = get(photos).find((p) => p.id === id)
  if (!item) return

  patchPhoto(id, { status: 'processing', error: null })

  try {
    const buffer = await item.file.arrayBuffer()
    const format = get(settings).format
    debugLog('process', {
      id: item.id,
      type: item.sourceType,
      crop: item.adjustments.crop,
      ev: item.adjustments.exposureEV,
      mode: item.adjustments.exposureMode,
    })

    // RAW decode runs on the main thread: libraw-wasm spawns its own worker, and
    // its WASM does not initialize correctly inside a nested worker. JPEG uses our worker.
    const result: ProcessedImage = item.sourceType === 'raw'
      ? await processRaw(buffer, item.adjustments, { format })
      : await processInWorker({
          id: item.id,
          fileName: item.name,
          sourceType: item.sourceType,
          buffer,
          adjustments: item.adjustments,
          format,
        })

    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl)
    patchPhoto(id, {
      status: 'ready',
      thumbUrl: URL.createObjectURL(result.thumbnailBlob),
      outputBlob: result.outputBlob,
      width: result.width,
      height: result.height,
      autoEV: result.autoEV,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    patchPhoto(id, { status: 'error', error: message })
    pushToast('error', `Failed to process ${item.name}`)
  }
}

export function addPhotos(files: File[]): void {
  const items: Photo[] = files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    name: file.name,
    sourceType: detectSourceType(file),
    status: 'queued' as ProcessStatus,
    selected: true,
    adjustments: { ...neutralAdjustments, exposureMode: 'auto' },
    thumbUrl: null,
    outputBlob: null,
    width: 0,
    height: 0,
    autoEV: null,
    error: null,
  }))
  photos.update((list) => [...list, ...items])
  items.forEach((item) => enqueue(item.id))
}

export function toggleSelected(id: string): void {
  photos.update((list) => list.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)))
}

export function updateAdjustments(id: string, patch: Partial<Adjustments>): void {
  photos.update((list) =>
    list.map((p) => (p.id === id ? { ...p, adjustments: { ...p.adjustments, ...patch } } : p)),
  )
  enqueue(id)
}

export function resetAdjustments(id: string): void {
  photos.update((list) =>
    list.map((p) => (p.id === id ? { ...p, adjustments: { ...neutralAdjustments } } : p)),
  )
  enqueue(id)
}

export function clearPhotos(): void {
  for (const p of get(photos)) {
    if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl)
  }
  photos.set([])
}

/** Re-encode every finished photo with the current export format (called when format changes). */
export function reprocessAll(): void {
  for (const p of get(photos)) {
    if (p.status === 'ready' || p.status === 'error') {
      enqueue(p.id)
    }
  }
}
