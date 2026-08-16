import { test, expect } from '@playwright/test'
async function login(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByPlaceholder('+1234567890').fill('+1234567890')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByPlaceholder('Code').fill('12345')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Send to')).toBeVisible()
}
const FIXTURES = ['tests/fixtures/1x1.png', 'tests/fixtures/warm.png', 'tests/fixtures/200x100.png', 'tests/fixtures/portrait23.png', 'tests/fixtures/landscape32.png']

test('sends >10 photos in multiple albums', async ({ page }) => {
  await login(page)
  const albums: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('send:album')) albums.push(m.text())
  })
  // 12 photos (5 unique fixtures repeated).
  const files: string[] = []
  for (let i = 0; i < 12; i++) files.push(FIXTURES[i % FIXTURES.length]!)
  await page.setInputFiles('input[type=file]', files)
  await expect(page.locator('.thumb')).toHaveCount(12, { timeout: 30_000 })
  await page.getByLabel('Send to').selectOption('100')
  await page.getByRole('button', { name: /Send 12 selected/ }).click()
  await expect(page.getByText(/Sent 12 photo/)).toBeVisible({ timeout: 120_000 })
  console.log('ALBUMS', JSON.stringify(albums))
  // 12 photos → 2 albums: 10 + 2 (Telegram caps albums at 10).
  expect(albums.length).toBe(2)
  expect(albums[0]).toContain('count: 10')
  expect(albums[1]).toContain('count: 2')
  // All sent → grid cleared.
  await expect(page.locator('.thumb')).toHaveCount(0)
})

test('sending a subset keeps the unsent photos with their edits', async ({ page }) => {
  await login(page)
  await page.setInputFiles('input[type=file]', ['tests/fixtures/200x100.png', 'tests/fixtures/1x1.png', 'tests/fixtures/warm.png'])
  await expect(page.locator('.thumb')).toHaveCount(3, { timeout: 30_000 })

  // Deselect two, leaving only 200x100 selected.
  await page.getByLabel('select 1x1.png').uncheck()
  await page.getByLabel('select warm.png').uncheck()

  await page.getByLabel('Send to').selectOption('100')
  await page.getByRole('button', { name: /Send 1 selected/ }).click()
  await expect(page.getByText(/Sent 1 photo/)).toBeVisible({ timeout: 60_000 })

  // The sent photo is removed; the two unsent remain.
  await expect(page.locator('.thumb')).toHaveCount(2)
  await expect(page.getByAltText('1x1.png')).toBeVisible()
  await expect(page.getByAltText('warm.png')).toBeVisible()
})
