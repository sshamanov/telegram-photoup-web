import { test, expect } from '@playwright/test'
import fs from 'node:fs'

test.skip(process.env.REAL_TG !== '1', 'real telegram test only')

const SESSION_FILE = './tmp/session.txt'
const GROUP = process.env.TG_GROUP ?? ''

test('measure JPEG send phases to the TEST group', async ({ context, page }) => {
  const session = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : ''
  if (session) await context.addInitScript((s) => localStorage.setItem('session', s), session)

  await page.goto('/')
  await expect(page.getByText('Send to')).toBeVisible({ timeout: 45_000 })
  await page.waitForTimeout(2500)
  await page.getByLabel('Send to').selectOption(GROUP)

  async function measure(file: string, name: string) {
    await page.setInputFiles('input[type=file]', file)
    await expect(page.getByAltText(name)).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1500)

    const t0 = Date.now()
    await page.getByRole('button', { name: /Send 1 selected/ }).click()
    // Preparing phase ends when "Sending" appears.
    await page.getByText(/Sending/).waitFor({ timeout: 120_000 })
    const prepare = Date.now() - t0
    // Send phase ends when the success toast appears.
    await page.getByText(/Sent 1 photo/).waitFor({ timeout: 120_000 })
    const total = Date.now() - t0
    console.log(name, JSON.stringify({ prepare, upload: total - prepare, total }))
  }

  await measure('tests/fixtures/1x1.png', '1x1.png')
  await measure('samples/DSC_4284.JPG', 'DSC_4284.JPG')
})
