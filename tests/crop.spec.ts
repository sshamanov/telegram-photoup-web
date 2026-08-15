import { test, expect } from '@playwright/test'

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Send to')).toBeVisible()
}

test('crop frame resizes the image via a corner handle', async ({ page }) => {
  await login(page)

  await page.setInputFiles('input[type=file]', 'tests/fixtures/200x100.png')
  await expect(page.getByAltText('200x100.png')).toBeVisible({ timeout: 10_000 })

  await page.getByAltText('200x100.png').click()
  await expect(page.getByRole('button', { name: 'Crop' })).toBeVisible()

  const img = page.locator('.stage img')
  const before = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)
  expect(before).toBe(200)

  // Enter crop mode — a full-image frame with resize handles appears.
  await page.getByRole('button', { name: 'Crop' }).click()
  await expect(page.locator('.h-se')).toBeVisible()

  // Drag the bottom-right handle toward the centre to shrink the crop.
  const handle = page.locator('.h-se')
  const hb = await handle.boundingBox()
  const sb = await page.locator('.stage').boundingBox()
  expect(hb).not.toBeNull()
  expect(sb).not.toBeNull()

  await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb!.x + sb!.width * 0.6, sb!.y + sb!.height * 0.6, { steps: 6 })
  await page.mouse.up()

  await page.getByRole('button', { name: 'Apply' }).click()

  // Crop committed → the re-rendered thumbnail is smaller than the 200px source.
  await expect
    .poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeLessThan(before)
})

test('cancel discards the crop and keeps the original frame', async ({ page }) => {
  await login(page)

  await page.setInputFiles('input[type=file]', 'tests/fixtures/200x100.png')
  await expect(page.getByAltText('200x100.png')).toBeVisible({ timeout: 10_000 })

  await page.getByAltText('200x100.png').click()

  const img = page.locator('.stage img')
  const before = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)

  await page.getByRole('button', { name: 'Crop' }).click()
  await expect(page.locator('.h-se')).toBeVisible()

  const handle = page.locator('.h-se')
  const hb = await handle.boundingBox()
  const sb = await page.locator('.stage').boundingBox()
  await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb!.x + sb!.width * 0.5, sb!.y + sb!.height * 0.5, { steps: 6 })
  await page.mouse.up()

  await page.getByRole('button', { name: 'Cancel' }).click()

  // No crop committed — the thumbnail keeps its original width.
  await expect.poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(before)
})
