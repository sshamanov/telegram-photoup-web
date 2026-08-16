import { test, expect } from '@playwright/test'
import fs from 'node:fs'

// Real Telegram end-to-end: login-or-reconnect + send a batch to the target group.
// Run with REAL_TG=1 against the real dev server.
// The Telegram session is saved to tmp/session.txt after the first login and
// reused afterwards, so a phone code is only ever needed once.
test.skip(process.env.REAL_TG !== '1', 'real telegram test only')

const PHONE = process.env.TG_PHONE ?? ''
const GROUP = process.env.TG_GROUP ?? ''
const CODE_FILE = './tmp/code.txt'
const PASS_FILE = './tmp/pass.txt'
const SESSION_FILE = './tmp/session.txt'

const savedSession = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : ''

// 12 sample JPEGs → 2 albums (10 + 2), proving real posting + chunking.
const FILES = [
  'samples/DSC_4284.JPG', 'samples/DSC_4298.JPG', 'samples/DSC_4314.JPG',
  'samples/DSC_4343.JPG', 'samples/DSC_4452.JPG', 'samples/DSC_4499.JPG',
  'samples/DSC_4526.JPG', 'samples/DSC_4682.JPG', 'samples/DSC_4785.JPG',
  'samples/DSC_4786.JPG', 'samples/DSC_4793.JPG', 'samples/DSC_4860.JPG',
]

async function waitForFile(path: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const v = fs.readFileSync(path, 'utf8').trim()
      if (v) return v
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return ''
}

test('real login-or-reconnect + batch send to group', async ({ context, page }) => {
  test.setTimeout(360_000)

  if (savedSession) {
    // Reuse the saved session — no login needed.
    await context.addInitScript((s) => localStorage.setItem('session', s), savedSession)
    await page.goto('/')
    await expect(page.getByText('Send to')).toBeVisible({ timeout: 45_000 })
    console.log('RECONNECTED')
  } else {
    // First time: phone login, then persist the session for future runs.
    await page.goto('/')
    await expect(page.getByPlaceholder('+1234567890')).toBeVisible({ timeout: 15_000 })
    await page.getByPlaceholder('+1234567890').fill(PHONE)
    await page.getByRole('button', { name: 'Send code' }).click()
    console.log('CODE_SENT')

    const code = await waitForFile(CODE_FILE, 180_000)
    if (!code) throw new Error('no code provided')
    await page.getByPlaceholder('Code').fill(code)
    await page.getByRole('button', { name: 'Sign in' }).click()

    const outcome = await Promise.race([
      page.getByText('Send to').waitFor({ timeout: 60_000 }).then(() => 'connected'),
      page.getByPlaceholder('2FA password').waitFor({ timeout: 60_000 }).then(() => '2fa'),
    ])
    if (outcome === '2fa') {
      console.log('2FA_REQUIRED')
      const pass = await waitForFile(PASS_FILE, 120_000)
      if (!pass) throw new Error('no 2FA password')
      await page.getByPlaceholder('2FA password').fill(pass)
      await page.getByRole('button', { name: 'Confirm' }).click()
      await expect(page.getByText('Send to')).toBeVisible({ timeout: 60_000 })
    }
    console.log('LOGIN_OK')
    await page.waitForTimeout(1000)
    const s = await page.evaluate(() => localStorage.getItem('session'))
    if (!s) throw new Error('no session after login')
    fs.writeFileSync(SESSION_FILE, s)
    console.log('SESSION_SAVED')
  }

  // Upload + develop.
  await page.setInputFiles('input[type=file]', FILES)
  await expect(page.locator('.thumb')).toHaveCount(FILES.length, { timeout: 120_000 })
  await page.waitForTimeout(2000)

  // Select the target group.
  const select = page.getByLabel('Send to')
  await select.waitFor({ timeout: 20_000 })
  const hasGroup = (await select.locator(`option[value="${GROUP}"]`).count()) > 0
  if (!hasGroup) {
    const opts = await select.evaluate((el) => {
      const sel = el as HTMLSelectElement
      return [...sel.options].map((o) => `${o.value}=${o.text}`).join(' | ')
    })
    console.log('NO_GROUP', opts)
    throw new Error('target group not in dialog list')
  }
  await select.selectOption(GROUP)
  console.log('GROUP_SELECTED')

  // Send.
  await page.getByRole('button', { name: /Send 12 selected/ }).click()
  await expect(page.getByText(/Sent 12 photo/)).toBeVisible({ timeout: 300_000 })
  console.log('SEND_OK')
})
