import { writable, get } from 'svelte/store'
import type { Adjustments, ProcessStatus, SourceType } from '../lib/image/types'
import { neutralAdjustments } from '../lib/image/types'
import {
  decodeBase,
  renderThumb,
  renderExport,
  exportDimensions,
  type DecodedBase,
} from '../lib/image/process'
import type { UploadPhoto } from '../types/telegram'
import { pushToast } from './ui'
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
  width: number
  height: number
  autoEV: number | null
  error: string | null
}

export const photos = writable<Photo[]>([])

function detectSourceType(file: File): SourceType {
  return /\.(nef|cr2|arw|dng|raf|orf)$/i.test(file.name) ? 'raw' : 'jpeg'
}

function toJpgName(base: string): string {
  return base.replace(/\.[^.]+$/, '') + '.jpg'
}

/**
 * Decoded sources, keyed by photo id and held OUTSIDE the reactive store.
 * Kept only while a photo is being edited or exported; released otherwise so
 * memory stays bounded (the original file bytes are always retained for re-decode).
 */
const bases = new Map<string, DecodedBase>()

const queue: Array<{ id: string; releaseAfter: boolean }> = []
let draining = false

function patchPhoto(id: string, patch: Partial<Photo>): void {
  photos.update((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)))
}

/** Decode a photo's source once, caching the result. Reused across edits/exports. */
export async function ensureBase(id: string): Promise<DecodedBase> {
  const cached = bases.get(id)
  if (cached) return cached
  const item = get(photos).find((p) => p.id === id)
  if (!item) throw new Error('Photo not found')
  debugLog('decode', { id, type: item.sourceType })
  const buffer = await item.file.arrayBuffer()
  const base = await decodeBase(buffer, item.sourceType)
  bases.set(id, base)
  return base
}

/** Drop a photo's decoded source (its file bytes remain available). */
export function releaseBase(id: string): void {
  const base = bases.get(id)
  if (!base) return
  base.dispose()
  bases.delete(id)
}

function releaseAllBases(): void {
  for (const base of bases.values()) base.dispose()
  bases.clear()
}

async function refreshThumb(id: string, releaseAfter: boolean): Promise<void> {
  const item = get(photos).find((p) => p.id === id)
  if (!item) return
  if (item.status === 'queued') patchPhoto(id, { status: 'processing', error: null })

  try {
    const base = await ensureBase(id)
    const latest = get(photos).find((p) => p.id === id)
    if (!latest) return

    debugLog('render', {
      id,
      crop: latest.adjustments.crop,
      ev: latest.adjustments.exposureEV,
      mode: latest.adjustments.exposureMode,
    })

    const dims = exportDimensions(base, latest.adjustments)
    const { blob, autoEV } = await renderThumb(base, latest.adjustments)

    const current = get(photos).find((p) => p.id === id)
    if (!current) return
    if (current.thumbUrl) URL.revokeObjectURL(current.thumbUrl)
    patchPhoto(id, {
      status: 'ready',
      thumbUrl: URL.createObjectURL(blob),
      width: dims.width,
      height: dims.height,
      autoEV,
    })

    if (releaseAfter) releaseBase(id)
  } catch (error) {
    releaseBase(id)
    const message = error instanceof Error ? error.message : String(error)
    patchPhoto(id, { status: 'error', error: message })
    pushToast('error', `Failed to process ${item.name}`)
  }
}

function enqueue(id: string, releaseAfter = false): void {
  if (queue.some((q) => q.id === id)) return
  queue.push({ id, releaseAfter })
  void drain()
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  while (queue.length > 0) {
    const { id, releaseAfter } = queue.shift()!
    await refreshThumb(id, releaseAfter)
  }
  draining = false
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
    width: 0,
    height: 0,
    autoEV: null,
    error: null,
  }))
  photos.update((list) => [...list, ...items])
  // Initial develop: decode + thumbnail, then drop the base (re-decoded on demand).
  items.forEach((item) => enqueue(item.id, true))
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

/** Render the final ≤2560px export for each id, in order. Decodes on demand. */
export async function renderExports(ids: string[]): Promise<UploadPhoto[]> {
  const payload: UploadPhoto[] = []
  for (const id of ids) {
    const item = get(photos).find((p) => p.id === id)
    if (!item) continue
    const base = await ensureBase(id)
    debugLog('export', { id, crop: item.adjustments.crop, mode: item.adjustments.exposureMode })
    const blob = await renderExport(base, item.adjustments)
    payload.push({ file: blob, fileName: toJpgName(item.name) })
  }
  return payload
}

export function clearPhotos(): void {
  releaseAllBases()
  for (const p of get(photos)) {
    if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl)
  }
  photos.set([])
}
