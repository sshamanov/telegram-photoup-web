import { test, expect } from '@playwright/test'

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Send to')).toBeVisible()
}

test('thumbnail shows the exposure correction badge in the top-right corner', async ({ page }) => {
  await login(page)

  await page.setInputFiles('input[type=file]', 'tests/fixtures/warm.png')
  await expect(page.getByAltText('warm.png')).toBeVisible({ timeout: 10_000 })

  // Set a manual +1 EV correction, close the editor.
  await page.getByAltText('warm.png').click()
  await expect(page.locator('.h-se')).toBeVisible()
  await page.locator('.right .slider').first().locator('input').fill('1')
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Close' }).click()

  const badge = page.locator('.thumb .ev-badge')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText('+1.0')
})
