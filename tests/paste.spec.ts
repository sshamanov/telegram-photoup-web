import { test, expect } from '@playwright/test'

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Send to')).toBeVisible()
}

test('Ctrl+V pastes copied image files into the grid', async ({ page }) => {
  await login(page)

  // Simulate copying an image from the file manager: dispatch a paste event with it.
  await page.evaluate((b64) => {
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)!
    const file = new File([arr], 'pasted.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }))
  }, PNG_1x1)

  // The pasted photo develops into a thumbnail — exactly once.
  await expect(page.locator('.thumb img[alt="pasted.png"]')).toHaveCount(1, { timeout: 10_000 })
})

test('paste ignores non-image files', async ({ page }) => {
  await login(page)

  await page.evaluate(() => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const dt = new DataTransfer()
    dt.items.add(file)
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }))
  })

  // Nothing added.
  await page.waitForTimeout(400)
  await expect(page.locator('.thumb')).toHaveCount(0)
})
