import { test, expect } from '@playwright/test'

// 1x1 transparent PNG — small enough to decode in the worker, deterministic.
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('login → upload → processed thumbnail → select group → send', async ({ page }) => {
  await page.goto('/')

  // Auth screen (mock adapter: no real credentials needed).
  await expect(page.getByPlaceholder('+1234567890')).toBeVisible()
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Connected — upload + group selector visible.
  await expect(page.getByText('Send to')).toBeVisible()

  // Upload a photo; it should process and show a thumbnail.
  await page.setInputFiles('input[type=file]', {
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: ONE_PX_PNG,
  })
  await expect(page.getByAltText('sample.png')).toBeVisible({ timeout: 10_000 })

  // Select a target group from the mock dialog list.
  await page.getByLabel('Send to').selectOption('100')

  // Send as an album of selected photos.
  await page.getByRole('button', { name: /Send 1 selected/ }).click()
  await expect(page.getByText(/Sent 1 photo/)).toBeVisible()
})
