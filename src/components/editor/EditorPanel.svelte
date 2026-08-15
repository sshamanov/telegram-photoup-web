<script lang="ts">
  import type { Photo } from '../../stores/photos'
  import { updateAdjustments, resetAdjustments } from '../../stores/photos'
  import { pushToast } from '../../stores/ui'
  import type { NormalizedCrop } from '../../lib/image/types'
  import Slider from './Slider.svelte'
  import Histogram from './Histogram.svelte'

  export let photo: Photo
  export let onClose: () => void = () => {}

  type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  type Preset = 'free' | '1:1' | '3:2' | '2:3'
  type DragState =
    | { kind: 'move'; startX: number; startY: number; startCrop: NormalizedCrop }
    | { kind: 'resize'; handle: Handle; startX: number; startY: number; startCrop: NormalizedCrop }

  const PRESET_RATIOS: Record<Exclude<Preset, 'free'>, number> = {
    '1:1': 1,
    '3:2': 3 / 2,
    '2:3': 2 / 3,
  }
  const MIN_CROP = 0.05

  let previewEl: HTMLImageElement | null = null
  let stageEl: HTMLDivElement | null = null
  let cropMode = false
  let pickingNeutral = false
  let draftCrop: NormalizedCrop | null = null
  let drag: DragState | null = null
  let activePreset: Preset = 'free'

  $: isRaw = photo.sourceType === 'raw'
  $: shownEV = photo.adjustments.exposureMode === 'auto'
    ? (photo.autoEV ?? photo.adjustments.exposureEV)
    : photo.adjustments.exposureEV

  function clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v
  }

  function setExposure(v: number): void {
    updateAdjustments(photo.id, { exposureMode: 'manual', exposureEV: v })
  }

  function autoExposure(): void {
    updateAdjustments(photo.id, { exposureMode: 'auto' })
  }

  function reset(): void {
    resetAdjustments(photo.id)
  }

  function enterCropMode(): void {
    draftCrop = photo.adjustments.crop ?? { x: 0, y: 0, width: 1, height: 1 }
    activePreset = 'free'
    cropMode = true
    pickingNeutral = false
  }

  function exitCropMode(): void {
    cropMode = false
    draftCrop = null
    drag = null
  }

  function toggleCrop(): void {
    if (cropMode) exitCropMode()
    else enterCropMode()
  }

  function applyPreset(preset: Preset): void {
    activePreset = preset
    if (preset === 'free') return
    const ratio = PRESET_RATIOS[preset]
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
  }

  function applyCrop(): void {
    if (draftCrop) {
      const isFull =
        draftCrop.x <= 0.005 &&
        draftCrop.y <= 0.005 &&
        draftCrop.width >= 0.995 &&
        draftCrop.height >= 0.995
      updateAdjustments(photo.id, { crop: isFull ? null : draftCrop })
    }
    exitCropMode()
  }

  function clearCrop(): void {
    updateAdjustments(photo.id, { crop: null })
    exitCropMode()
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

  function isCorner(handle: Handle): boolean {
    return handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se'
  }

  function resizeCrop(c: NormalizedCrop, handle: Handle, dx: number, dy: number, keepAspect: boolean): NormalizedCrop {
    if (keepAspect && isCorner(handle)) {
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
    const rect = stageEl.getBoundingClientRect()
    const dx = (event.clientX - drag.startX) / rect.width
    const dy = (event.clientY - drag.startY) / rect.height
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

    const keepAspect = event.shiftKey
    if (!keepAspect) activePreset = 'free'
    draftCrop = resizeCrop(c, drag.handle, dx, dy, keepAspect)
  }

  function onWindowPointerUp(): void {
    drag = null
  }

  function onStagePointerDown(event: MouseEvent): void {
    if (cropMode) return
    if (pickingNeutral) void pickNeutral(event)
  }

  async function pickNeutral(event: MouseEvent): Promise<void> {
    const img = previewEl
    if (!img || !img.naturalWidth) return
    const rect = img.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data
    const r = px[0]!
    const g = px[1]!
    const b = px[2]!
    const gray = (r + g + b) / 3
    if (gray < 8 || gray > 247) {
      pushToast('error', 'Pick a neutral area (not black or blown out)')
      return
    }
    updateAdjustments(photo.id, {
      neutralGains: { r: gray / Math.max(r, 1), g: gray / Math.max(g, 1), b: gray / Math.max(b, 1) },
    })
    pickingNeutral = false
  }
</script>

<svelte:window onpointermove={onWindowPointerMove} onpointerup={onWindowPointerUp} onpointercancel={onWindowPointerUp} />

<div class="overlay">
  <div class="panel">
    <header>
      <strong>{photo.name}</strong>
      <div class="header-actions">
        <button onclick={reset}>Reset</button>
        <button onclick={onClose}>Close</button>
      </div>
    </header>

    <div class="preview" class:crop-mode={cropMode} class:picking={pickingNeutral}>
      <div
        class="stage"
        bind:this={stageEl}
        role="img"
        aria-label={photo.name}
        onpointerdown={onStagePointerDown}
      >
        {#if photo.thumbUrl}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <img bind:this={previewEl} src={photo.thumbUrl} alt={photo.name} />
        {/if}
        {#if cropMode && draftCrop}
          <div
            class="crop-box"
            role="group"
            aria-label="Crop area — drag inside to move"
            style="left:{draftCrop.x * 100}%;top:{draftCrop.y * 100}%;width:{draftCrop.width * 100}%;height:{draftCrop.height * 100}%"
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

    <Histogram bins={photo.histogram} />

    <div class="controls">
      <div class="row slider-row">
        <button class:active={photo.adjustments.exposureMode === 'auto'} onclick={autoExposure}>Auto</button>
        <div class="grow">
          <Slider
            label="Exposure"
            min={-3}
            max={5}
            step={0.1}
            value={shownEV}
            display={`${shownEV >= 0 ? '+' : ''}${shownEV.toFixed(2)} EV`}
            zero={0}
            onChange={setExposure}
          />
        </div>
      </div>

      {#if isRaw}
        <Slider
          label="Temperature"
          min={-1}
          max={1}
          step={0.01}
          value={photo.adjustments.temperature}
          onChange={(v) => updateAdjustments(photo.id, { temperature: v })}
        />
        <div class="row">
          <button class:active={pickingNeutral} onclick={() => (pickingNeutral = !pickingNeutral)}>
            Neutral picker
          </button>
          <span class="hint">click a neutral area in the image</span>
        </div>
      {/if}

      <div class="crop-controls">
        <div class="row">
          <button class:active={cropMode} onclick={toggleCrop}>Crop</button>
          {#if cropMode}
            <span class="presets">
              <button class:active={activePreset === 'free'} onclick={() => applyPreset('free')}>Free</button>
              <button class:active={activePreset === '1:1'} onclick={() => applyPreset('1:1')}>1:1</button>
              <button class:active={activePreset === '3:2'} onclick={() => applyPreset('3:2')}>3:2</button>
              <button class:active={activePreset === '2:3'} onclick={() => applyPreset('2:3')}>2:3</button>
            </span>
            <span class="spacer"></span>
            <button class="primary" onclick={applyCrop}>Apply</button>
            <button onclick={exitCropMode}>Cancel</button>
            <button onclick={clearCrop}>Remove</button>
          {/if}
        </div>
        {#if cropMode}
          <p class="hint">Drag handles to resize · drag inside to move · hold Shift to keep ratio</p>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(6, 5, 4, 0.78);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 20px;
  }
  .panel {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    width: min(940px, 94vw);
    max-height: 94vh;
    overflow: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  header strong {
    font-weight: 500;
    font-size: 13px;
    letter-spacing: 0.04em;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .preview {
    position: relative;
    background: var(--bg-raise);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    display: flex;
    justify-content: center;
    align-items: center;
    width: min(100%, 62vh);
    aspect-ratio: 1 / 1;
    flex-shrink: 0;
    margin: 0 auto;
    user-select: none;
  }
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    line-height: 0;
  }
  .preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
  }
  /* Crop / neutral-pick: show the full image (contain) so coordinates map correctly. */
  .preview.crop-mode .stage,
  .preview.picking .stage {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
  }
  .preview.crop-mode img,
  .preview.picking img {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 62vh;
    object-fit: contain;
  }
  .crop-box {
    position: absolute;
    border: 1.5px solid var(--accent);
    background: rgba(255, 122, 69, 0.06);
    box-shadow: 0 0 0 9999px rgba(6, 5, 4, 0.45);
    cursor: move;
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
  .controls {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-top: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .slider-row {
    gap: 14px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .row .active {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 0 14px rgba(255, 122, 69, 0.35);
  }
  .presets {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .presets button {
    padding: 6px 10px;
  }
  .spacer {
    flex: 1;
  }
  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }
  .hint {
    color: var(--faint);
    font-size: 11px;
    letter-spacing: 0.04em;
  }
  .crop-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--border);
    padding-top: 14px;
    margin-top: 2px;
  }
</style>
