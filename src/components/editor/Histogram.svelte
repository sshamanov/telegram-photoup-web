<script lang="ts">
  export let bins: Uint32Array | null = null

  let canvas: HTMLCanvasElement
  let clientWidth = 0

  const height = 72
  const BINS = 64
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1

  $: if (canvas && bins && clientWidth > 0) draw()

  function draw(): void {
    const ctx = canvas.getContext('2d')
    if (!ctx || !bins) return

    // Render at device resolution so bars are crisp, not upscaled from 256px.
    const w = Math.round(clientWidth * dpr)
    const h = Math.round(height * dpr)
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, clientWidth, height)

    // Aggregate the 256 source bins into wider, visibly-distinct bars.
    const agg = new Float32Array(BINS)
    for (let i = 0; i < 256; i++) agg[i >> 2]! += bins[i]!
    let max = 1
    for (const b of agg) if (b > max) max = b
    const logMax = Math.log1p(max)

    const gap = 2
    const barW = (clientWidth - gap * (BINS - 1)) / BINS
    const plotH = height - 1

    ctx.fillStyle = 'rgba(255, 122, 69, 0.78)'
    for (let i = 0; i < BINS; i++) {
      const v = Math.log1p(agg[i]!) / logMax
      const bh = Math.round(v * plotH)
      if (bh <= 0) continue
      ctx.fillRect(Math.round(i * (barW + gap)), height - bh, Math.round(barW), bh)
    }
  }
</script>

<canvas
  bind:this={canvas}
  bind:clientWidth
  width={256}
  height={72}
  class="histogram"
  aria-label="Luminance histogram"
></canvas>

<style>
  .histogram {
    display: block;
    width: 100%;
    height: 72px;
    background: var(--bg-raise);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
</style>
