import { test, expect } from '@playwright/test'

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Send to')).toBeVisible()
}

const name = (page: import('@playwright/test').Page) => page.locator('.right .name')

test('prev/next buttons navigate between photos and gray out at the ends', async ({ page }) => {
  await login(page)

  await page.setInputFiles('input[type=file]', ['tests/fixtures/200x100.png', 'tests/fixtures/1x1.png'])
  await expect(page.getByAltText('200x100.png')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByAltText('1x1.png')).toBeVisible({ timeout: 10_000 })

  // Open the first photo — Prev disabled, Next enabled.
  await page.getByAltText('200x100.png').click()
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible()
  await expect(page.getByRole('button', { name: '‹ Prev' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Next ›' })).toBeEnabled()
  await expect(name(page)).toHaveText('200x100.png')

  // Next → second photo; Prev enabled, Next disabled at the end.
  await page.getByRole('button', { name: 'Next ›' }).click()
  await expect(name(page)).toHaveText('1x1.png')
  await expect(page.getByRole('button', { name: '‹ Prev' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Next ›' })).toBeDisabled()

  // Prev → back to first.
  await page.getByRole('button', { name: '‹ Prev' }).click()
  await expect(name(page)).toHaveText('200x100.png')
})

test('arrow keys navigate between photos', async ({ page }) => {
  await login(page)

  await page.setInputFiles('input[type=file]', ['tests/fixtures/200x100.png', 'tests/fixtures/1x1.png'])
  await expect(page.getByAltText('200x100.png')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByAltText('1x1.png')).toBeVisible({ timeout: 10_000 })

  await page.getByAltText('200x100.png').click()
  await expect(name(page)).toHaveText('200x100.png')

  await page.keyboard.press('ArrowRight')
  await expect(name(page)).toHaveText('1x1.png')

  await page.keyboard.press('ArrowLeft')
  await expect(name(page)).toHaveText('200x100.png')
})

test('image fills the whole left area at its natural aspect (2:3 and 3:2)', async ({ page }) => {
  await login(page)

  async function measure(file: string) {
    await page.setInputFiles('input[type=file]', file)
    await expect(page.getByAltText(file.split('/').pop()!)).toBeVisible({ timeout: 10_000 })
    await page.getByAltText(file.split('/').pop()!).click()
    await expect(page.locator('.h-se')).toBeVisible()
    const m = await page.evaluate(() => {
      const left = document.querySelector('.left')!.getBoundingClientRect()
      const right = document.querySelector('.right')!.getBoundingClientRect()
      const stage = document.querySelector('.stage')!.getBoundingClientRect()
      const crop = document.querySelector('.crop-box')!.getBoundingClientRect()
      return {
        leftW: left.width, leftH: left.height,
        rightW: right.width,
        stageW: stage.width, stageH: stage.height,
        cropW: crop.width, cropH: crop.height,
        cropAspect: crop.width / crop.height,
        hasSquarePreview: !!document.querySelector('.preview'),
      }
    })
    console.log(`${file} → ${JSON.stringify(m)}`)
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Reset' }).click()
    return m
  }

  // The full-image crop-box spans the visible image, so its aspect = image aspect.
  const portrait = await measure('tests/fixtures/portrait23.png') // 2:3 → aspect 0.667
  expect(portrait.hasSquarePreview).toBe(false)
  expect(portrait.leftW).toBeGreaterThan(portrait.rightW * 2) // left dominates
  expect(Math.abs(portrait.cropW - portrait.stageW) < 2 || Math.abs(portrait.cropH - portrait.stageH) < 2).toBe(true)
  expect(portrait.cropAspect).toBeCloseTo(2 / 3, 1)

  const landscape = await measure('tests/fixtures/landscape32.png') // 3:2 → aspect 1.5
  expect(landscape.cropAspect).toBeCloseTo(3 / 2, 1)
  expect(Math.abs(landscape.cropW - landscape.stageW) < 2 || Math.abs(landscape.cropH - landscape.stageH) < 2).toBe(true)
})
