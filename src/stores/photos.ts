import { writable, get } from 'svelte/store'
import type { Adjustments, ProcessStatus, SourceType } from '../lib/image/types'
import type { ExifInfo } from '../lib/image/exif'
import { neutralAdjustments } from '../lib/image/types'
import { fitWithin } from '../lib/image/math'
import {
  decodeBase,
  renderThumb,
  renderExportCanvas,
  cropRect,
  exportWbMul,
  type DecodedBase,
} from '../lib/image/process'
import { encodeJpeg444InWorker } from '../lib/image/encode'
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
  fullThumbUrl: string | null
  width: number
  height: number
  fullWidth: number
  fullHeight: number
  exif: ExifInfo | null
  camMul: number[] | null
  camMatrix: number[][] | null
  autoEV: number | null
  histogram: Uint32Array | null
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
  const { base, exif, camMul, camMatrix } = await decodeBase(buffer, item.sourceType)
  if (exif && !item.exif) patchPhoto(id, { exif })
  if (camMul && !item.camMul) patchPhoto(id, { camMul })
  if (camMatrix && !item.camMatrix) patchPhoto(id, { camMatrix })
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

    // RAW exports render from the full-size decode, so the displayed output size
    // uses ≈2× the half-size base (keeps crops at full detail).
    const srcW = latest.sourceType === 'raw' ? base.width * 2 : base.width
    const srcH = latest.sourceType === 'raw' ? base.height * 2 : base.height
    const outRect = cropRect(srcW, srcH, latest.adjustments.crop)
    const dims = fitWithin(outRect.width, outRect.height, 2560)
    // During a slider drag, render at 512 for responsiveness; 1024 once released.
    const edge = previewDragging ? 512 : 1024

    // While the photo is open in the editor only its live preview matters; the grid
    // thumbnail re-renders when the editor closes (avoids doing both per edit).
    const isFocused = id === focusedId
    if (edge === 512) scheduleSettle(id)
    let thumbBlob: Blob | null = null
    let full: { blob: Blob; autoEV: number; histogram: Uint32Array }
    if (isFocused) {
      full = await renderThumb(base, { ...latest.adjustments, crop: null }, edge)
    } else {
      thumbBlob = (await renderThumb(base, latest.adjustments, edge)).blob
      full = await renderThumb(base, { ...latest.adjustments, crop: null }, edge)
    }

    const current = get(photos).find((p) => p.id === id)
    if (!current) return
    if (thumbBlob && current.thumbUrl) URL.revokeObjectURL(current.thumbUrl)
    if (current.fullThumbUrl) URL.revokeObjectURL(current.fullThumbUrl)
    patchPhoto(id, {
      status: 'ready',
      ...(thumbBlob ? { thumbUrl: URL.createObjectURL(thumbBlob) } : {}),
      fullThumbUrl: URL.createObjectURL(full.blob),
      width: dims.width,
      height: dims.height,
      fullWidth: base.width,
      fullHeight: base.height,
      autoEV: full.autoEV,
      histogram: full.histogram,
    })

    if (releaseAfter) releaseBase(id)
  } catch (error) {
    releaseBase(id)
    const message = error instanceof Error ? error.message : String(error)
    patchPhoto(id, { status: 'error', error: message })
    pushToast('error', `Failed to process ${item.name}`)
  }
}

/** The photo currently open in the editor — its re-renders jump the queue. */
let focusedId: string | null = null

export function setFocusedPhoto(id: string | null): void {
  focusedId = id
}

/** While a slider is being dragged, re-render at a smaller preview (512) for speed;
 * on release the full 1024 render happens. */
let previewDragging = false
let settleTimer: ReturnType<typeof setTimeout> | undefined

export function setPreviewDragging(v: boolean): void {
  previewDragging = v
  clearTimeout(settleTimer)
}

/** Guard: after a low-res (512) drag render, always follow up with a full 1024
 * render shortly after, so the preview can never be stuck at 512 if the slider's
 * release event was missed. Reset whenever new drag activity arrives. */
function scheduleSettle(id: string): void {
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    previewDragging = false
    enqueue(id)
  }, 350)
}

/** Close the editor for a photo: re-render its grid thumbnail with the final
 * edits (the focused skip is now off), then release the decoded base. */
export function closePhoto(id: string): void {
  setFocusedPhoto(null)
  enqueue(id, true)
}

let drainScheduled = false
function scheduleDrain(): void {
  if (drainScheduled) return
  drainScheduled = true
  // Batch edits that land in the same frame into a single drain.
  requestAnimationFrame(() => {
    drainScheduled = false
    void drain()
  })
}

function enqueue(id: string, releaseAfter = false, priority = false): void {
  if (queue.some((q) => q.id === id)) return
  if (priority) queue.unshift({ id, releaseAfter })
  else queue.push({ id, releaseAfter })
  scheduleDrain()
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
    adjustments: { ...neutralAdjustments },
    thumbUrl: null,
    fullThumbUrl: null,
    width: 0,
    height: 0,
    fullWidth: 0,
    fullHeight: 0,
    exif: null,
    camMul: null,
    camMatrix: null,
    autoEV: null,
    histogram: null,
    error: null,
  }))
  photos.update((list) => [...list, ...items])
  // Initial develop: decode + thumbnail, then drop the base (re-decoded on demand).
  items.forEach((item) => enqueue(item.id, true))
}

export function toggleSelected(id: string): void {
  photos.update((list) => list.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)))
}

export function selectAll(selected: boolean): void {
  photos.update((list) => list.map((p) => ({ ...p, selected })))
}

export function updateAdjustments(id: string, patch: Partial<Adjustments>): void {
  photos.update((list) =>
    list.map((p) => (p.id === id ? { ...p, adjustments: { ...p.adjustments, ...patch } } : p)),
  )
  // The photo being edited re-renders with priority over the upload queue.
  enqueue(id, false, id === focusedId)
}

export function resetAdjustments(id: string): void {
  photos.update((list) =>
    list.map((p) => (p.id === id ? { ...p, adjustments: { ...neutralAdjustments } } : p)),
  )
  enqueue(id, false, id === focusedId)
}

/** Render the final ≤2560px export for each id. Decodes/transforms in order, then
 * encodes all JPEGs in parallel across the worker pool (Q100 is the slow part).
 * `onProgress(phase, done, total, name)` reports each photo as it renders/encodes. */
export async function renderExports(
  ids: string[],
  onProgress?: (phase: 'render' | 'encode', done: number, total: number, name: string) => void,
): Promise<UploadPhoto[]> {
  const total = ids.length
  // Phase 1: decode + render each to an sRGB canvas (sequential, main thread).
  // Report the current photo before decoding so the name/count stay current.
  const rendered: Array<{ canvas: OffscreenCanvas; fileName: string }> = []
  let done = 0
  for (const id of ids) {
    const item = get(photos).find((p) => p.id === id)
    if (!item) continue
    onProgress?.('render', done, total, item.name)
    debugLog('export', { id, crop: item.adjustments.crop, mode: item.adjustments.exposureMode })
    let base: DecodedBase
    let disposable = false
    let exportAdj = item.adjustments
    if (item.sourceType === 'raw') {
      // Use the cached half-size base unless the crop is too small to fill 2560px
      // (then decode full-size). The final WB is baked at decode via libraw
      // userMul — applied to the native sensor data, pre color matrix — and the
      // export render then applies no extra WB.
      base = await ensureBase(id)
      const cropSize = cropRect(base.width, base.height, item.adjustments.crop)
      const needFull = Math.max(cropSize.width, cropSize.height) < 2560
      const userMul = item.camMul ? exportWbMul(item.camMul, item.adjustments) : null
      if (userMul) {
        const buffer = await item.file.arrayBuffer()
        const eff = await decodeBase(buffer, 'raw', { fullSize: needFull, userMul })
        base = eff.base
        disposable = true
        exportAdj = { ...item.adjustments, wbOffset: 0, hue: 0 }
      } else if (needFull) {
        const buffer = await item.file.arrayBuffer()
        const full = await decodeBase(buffer, 'raw', { fullSize: true })
        base = full.base
        disposable = true
      }
    } else {
      base = await ensureBase(id)
    }
    const canvas = await renderExportCanvas(base, exportAdj)
    if (disposable) base.dispose()
    debugLog('export:canvas', { file: toJpgName(item.name), w: canvas.width, h: canvas.height })
    rendered.push({ canvas, fileName: toJpgName(item.name) })
    done++
    onProgress?.('render', done, total, item.name)
  }

  // Phase 2: encode in a bounded pool. Each worker yields before reading pixels so
  // the UI can paint the "Encoding i/N" progress instead of blocking on 24 copies.
  onProgress?.('encode', 0, total, '')
  const results = new Array<UploadPhoto | null>(rendered.length)
  let next = 0
  let encoded = 0
  async function encodeWorker(): Promise<void> {
    while (next < rendered.length) {
      const idx = next++
      const { canvas, fileName } = rendered[idx]!
      await new Promise((r) => setTimeout(r, 0))
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const file = await encodeJpeg444InWorker(imageData, { quality: 100, chroma: 1 })
      encoded++
      onProgress?.('encode', encoded, total, fileName)
      results[idx] = { file, fileName }
    }
  }
  const pool = Math.min(4, rendered.length)
  await Promise.all(Array.from({ length: pool }, () => encodeWorker()))
  return results.filter((r): r is UploadPhoto => r !== null)
}

/** Remove only the given photos (e.g. the ones actually sent), keeping the rest
 * with their edits intact. */
export function removePhotos(ids: string[]): void {
  const toRemove = new Set(ids)
  for (const id of toRemove) releaseBase(id)
  photos.update((list) => {
    for (const p of list) {
      if (toRemove.has(p.id)) {
        if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl)
        if (p.fullThumbUrl) URL.revokeObjectURL(p.fullThumbUrl)
      }
    }
    return list.filter((p) => !toRemove.has(p.id))
  })
}

export function clearPhotos(): void {
  releaseAllBases()
  for (const p of get(photos)) {
    if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl)
    if (p.fullThumbUrl) URL.revokeObjectURL(p.fullThumbUrl)
  }
  photos.set([])
}
