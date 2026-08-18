import { test, expect } from '@playwright/test'

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Send to')).toBeVisible()
}

test('Reject removes the current photo and closes the editor', async ({ page }) => {
  await login(page)
  await page.setInputFiles('input[type=file]', ['tests/fixtures/200x100.png', 'tests/fixtures/1x1.png'])
  await expect(page.locator('.thumb')).toHaveCount(2, { timeout: 30_000 })

  await page.getByAltText('200x100.png').click()
  await expect(page.locator('.h-se')).toBeVisible()
  await page.getByRole('button', { name: 'Reject' }).click()

  // The photo is removed and the editor closed.
  await expect(page.locator('.thumb')).toHaveCount(1)
  await expect(page.getByAltText('1x1.png')).toBeVisible()
  await expect(page.getByAltText('200x100.png')).toHaveCount(0)
})

test('Ctrl+A selects all, second Ctrl+A deselects all', async ({ page }) => {
  await login(page)
  await page.setInputFiles('input[type=file]', ['tests/fixtures/200x100.png', 'tests/fixtures/1x1.png', 'tests/fixtures/warm.png'])
  await expect(page.locator('.thumb')).toHaveCount(3, { timeout: 30_000 })

  // Initially all selected.
  await expect(page.getByRole('button', { name: /Send 3 selected/ })).toBeVisible()

  // Deselect one, then Ctrl+A selects all.
  await page.getByLabel('select 1x1.png').uncheck()
  await expect(page.getByRole('button', { name: /Send 2 selected/ })).toBeVisible()

  await page.keyboard.press('Control+a')
  await expect(page.getByRole('button', { name: /Send 3 selected/ })).toBeVisible()

  // Second Ctrl+A deselects all.
  await page.keyboard.press('Control+a')
  await expect(page.getByRole('button', { name: /Send 0 selected/ })).toBeVisible()
})
