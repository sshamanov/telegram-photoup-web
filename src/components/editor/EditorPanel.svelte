<script lang="ts">
  import type { Photo } from '../../stores/photos'
  import { updateAdjustments, resetAdjustments } from '../../stores/photos'
  import { pushToast } from '../../stores/ui'
  import type { NormalizedCrop } from '../../lib/image/types'
  import Slider from './Slider.svelte'

  export let photo: Photo
  export let onClose: () => void = () => {}

  let previewEl: HTMLImageElement | null = null
  let cropMode = false
  let pickingNeutral = false
  let dragStart: { x: number; y: number } | null = null
  let draftCrop: NormalizedCrop | null = null

  $: isRaw = photo.sourceType === 'raw'
  $: shownEV = photo.adjustments.exposureMode === 'auto'
    ? (photo.autoEV ?? photo.adjustments.exposureEV)
    : photo.adjustments.exposureEV

  function setExposure(v: number): void {
    updateAdjustments(photo.id, { exposureMode: 'manual', exposureEV: v })
  }

  function autoExposure(): void {
    updateAdjustments(photo.id, { exposureMode: 'auto' })
  }

  function reset(): void {
    resetAdjustments(photo.id)
  }

  function onPointerDown(event: MouseEvent): void {
    if (cropMode) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      dragStart = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
      draftCrop = { x: dragStart.x, y: dragStart.y, width: 0, height: 0 }
      return
    }
    if (pickingNeutral) {
      void pickNeutral(event)
    }
  }

  function onPointerMove(event: MouseEvent): void {
    if (!cropMode || !dragStart) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const cx = (event.clientX - rect.left) / rect.width
    const cy = (event.clientY - rect.top) / rect.height
    draftCrop = {
      x: Math.min(dragStart.x, cx),
      y: Math.min(dragStart.y, cy),
      width: Math.abs(cx - dragStart.x),
      height: Math.abs(cy - dragStart.y),
    }
  }

  function onPointerUp(): void {
    dragStart = null
  }

  function applyCrop(): void {
    // eslint-disable-next-line no-console
    console.log('[photoup:crop] apply', draftCrop)
    if (draftCrop && draftCrop.width > 0.02 && draftCrop.height > 0.02) {
      updateAdjustments(photo.id, { crop: draftCrop })
    }
    exitCropMode()
  }

  function clearCrop(): void {
    updateAdjustments(photo.id, { crop: null })
    exitCropMode()
  }

  function exitCropMode(): void {
    cropMode = false
    dragStart = null
    draftCrop = null
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

  $: cropOverlay = draftCrop ?? photo.adjustments.crop
</script>

<div class="overlay">
  <div class="panel">
    <header>
      <strong>{photo.name}</strong>
      <button onclick={onClose}>Close</button>
    </header>

    <div
      class="preview"
      class:crop-mode={cropMode}
      role="img"
      aria-label={photo.name}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
    >
      {#if photo.thumbUrl}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <img bind:this={previewEl} src={photo.thumbUrl} alt={photo.name} />
      {/if}
      {#if cropOverlay}
        <div
          class="crop-box"
          style="left:{cropOverlay.x * 100}%;top:{cropOverlay.y * 100}%;width:{cropOverlay.width * 100}%;height:{cropOverlay.height * 100}%"
        ></div>
      {/if}
    </div>

    <div class="controls">
      <div class="row">
        <button onclick={reset}>Reset</button>
        <button onclick={autoExposure}>Auto</button>
        <span class="ev">EV {shownEV >= 0 ? '+' : ''}{shownEV.toFixed(2)}</span>
      </div>

      <Slider label="Exposure" min={-3} max={5} step={0.1} value={shownEV} onChange={setExposure} />

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

      <div class="row">
        <button class:active={cropMode} onclick={() => (cropMode = !cropMode)}>Crop</button>
        {#if cropMode}
          <button onclick={applyCrop}>Apply crop</button>
          <button onclick={clearCrop}>Clear</button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    width: min(920px, 92vw);
    max-height: 92vh;
    overflow: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .preview {
    position: relative;
    background: #000;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    justify-content: center;
    max-height: 60vh;
    user-select: none;
  }
  .preview img {
    max-width: 100%;
    max-height: 60vh;
    object-fit: contain;
    display: block;
  }
  .preview.crop-mode {
    cursor: crosshair;
  }
  .crop-box {
    position: absolute;
    border: 1px solid var(--accent);
    background: rgba(76, 141, 255, 0.15);
    pointer-events: none;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .row .active {
    border-color: var(--accent);
    background: rgba(76, 141, 255, 0.15);
  }
  .ev {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
  }
</style>
