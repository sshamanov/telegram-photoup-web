<script lang="ts">
  export let bins: Uint32Array | null = null

  let canvas: HTMLCanvasElement

  $: if (canvas && bins) draw()

  function draw(): void {
    const ctx = canvas.getContext('2d')
    if (!ctx || !bins) return
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    let max = 1
    for (const b of bins) if (b > max) max = b
    const logMax = Math.log1p(max)
    const barW = w / 256

    ctx.fillStyle = 'rgba(255, 122, 69, 0.55)'
    for (let i = 0; i < 256; i++) {
      const v = Math.log1p(bins[i]!) / logMax
      const bh = Math.round(v * h)
      ctx.fillRect(Math.floor(i * barW), h - bh, Math.ceil(barW) + 1, bh)
    }
  }
</script>

<canvas bind:this={canvas} width={256} height={72} class="histogram" aria-label="Luminance histogram"></canvas>

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
