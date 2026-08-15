import { test, expect } from '@playwright/test'

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Send to')).toBeVisible()
}

async function openCrop(page: import('@playwright/test').Page): Promise<void> {
  await page.setInputFiles('input[type=file]', 'tests/fixtures/200x100.png')
  await expect(page.getByAltText('200x100.png')).toBeVisible({ timeout: 10_000 })
  await page.getByAltText('200x100.png').click()
  await expect(page.getByRole('button', { name: 'Crop' })).toBeVisible()
  await page.getByRole('button', { name: 'Crop' }).click()
  await expect(page.locator('.h-se')).toBeVisible()
}

test('crop frame resizes the image via a corner handle', async ({ page }) => {
  await login(page)
  await openCrop(page)

  const img = page.locator('.stage img')
  const before = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)
  expect(before).toBe(200)

  const hb = (await page.locator('.h-se').boundingBox())!
  const sb = (await page.locator('.stage').boundingBox())!
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height * 0.6, { steps: 6 })
  await page.mouse.up()

  await page.getByRole('button', { name: 'Apply' }).click()

  await expect
    .poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeLessThan(before)
})

test('cancel discards the crop and keeps the original frame', async ({ page }) => {
  await login(page)
  await openCrop(page)

  const img = page.locator('.stage img')
  const before = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)

  const hb = (await page.locator('.h-se').boundingBox())!
  const sb = (await page.locator('.stage').boundingBox())!
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height * 0.5, { steps: 6 })
  await page.mouse.up()

  await page.getByRole('button', { name: 'Cancel' }).click()

  await expect.poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(before)
})

test('1:1 preset produces a square crop frame', async ({ page }) => {
  await login(page)
  await openCrop(page)

  await page.getByRole('button', { name: '1:1' }).click()

  const box = (await page.locator('.crop-box').boundingBox())!
  // The 200x100 image cropped square: crop-box width and height must be equal.
  expect(Math.abs(box.width - box.height)).toBeLessThan(1)
})

test('Shift+drag keeps the crop aspect ratio', async ({ page }) => {
  await login(page)
  await openCrop(page)

  const hb = (await page.locator('.h-se').boundingBox())!
  const sb = (await page.locator('.stage').boundingBox())!

  await page.keyboard.down('Shift')
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  // Off-diagonal target — without Shift this would distort to ~3:1, Shift keeps 2:1.
  await page.mouse.move(sb.x + sb.width * 0.6, sb.y + sb.height * 0.4, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Shift')

  const box = (await page.locator('.crop-box').boundingBox())!
  expect(box.width / box.height).toBeCloseTo(2, 1)
})
