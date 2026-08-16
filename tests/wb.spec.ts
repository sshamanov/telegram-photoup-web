import { test, expect } from '@playwright/test'

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Send to')).toBeVisible()
}

test('JPEG editor has a white balance section with a relative slider and grey picker', async ({ page }) => {
  await login(page)

  await page.setInputFiles('input[type=file]', 'tests/fixtures/warm.png')
  await expect(page.getByAltText('warm.png')).toBeVisible({ timeout: 10_000 })
  await page.getByAltText('warm.png').click()
  await expect(page.locator('.h-se')).toBeVisible()

  // White balance section present for JPEG (no Kelvin slider).
  await expect(page.getByRole('button', { name: 'Grey picker' })).toBeVisible()

  // The grey-picker row shows the current correction (0.00 at neutral).
  await expect(page.locator('.right .wb')).toHaveText('0.00')

  // Two sliders: exposure (0 mark) and white balance (0 mark).
  const marks = await page.evaluate(() =>
    [...document.querySelectorAll('.right .slider .zero')].map((z) => z.getAttribute('data-label')),
  )
  expect(marks).toEqual(['0', '0'])

  // Dragging the wb slider updates the indicator.
  await page.locator('.right .slider').nth(1).locator('input').fill('1')
  await expect(page.locator('.right .wb')).toHaveText('+1.00')

  // Warm the image: dragging the wb slider to +1 raises red over blue.
  await page.locator('.right .slider').nth(1).locator('input').fill('1')
  await page.waitForTimeout(500)
  const ratio = await page.evaluate(() => {
    const img = document.querySelector('.stage img') as HTMLImageElement
    const c = document.createElement('canvas')
    c.width = 10
    c.height = 10
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0, 10, 10)
    const d = ctx.getImageData(5, 5, 1, 1).data
    return (d[0] ?? 0) / (d[2] ?? 1)
  })
  expect(ratio).toBeGreaterThan(2)
})
