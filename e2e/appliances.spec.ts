import { expect, test, type Page } from '@playwright/test'

async function login(page: Page) {
	await page.goto('/login')
	await page.getByLabel('Email').fill('user@example.com')
	await page.getByLabel('Password').fill('password123')
	await page.getByRole('button', { name: 'Sign in' }).click()
	await expect(page).toHaveURL(/\/account$/)
}

async function readTotalWatts(page: Page) {
	const summary = page.getByText('Total watts').locator('..')
	const text = (await summary.textContent()) ?? ''
	const match = text.match(/(\d+)\s*W/)
	return match ? Number(match[1]) : 0
}

async function waitForAppliancesReady(page: Page) {
	await expect(page.getByRole('heading', { name: 'Appliances' })).toBeVisible()
	const loading = page.getByText('Loading appliances…')
	await loading.waitFor({ state: 'hidden' })
	const loadError = page
		.getByRole('alert')
		.filter({ hasText: 'Unable to load appliances.' })
	if (await loadError.isVisible()) {
		await page.reload()
		await loading.waitFor({ state: 'hidden' })
	}
}

test('redirects logged-out users to login', async ({ page }) => {
	await page.goto('/appliances')
	await expect(page).toHaveURL(/\/login\?redirectTo=%2Fappliances$/)
})

test('manages appliances and totals', async ({ page }) => {
	await login(page)

	await page.goto('/appliances')
	await waitForAppliancesReady(page)

	const runId = Date.now()
	const heaterName = `Space heater ${runId}`
	const fanName = `Fan ${runId}`
	const heaterNotes = `Near the living room outlet ${runId}`
	const startingTotal = await readTotalWatts(page)

	await page.getByLabel('Appliance name').fill(heaterName)
	await page.getByLabel('Notes (optional)').fill(heaterNotes)
	await page.getByLabel('Watts').fill('1500')
	await Promise.all([
		page.waitForNavigation(),
		page.getByRole('button', { name: 'Add appliance' }).click(),
	])
	await waitForAppliancesReady(page)

	await expect(
		page.getByRole('listitem').filter({ hasText: heaterName }),
	).toBeVisible()
	await expect(
		page
			.getByRole('listitem')
			.filter({ hasText: heaterName })
			.getByText('1500 W'),
	).toBeVisible()
	await expect(
		page
			.getByRole('listitem')
			.filter({ hasText: heaterName })
			.getByText(heaterNotes),
	).toBeVisible()

	await expect(page.getByRole('heading', { name: 'Appliances' })).toBeVisible()

	await page.getByLabel('Appliance name').fill(fanName)
	await page.getByLabel('Amps').fill('1.5')
	await page.getByLabel('Volts').fill('120')
	await Promise.all([
		page.waitForNavigation(),
		page.getByRole('button', { name: 'Add appliance' }).click(),
	])
	await waitForAppliancesReady(page)

	await expect(
		page.getByRole('listitem').filter({ hasText: fanName }),
	).toBeVisible()

	const totalSummary = page.getByText('Total watts').locator('..')
	await expect(totalSummary).toContainText(`${startingTotal + 1680} W`)

	await Promise.all([
		page.waitForNavigation(),
		page.getByRole('button', { name: `Delete ${fanName}` }).click(),
	])
	await waitForAppliancesReady(page)
	await expect(totalSummary).toContainText(`${startingTotal + 1500} W`)
	await expect(page.getByText(fanName)).toHaveCount(0)
})
