/**
 * Playwright smoke: login → receive → send → receive → put on sale → POS
 *
 * Prerequisites:
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 *   E2E_EMAIL / E2E_PASSWORD for a warehouse+POS capable user
 *
 * Run: npx playwright test e2e/ops-smoke.spec.ts
 */
import { test, expect } from '@playwright/test'

const email = process.env.E2E_EMAIL ?? ''
const password = process.env.E2E_PASSWORD ?? ''
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

test.describe('Ops happy path', () => {
  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD')

  test('login lands on dashboard', async ({ page }) => {
    await page.goto(`${baseURL}/login`)
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(password)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({ timeout: 15000 })
  })

  test('warehouse receive page opens', async ({ page }) => {
    await page.goto(`${baseURL}/login`)
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(password)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    await page.goto(`${baseURL}/warehouse/receive`)
    await expect(page.getByRole('heading', { name: /receive/i })).toBeVisible({ timeout: 15000 })
  })

  test('transfers and POS routes load', async ({ page }) => {
    await page.goto(`${baseURL}/login`)
    await page.getByLabel(/email/i).fill(email)
    await page.getByLabel(/password/i).fill(password)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    await page.goto(`${baseURL}/warehouse/transfers`)
    await expect(page.getByText(/transfer|send/i).first()).toBeVisible({ timeout: 15000 })
    await page.goto(`${baseURL}/pos`)
    await expect(page.getByText(/cart|search|pay/i).first()).toBeVisible({ timeout: 15000 })
  })
})
