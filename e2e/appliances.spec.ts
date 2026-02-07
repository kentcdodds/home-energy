import { randomUUID } from 'node:crypto'
import {
	expect,
	test,
	type APIRequestContext,
	type Page,
} from '@playwright/test'

async function registerUser(
	request: APIRequestContext,
	email: string,
	password: string,
) {
	const response = await request.post('/auth', {
		data: { email, password, mode: 'signup' },
	})
	expect(response.ok()).toBeTruthy()
}

async function login(page: Page, email: string, password: string) {
	await page.goto('/login')
	await page.getByLabel('Email').fill(email)
	await page.getByLabel('Password').fill(password)
	await page.getByRole('button', { name: 'Sign in' }).click()
	await expect(page).toHaveURL(/\/account$/)
}

async function readTotalWatts(page: Page) {
	const summary = page.getByText('Total watts').locator('..')
	const text = (await summary.textContent()) ?? ''
	const match = text.match(/(\d+)\s*W/)
	return match ? Number(match[1]) : 0
}

test('redirects logged-out users to login', async ({ page }) => {
	await page.goto('/appliances')
	await expect(page).toHaveURL(/\/login$/)
})

test('manages appliances and totals', async ({ page }) => {
	const email = `user-${randomUUID()}@example.com`
	const password = 'password123'
	await registerUser(page.request, email, password)
	await page.context().clearCookies()
	await login(page, email, password)

	await page.goto('/appliances')
	await expect(page.getByRole('heading', { name: 'Appliances' })).toBeVisible()

	const runId = Date.now()
	const heaterName = `Space heater ${runId}`
	const fanName = `Fan ${runId}`
	const startingTotal = await readTotalWatts(page)

	await page.getByLabel('Appliance name').fill(heaterName)
	await page.getByLabel('Watts').fill('1500')
	await Promise.all([
		page.waitForNavigation(),
		page.getByRole('button', { name: 'Add appliance' }).click(),
	])

	await expect(
		page.getByRole('listitem').filter({ hasText: heaterName }),
	).toBeVisible()
	await expect(
		page
			.getByRole('listitem')
			.filter({ hasText: heaterName })
			.getByText('1500 W'),
	).toBeVisible()

	await expect(page.getByRole('heading', { name: 'Appliances' })).toBeVisible()

	await page.getByLabel('Appliance name').fill(fanName)
	await page.getByLabel('Amps').fill('1.5')
	await page.getByLabel('Volts').fill('120')
	await Promise.all([
		page.waitForNavigation(),
		page.getByRole('button', { name: 'Add appliance' }).click(),
	])

	await expect(
		page.getByRole('listitem').filter({ hasText: fanName }),
	).toBeVisible()

	const totalSummary = page.getByText('Total watts').locator('..')
	await expect(totalSummary).toContainText(`${startingTotal + 1680} W`)

	await Promise.all([
		page.waitForNavigation(),
		page.getByRole('button', { name: `Delete ${fanName}` }).click(),
	])
	await expect(totalSummary).toContainText(`${startingTotal + 1500} W`)
	await expect(page.getByText(fanName)).toHaveCount(0)
})
