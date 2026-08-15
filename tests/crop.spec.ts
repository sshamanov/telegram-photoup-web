import { test, expect } from '@playwright/test'

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Send to')).toBeVisible()
}

async function openEditor(page: import('@playwright/test').Page): Promise<void> {
  await page.setInputFiles('input[type=file]', 'tests/fixtures/200x100.png')
  await expect(page.getByAltText('200x100.png')).toBeVisible({ timeout: 10_000 })
  await page.getByAltText('200x100.png').click()
  // Crop mode is on by default — the frame and handles are immediately visible.
  await expect(page.locator('.h-se')).toBeVisible()
}

test('crop auto-applies on release and persists after Close', async ({ page }) => {
  await login(page)
  await openEditor(page)

  const box = (await page.locator('.crop-box').boundingBox())!
  const hb = (await page.locator('.h-se').boundingBox())!

  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 6 })
  await page.mouse.up() // crop commits on release

  await page.getByRole('button', { name: 'Close' }).click()

  const gridImg = page.locator('.thumb img')
  await expect
    .poll(async () => gridImg.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeLessThan(200)
})

test('Reset crop restores the full frame', async ({ page }) => {
  await login(page)
  await openEditor(page)

  await page.getByRole('button', { name: '1:1' }).click()
  const shrunk = (await page.locator('.crop-box').boundingBox())!

  await page.getByRole('button', { name: 'Reset crop' }).click()
  const full = (await page.locator('.crop-box').boundingBox())!

  expect(full.width).toBeGreaterThan(shrunk.width)
})

test('1:1 preset produces a square crop frame', async ({ page }) => {
  await login(page)
  await openEditor(page)

  await page.getByRole('button', { name: '1:1' }).click()
  const box = (await page.locator('.crop-box').boundingBox())!
  expect(Math.abs(box.width - box.height)).toBeLessThan(1)
})

test('Shift+drag keeps the crop aspect ratio', async ({ page }) => {
  await login(page)
  await openEditor(page)

  const box = (await page.locator('.crop-box').boundingBox())!
  const aspect = box.width / box.height // 2:1 for the 200x100 fixture

  const hb = (await page.locator('.h-se').boundingBox())!
  await page.keyboard.down('Shift')
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  // Off-diagonal target — without Shift this would distort, Shift keeps 2:1.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Shift')

  const after = (await page.locator('.crop-box').boundingBox())!
  expect(after.width / after.height).toBeCloseTo(aspect, 1)
})

test('re-opening the editor shows the old crop for refinement', async ({ page }) => {
  await login(page)
  await openEditor(page)

  await page.getByRole('button', { name: '1:1' }).click()
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByAltText('200x100.png').click()
  await expect(page.locator('.h-se')).toBeVisible()

  const box = (await page.locator('.crop-box').boundingBox())!
  expect(Math.abs(box.width - box.height)).toBeLessThan(1)
})
