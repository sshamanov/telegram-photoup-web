<script lang="ts">
  import type { Photo } from '../../stores/photos'
  import { updateAdjustments, setPreviewDragging } from '../../stores/photos'
  import { pushToast } from '../../stores/ui'
  import type { NormalizedCrop } from '../../lib/image/types'
  import { wbFromPick } from '../../lib/image/process'
  import Slider from './Slider.svelte'
  import Histogram from './Histogram.svelte'

  export let photo: Photo
  export let onClose: () => void = () => {}
  export let onPrev: () => void = () => {}
  export let onNext: () => void = () => {}
  export let hasPrev = false
  export let hasNext = false

  type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  type DragState =
    | { kind: 'move'; startX: number; startY: number; startCrop: NormalizedCrop }
    | { kind: 'resize'; handle: Handle; startX: number; startY: number; startCrop: NormalizedCrop }

  const MIN_CROP = 0.05

  let previewEl: HTMLImageElement | null = null
  let stageEl: HTMLDivElement | null = null
  let stageW = 0
  let stageH = 0
  let pickingNeutral = false
  let draftCrop: NormalizedCrop | null = null
  let drag: DragState | null = null
  let currentPhotoId = ''

  $: isRaw = photo.sourceType === 'raw'
  $: shownEV = photo.adjustments.exposureMode === 'auto'
    ? (photo.autoEV ?? photo.adjustments.exposureEV)
    : photo.adjustments.exposureEV

  $: evLabel = `${shownEV >= 0 ? '+' : ''}${shownEV.toFixed(2)} EV`
  $: exifCamera = photo.exif?.camera ?? photo.exif?.model ?? null
  $: exifLens = photo.exif?.lens
    || (photo.exif?.focalLength ? `${Math.round(photo.exif.focalLength)}mm` : null)
  $: exifShutter = photo.exif?.shutter ? formatShutter(photo.exif.shutter) : null
  $: exifAperture = photo.exif?.aperture ? `f/${photo.exif.aperture.toFixed(1)}` : null
  $: exifIso = photo.exif?.iso ? `ISO ${photo.exif.iso}` : null
  $: exifDate = photo.exif?.dateTaken ? formatDate(photo.exif.dateTaken) : null
  // Warmth offset (0 = camera as-shot / no change) + hue (green↔magenta) tint.
  $: wbLabel = `${photo.adjustments.wbOffset > 0 ? '+' : ''}${photo.adjustments.wbOffset.toFixed(2)}`
  $: hueLabel = `${photo.adjustments.hue > 0 ? '+' : ''}${photo.adjustments.hue.toFixed(2)}`
  $: wbDisplay = `${wbLabel} · ${hueLabel}`

  // The letterboxed rect of the image *content* within the square stage (CSS px).
  $: contentRect = (() => {
    const iw = photo.fullWidth || 1
    const ih = photo.fullHeight || 1
    if (!stageW || !stageH) return { x: 0, y: 0, width: 1, height: 1 }
    const scale = Math.min(stageW / iw, stageH / ih)
    const w = iw * scale
    const h = ih * scale
    return { x: (stageW - w) / 2, y: (stageH - h) / 2, width: w, height: h }
  })()

  $: boxStyle = draftCrop
    ? `left:${contentRect.x + draftCrop.x * contentRect.width}px;` +
      `top:${contentRect.y + draftCrop.y * contentRect.height}px;` +
      `width:${draftCrop.width * contentRect.width}px;` +
      `height:${draftCrop.height * contentRect.height}px`
    : ''

  // Reset the crop frame when navigating to a different photo.
  $: if (photo && photo.id !== currentPhotoId) {
    currentPhotoId = photo.id
    draftCrop = photo.adjustments.crop ?? { x: 0, y: 0, width: 1, height: 1 }
  }

  function onKeyDown(event: KeyboardEvent): void {
    const t = event.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (event.key === 'ArrowRight') onNext()
    else if (event.key === 'ArrowLeft') onPrev()
  }

  function clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v
  }

  function formatShutter(s: number): string {
    if (s >= 1) return `${s}s`
    return `1/${Math.round(1 / s)}s`
  }

  function formatDate(d: string): string {
    return d.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').slice(0, 16)
  }

  function setExposure(v: number): void {
    updateAdjustments(photo.id, { exposureMode: 'manual', exposureEV: v })
  }

  // While a slider is dragged, re-render at 512 for responsiveness; on release a
  // full 1024 render happens.
  function dragChange(update: (v: number) => void): (v: number) => void {
    return (v: number) => {
      setPreviewDragging(true)
      update(v)
    }
  }
  function dragRelease(update: (v: number) => void): (v: number) => void {
    return (v: number) => {
      setPreviewDragging(false)
      update(v)
    }
  }

  function autoExposure(): void {
    updateAdjustments(photo.id, { exposureMode: 'auto' })
  }

  function resetExposure(): void {
    updateAdjustments(photo.id, { exposureMode: 'manual', exposureEV: 0 })
  }

  function resetWb(): void {
    updateAdjustments(
      photo.id,
      { wbOffset: 0, hue: 0 },
    )
  }

  function commitCrop(): void {
    if (!draftCrop) return
    const isFull =
      draftCrop.x <= 0.005 &&
      draftCrop.y <= 0.005 &&
      draftCrop.width >= 0.995 &&
      draftCrop.height >= 0.995
    updateAdjustments(photo.id, { crop: isFull ? null : draftCrop })
  }

  function applyPreset(ratio: number): void {
    const fw = photo.fullWidth || 1
    const fh = photo.fullHeight || 1
    const target = ratio * (fh / fw)
    let w: number
    let h: number
    if (target >= 1) {
      w = 1
      h = 1 / target
    } else {
      h = 1
      w = target
    }
    draftCrop = { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h }
    commitCrop()
  }

  function resetCrop(): void {
    updateAdjustments(photo.id, { crop: null })
    draftCrop = { x: 0, y: 0, width: 1, height: 1 }
  }

  function startMove(event: PointerEvent): void {
    if (!draftCrop) return
    event.preventDefault()
    stageEl?.setPointerCapture(event.pointerId)
    drag = { kind: 'move', startX: event.clientX, startY: event.clientY, startCrop: { ...draftCrop } }
  }

  function startResize(event: PointerEvent, handle: Handle): void {
    event.stopPropagation()
    if (!draftCrop) return
    event.preventDefault()
    stageEl?.setPointerCapture(event.pointerId)
    drag = { kind: 'resize', handle, startX: event.clientX, startY: event.clientY, startCrop: { ...draftCrop } }
  }

  function resizeCrop(
    c: NormalizedCrop,
    handle: Handle,
    dx: number,
    dy: number,
    shift: boolean,
    alt: boolean,
  ): NormalizedCrop {
    const isSide = handle === 'n' || handle === 's' || handle === 'e' || handle === 'w'
    const isHoriz = handle === 'e' || handle === 'w'
    const isVert = handle === 'n' || handle === 's'

    // ALT = scale from the center (both opposite edges move equally). Shift keeps aspect.
    if (alt) {
      if (shift) {
        const sx = (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0) / c.width
        const sy = (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0) / c.height
        const s = 1 + (isSide ? sx + sy : Math.max(sx, sy))
        const maxS = Math.min(
          1 + (2 * c.x) / c.width,
          1 + (2 * (1 - c.x - c.width)) / c.width,
          1 + (2 * c.y) / c.height,
          1 + (2 * (1 - c.y - c.height)) / c.height,
        )
        const scale = clamp(s, MIN_CROP / Math.min(c.width, c.height), Math.max(1, maxS))
        const w = c.width * scale
        const h = c.height * scale
        return { x: c.x + (c.width - w) / 2, y: c.y + (c.height - h) / 2, width: w, height: h }
      }
      if (isHoriz) {
        const maxW = Math.min(c.width + 2 * c.x, c.width + 2 * (1 - c.x - c.width))
        const w = clamp(c.width + dx * 2, MIN_CROP, Math.max(MIN_CROP, maxW))
        return { x: c.x + (c.width - w) / 2, y: c.y, width: w, height: c.height }
      }
      if (isVert) {
        const maxH = Math.min(c.height + 2 * c.y, c.height + 2 * (1 - c.y - c.height))
        const h = clamp(c.height + dy * 2, MIN_CROP, Math.max(MIN_CROP, maxH))
        return { x: c.x, y: c.y + (c.height - h) / 2, width: c.width, height: h }
      }
      // ALT + corner: scale both axes from the center.
      const maxW = Math.min(c.width + 2 * c.x, c.width + 2 * (1 - c.x - c.width))
      const maxH = Math.min(c.height + 2 * c.y, c.height + 2 * (1 - c.y - c.height))
      const w = clamp(c.width + dx * 2, MIN_CROP, Math.max(MIN_CROP, maxW))
      const h = clamp(c.height + dy * 2, MIN_CROP, Math.max(MIN_CROP, maxH))
      return { x: c.x + (c.width - w) / 2, y: c.y + (c.height - h) / 2, width: w, height: h }
    }

    // SHIFT keeps the aspect ratio.
    if (shift) {
      // Edge handles: the dragged side moves toward the static opposite side; the
      // perpendicular edges move symmetrically to preserve the ratio.
      if (isSide) {
        if (isHoriz) {
          let x = c.x
          let w = c.width
          if (handle === 'e') w = clamp(c.width + dx, MIN_CROP, 1 - c.x)
          else {
            x = clamp(c.x + dx, 0, c.x + c.width - MIN_CROP)
            w = c.x + c.width - x
          }
          const h = c.height * (w / c.width)
          return { x, y: c.y + (c.height - h) / 2, width: w, height: h }
        }
        let y = c.y
        let h = c.height
        if (handle === 's') h = clamp(c.height + dy, MIN_CROP, 1 - c.y)
        else {
          y = clamp(c.y + dy, 0, c.y + c.height - MIN_CROP)
          h = c.y + c.height - y
        }
        const w = c.width * (h / c.height)
        return { x: c.x + (c.width - w) / 2, y, width: w, height: h }
      }
      // Corner handles anchor the opposite corner.
      const sx = (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0) / c.width
      const sy = (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0) / c.height
      const s = 1 + Math.max(sx, sy)
      const maxW = handle.includes('w') ? c.x + c.width : 1 - c.x
      const maxH = handle.includes('n') ? c.y + c.height : 1 - c.y
      const scale = Math.min(clamp(c.width * s, MIN_CROP, maxW) / c.width, clamp(c.height * s, MIN_CROP, maxH) / c.height)
      const w = c.width * scale
      const h = c.height * scale
      return {
        x: handle.includes('w') ? c.x + c.width - w : c.x,
        y: handle.includes('n') ? c.y + c.height - h : c.y,
        width: w,
        height: h,
      }
    }

    // Default: the dragged side moves, the opposite side stays put.
    let x = c.x
    let y = c.y
    let width = c.width
    let height = c.height
    if (handle.includes('e')) width = clamp(c.width + dx, MIN_CROP, 1 - c.x)
    if (handle.includes('s')) height = clamp(c.height + dy, MIN_CROP, 1 - c.y)
    if (handle.includes('w')) {
      x = clamp(c.x + dx, 0, c.x + c.width - MIN_CROP)
      width = c.x + c.width - x
    }
    if (handle.includes('n')) {
      y = clamp(c.y + dy, 0, c.y + c.height - MIN_CROP)
      height = c.y + c.height - y
    }
    return { x, y, width, height }
  }

  function onWindowPointerMove(event: PointerEvent): void {
    if (!drag || !stageEl) return
    const dx = (event.clientX - drag.startX) / contentRect.width
    const dy = (event.clientY - drag.startY) / contentRect.height
    const c = drag.startCrop

    if (drag.kind === 'move') {
      draftCrop = {
        x: clamp(c.x + dx, 0, 1 - c.width),
        y: clamp(c.y + dy, 0, 1 - c.height),
        width: c.width,
        height: c.height,
      }
      return
    }

    draftCrop = resizeCrop(c, drag.handle, dx, dy, event.shiftKey, event.altKey)
  }

  function onWindowPointerUp(): void {
    if (!drag) return
    drag = null
    commitCrop()
  }

  function onStagePointerDown(event: MouseEvent): void {
    if (pickingNeutral) void pickNeutral(event)
  }

  async function pickNeutral(event: MouseEvent): Promise<void> {
    const img = previewEl
    if (!img || !img.naturalWidth) return
    const rect = img.getBoundingClientRect()
    const x = (event.clientX - rect.left - contentRect.x) / contentRect.width
    const y = (event.clientY - rect.top - contentRect.y) / contentRect.height
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0)

    // Average a fixed 7×7 area — the same as GIMP's grey-point picker (Lightroom
    // uses 5×5). Larger than a single pixel so noise can't skew the WB.
    const size = 7
    const half = Math.floor(size / 2)
    const sx = clamp(Math.floor(x * canvas.width) - half, 0, Math.max(0, canvas.width - size))
    const sy = clamp(Math.floor(y * canvas.height) - half, 0, Math.max(0, canvas.height - size))
    const px = ctx.getImageData(sx, sy, size, size).data
    let sr = 0
    let sg = 0
    let sb = 0
    let n = 0
    for (let i = 0; i < px.length; i += 4) {
      sr += px[i]!
      sg += px[i + 1]!
      sb += px[i + 2]!
      n++
    }
    const r = sr / n
    const g = sg / n
    const b = sb / n
    const gray = (r + g + b) / 3
    if (gray < 8 || gray > 247) {
      pushToast('error', 'Pick a neutral area (not black or blown out)')
      return
    }
    // Reflect the pick on the warmth + hue sliders (Lightroom-style).
    const { offset, hue } = wbFromPick(r, g, b, photo.camMatrix)
    updateAdjustments(photo.id, { wbOffset: offset, hue })
    pickingNeutral = false
  }
</script>

<svelte:window onpointermove={onWindowPointerMove} onpointerup={onWindowPointerUp} onpointercancel={onWindowPointerUp} onkeydown={onKeyDown} />

<div class="overlay">
  <div class="panel">
    <div class="body">
      <div class="left" class:picking={pickingNeutral}>
        <div
          class="stage"
          bind:this={stageEl}
          bind:clientWidth={stageW}
          bind:clientHeight={stageH}
          role="img"
          aria-label={photo.name}
          onpointerdown={onStagePointerDown}
        >
          {#if photo.fullThumbUrl}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <img bind:this={previewEl} src={photo.fullThumbUrl} alt={photo.name} />
          {/if}
          {#if draftCrop}
            <div
              class="crop-box"
              role="group"
              aria-label="Crop area — drag inside to move"
              style={boxStyle}
              onpointerdown={startMove}
            >
              <button type="button" class="h h-nw" data-handle="nw" aria-label="Resize crop top-left" onpointerdown={(e) => startResize(e, 'nw')}></button>
              <button type="button" class="h h-n" data-handle="n" aria-label="Resize crop top" onpointerdown={(e) => startResize(e, 'n')}></button>
              <button type="button" class="h h-ne" data-handle="ne" aria-label="Resize crop top-right" onpointerdown={(e) => startResize(e, 'ne')}></button>
              <button type="button" class="h h-e" data-handle="e" aria-label="Resize crop right" onpointerdown={(e) => startResize(e, 'e')}></button>
              <button type="button" class="h h-se" data-handle="se" aria-label="Resize crop bottom-right" onpointerdown={(e) => startResize(e, 'se')}></button>
              <button type="button" class="h h-s" data-handle="s" aria-label="Resize crop bottom" onpointerdown={(e) => startResize(e, 's')}></button>
              <button type="button" class="h h-sw" data-handle="sw" aria-label="Resize crop bottom-left" onpointerdown={(e) => startResize(e, 'sw')}></button>
              <button type="button" class="h h-w" data-handle="w" aria-label="Resize crop left" onpointerdown={(e) => startResize(e, 'w')}></button>
            </div>
          {/if}
        </div>
      </div>

      <div class="right">
        <strong class="name" title={photo.name}>{photo.name}</strong>

        <Histogram bins={photo.histogram} />

        <span class="section">Exposure</span>
        <Slider
          min={-3}
          max={5}
          step={0.1}
          value={shownEV}
          zero={0}
          onChange={dragChange(setExposure)}
          onRelease={dragRelease(setExposure)}
        />
        <div class="row">
          <button class:active={photo.adjustments.exposureMode === 'auto'} onclick={autoExposure}>Auto</button>
          <button onclick={resetExposure}>Reset</button>
          <span class="ev">{evLabel}</span>
        </div>

        <span class="section">White balance</span>
        <Slider
          min={-2}
          max={2}
          step={0.05}
          value={photo.adjustments.wbOffset}
          zero={0}
          zeroLabel="0"
          onChange={dragChange((v) => updateAdjustments(photo.id, { wbOffset: v }))}
          onRelease={dragRelease((v) => updateAdjustments(photo.id, { wbOffset: v }))}
        />
        <Slider
          min={-2}
          max={2}
          step={0.05}
          value={photo.adjustments.hue}
          zero={0}
          zeroLabel="0"
          onChange={dragChange((v) => updateAdjustments(photo.id, { hue: v }))}
          onRelease={dragRelease((v) => updateAdjustments(photo.id, { hue: v }))}
        />
        <div class="row">
          <button class:active={pickingNeutral} onclick={() => (pickingNeutral = !pickingNeutral)}>Picker</button>
          <button onclick={resetWb}>Reset</button>
          <span class="ev wb">{wbDisplay}</span>
        </div>

        <span class="section">Crop</span>
        <div class="presets">
          <button onclick={() => applyPreset(1)}>1:1</button>
          <button onclick={() => applyPreset(2 / 3)}>2:3</button>
          <button onclick={() => applyPreset(3 / 2)}>3:2</button>
          <button onclick={resetCrop}>Original</button>
        </div>

        <span class="section">Image</span>
        <div class="info">
          {#if exifCamera}<p class="line">{exifCamera}</p>{/if}
          {#if exifLens}<p class="line">{exifLens}</p>{/if}
          {#if exifShutter || exifAperture || exifIso}
            <p class="line">{[exifShutter, exifAperture, exifIso].filter(Boolean).join(' · ')}</p>
          {/if}
          {#if exifDate}<p class="line">{exifDate}</p>{/if}
          <p class="line">{photo.sourceType === 'raw' ? 'RAW' : 'JPEG'} · {photo.fullWidth} × {photo.fullHeight}</p>
          <p class="line">output {photo.width} × {photo.height} px</p>
        </div>

        <p class="hint bottom-hint">Drag handles to resize · drag inside to move · Shift keeps ratio</p>

        <div class="nav">
          <button onclick={onPrev} disabled={!hasPrev}>‹ Prev</button>
          <button onclick={onNext} disabled={!hasNext}>Next ›</button>
        </div>

        <button class="close" onclick={onClose}>Close</button>
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(6, 5, 4, 0.82);
    backdrop-filter: blur(6px);
    display: flex;
    padding: 12px;
    z-index: 100;
  }
  .panel {
    flex: 1;
    min-width: 0;
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 20px;
  }
  .left {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    background: var(--bg-raise);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .right {
    flex: 0 0 332px;
    padding: 0 6px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow: hidden;
  }
  .name {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 13px;
    letter-spacing: 0.04em;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stage {
    position: absolute;
    inset: 0;
    line-height: 0;
  }
  .stage img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
  }
  .crop-box {
    position: absolute;
    border: 1.5px solid var(--accent);
    background: rgba(255, 122, 69, 0.06);
    box-shadow: 0 0 0 9999px rgba(6, 5, 4, 0.45);
    cursor: move;
  }
  .left.picking .crop-box {
    pointer-events: none;
  }
  .left.picking {
    cursor: crosshair;
  }
  .h {
    position: absolute;
    width: 14px;
    height: 14px;
    padding: 0;
    margin: 0;
    border: 1.5px solid var(--accent);
    border-radius: 3px;
    background: #f2eadf;
    box-shadow: 0 0 0 1px rgba(6, 5, 4, 0.5);
    z-index: 2;
    transition: transform 0.08s ease;
  }
  .h:hover {
    background: var(--accent);
  }
  .h-nw { top: 0; left: 0; transform: translate(-50%, -50%); cursor: nwse-resize; }
  .h-n  { top: 0; left: 50%; transform: translate(-50%, -50%); cursor: ns-resize; }
  .h-ne { top: 0; left: 100%; transform: translate(-50%, -50%); cursor: nesw-resize; }
  .h-e  { top: 50%; left: 100%; transform: translate(-50%, -50%); cursor: ew-resize; }
  .h-se { top: 100%; left: 100%; transform: translate(-50%, -50%); cursor: nwse-resize; }
  .h-s  { top: 100%; left: 50%; transform: translate(-50%, -50%); cursor: ns-resize; }
  .h-sw { top: 100%; left: 0; transform: translate(-50%, -50%); cursor: nesw-resize; }
  .h-w  { top: 50%; left: 0; transform: translate(-50%, -50%); cursor: ew-resize; }
  .section {
    color: var(--faint);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .row .active {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 0 14px rgba(255, 122, 69, 0.35);
  }
  .ev {
    margin-left: auto;
    color: var(--accent-2);
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    white-space: nowrap;
  }
  .wb {
    color: var(--muted);
  }
  .presets {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .presets button {
    flex: 1;
    padding: 8px 6px;
    font-size: 12px;
  }
  .hint {
    color: var(--faint);
    font-size: 11px;
    letter-spacing: 0.03em;
    line-height: 1.4;
  }
  .bottom-hint {
    margin-top: auto;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .info .line {
    color: var(--faint);
    font-size: 11px;
    letter-spacing: 0.03em;
    margin: 0;
  }
  .nav {
    display: flex;
    gap: 8px;
  }
  .nav button {
    flex: 1;
  }
  .nav button:disabled {
    opacity: 0.35;
  }
  .close {
    width: 100%;
  }
</style>
