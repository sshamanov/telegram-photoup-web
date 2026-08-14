import { test, expect } from '@playwright/test'

const FIXTURE = 'tests/fixtures/1x1.png'

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
  await page.setInputFiles('input[type=file]', FIXTURE)
  await expect(page.getByAltText('1x1.png')).toBeVisible({ timeout: 10_000 })

  // Select a target group from the mock dialog list.
  await page.getByLabel('Send to').selectOption('100')

  // Send as an album of selected photos.
  await page.getByRole('button', { name: /Send 1 selected/ }).click()
  await expect(page.getByText(/Sent 6 variants/)).toBeVisible()
})
