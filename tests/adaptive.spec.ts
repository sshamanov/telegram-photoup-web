import { test, expect } from '@playwright/test'

// The module is imported by the dev server inside the page, so the specifier is a
// URL path that tsc cannot resolve; type it from the source file instead.
type EncodeModule = typeof import('../src/lib/image/encode')
test('adaptive encode: Q100 when it fits, lowers to fit a budget', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('https://localhost:5173/')
  const res = await page.evaluate(async () => {
    const encodeUrl: string = '/src/lib/image/encode.ts'
    const enc: EncodeModule = await import(/* @vite-ignore */ encodeUrl)
    // Each call needs a FRESH buffer (the encode transfers/detaches it).
    const mk = () => {
      const c = document.createElement('canvas')
      c.width = 2560
      c.height = 1710
      const ctx = c.getContext('2d')!
      const grad = ctx.createLinearGradient(0, 0, 2560, 1710)
      grad.addColorStop(0, '#ff7a45')
      grad.addColorStop(0.5, '#2b2a28')
      grad.addColorStop(1, '#3d9bd8')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 2560, 1710)
      return ctx.getImageData(0, 0, 2560, 1710)
    }

    const adaptive = await enc.encodeJpeg444Adaptive(mk(), { chroma: 1 })
    const plain100 = await enc.encodeJpeg444InWorker(mk(), { quality: 100, chroma: 1 })
    const keeps100 = adaptive.size === plain100.size

    const adaptive2m = await enc.encodeJpeg444Adaptive(mk(), { chroma: 1, maxBytes: 2_000_000 })
    return {
      adaptiveMB: (adaptive.size / 1024 / 1024).toFixed(2),
      plain100MB: (plain100.size / 1024 / 1024).toFixed(2),
      keeps100,
      adaptive2mMB: (adaptive2m.size / 1024 / 1024).toFixed(2),
      under2m: adaptive2m.size <= 2_000_000,
    }
  })
  console.log('ADAPTIVE', JSON.stringify(res))
  expect(res.keeps100).toBe(true) // no quality loss when it fits
  expect(parseFloat(res.adaptiveMB)).toBeLessThan(10)
  expect(res.under2m).toBe(true) // binary search honored the small budget
})

test('binary search lowers quality to fit a small budget', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('https://localhost:5173/')
  const res = await page.evaluate(async () => {
    const encodeUrl: string = '/src/lib/image/encode.ts'
    const enc: EncodeModule = await import(/* @vite-ignore */ encodeUrl)
    const mkNoise = () => {
      const c = document.createElement('canvas')
      c.width = 1200
      c.height = 800
      const ctx = c.getContext('2d')!
      const img = ctx.createImageData(1200, 800)
      let s = 1
      for (let i = 0; i < img.data.length; i += 4) {
        s = (s * 1103515245 + 12345) & 0x7fffffff
        img.data[i] = (s >> 8) & 255
        img.data[i + 1] = (s >> 16) & 255
        img.data[i + 2] = (s >> 24) & 255
        img.data[i + 3] = 255
      }
      return img
    }
    const plain100 = await enc.encodeJpeg444InWorker(mkNoise(), { quality: 100, chroma: 1 })
    const adaptive = await enc.encodeJpeg444Adaptive(mkNoise(), { chroma: 1, maxBytes: 500_000 })
    return { plain100KB: Math.round(plain100.size / 1024), adaptiveKB: Math.round(adaptive.size / 1024), under: adaptive.size <= 500_000 }
  })
  console.log('BINARY', JSON.stringify(res))
  expect(res.plain100KB).toBeGreaterThan(500) // Q100 of noise exceeds the budget
  expect(res.under).toBe(true) // adaptive lowered it
})
