import { test, expect } from '@playwright/test'

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Send to')).toBeVisible()
}

test('crop commits a region that actually crops the image', async ({ page }) => {
  await login(page)

  await page.setInputFiles('input[type=file]', 'tests/fixtures/200x100.png')
  await expect(page.getByAltText('200x100.png')).toBeVisible({ timeout: 10_000 })

  await page.getByAltText('200x100.png').click()
  await expect(page.getByRole('button', { name: 'Crop' })).toBeVisible()

  const img = page.locator('.stage img')
  const before = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)
  expect(before).toBe(200)

  await page.getByRole('button', { name: 'Crop' }).click()

  const stage = page.locator('.stage')
  const box = await stage.boundingBox()
  expect(box).not.toBeNull()

  const x0 = box!.x
  const y0 = box!.y
  const w = box!.width
  const h = box!.height

  // Drag a crop over the right ~half of the image.
  await page.mouse.move(x0 + w * 0.5, y0 + h * 0.05)
  await page.mouse.down()
  await page.mouse.move(x0 + w * 0.98, y0 + h * 0.95, { steps: 5 })
  await page.mouse.up()

  await page.getByRole('button', { name: 'Apply crop' }).click()

  // crop committed → overlay remains visible showing the applied region
  await expect(page.locator('.crop-box')).toBeVisible()

  // and the re-rendered thumbnail is narrower than the 200px source.
  await expect
    .poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeLessThan(before)
})
