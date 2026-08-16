import { test, expect } from '@playwright/test'
import fs from 'node:fs'

// Requires a real Telegram login — run with REAL_TG=1 against the real dev server.
test.skip(process.env.REAL_TG !== '1', 'real telegram login only')

const PHONE = process.env.TG_PHONE ?? ''
const CODE_FILE = './tmp/code.txt'
const PASS_FILE = './tmp/pass.txt'

async function waitForFile(path: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const v = fs.readFileSync(path, 'utf8').trim()
      if (v) return v
    } catch {
      /* not there yet */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return ''
}

test('real phone login', async ({ page }) => {
  test.setTimeout(300_000)
  await page.goto('/')
  await expect(page.getByPlaceholder('+1234567890')).toBeVisible({ timeout: 15_000 })

  await page.getByPlaceholder('+1234567890').fill(PHONE)
  await page.getByRole('button', { name: 'Send code' }).click()
  console.log('CODE_SENT')

  const code = await waitForFile(CODE_FILE, 180_000)
  if (!code) throw new Error('no code provided within 180s')
  console.log('CODE_RECEIVED', code)

  await page.getByPlaceholder('Code').fill(code)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Either we're connected (no 2FA) or a 2FA password prompt appears.
  const outcome = await Promise.race([
    page.getByText('Send to').waitFor({ timeout: 60_000 }).then(() => 'connected'),
    page.getByPlaceholder('2FA password').waitFor({ timeout: 60_000 }).then(() => '2fa'),
  ])
  if (outcome === '2fa') {
    console.log('2FA_REQUIRED')
    const pass = await waitForFile(PASS_FILE, 120_000)
    if (!pass) throw new Error('no 2FA password provided')
    await page.getByPlaceholder('2FA password').fill(pass)
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('Send to')).toBeVisible({ timeout: 60_000 })
  }

  await page.waitForTimeout(500)
  const session = await page.evaluate(() => localStorage.getItem('session'))
  console.log('LOGIN_OK', session ? 'session-present' : 'NO_SESSION')
})
