import { test, expect } from '@playwright/test'
import fs from 'node:fs'

test.skip(process.env.REAL_TG !== '1', 'real telegram test only')

const SESSION_FILE = './tmp/session.txt'

test('list real dialogs and their ids', async ({ context, page }) => {
  const session = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : ''
  if (session) await context.addInitScript((s) => localStorage.setItem('session', s), session)

  const logs: string[] = []
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`pageerror: ${String(e)}`))

  await page.goto('/')
  await expect(page.getByText('Send to')).toBeVisible({ timeout: 45_000 })
  await page.waitForTimeout(4000)

  const opts = await page.getByLabel('Send to').evaluate((el) => {
    const sel = el as HTMLSelectElement
    return [...sel.options].map((o) => `${o.value}=${o.text}`)
  })
  console.log('DIALOGS', JSON.stringify(opts))
  console.log('CONSOLE', JSON.stringify(logs.slice(-15)))
})
