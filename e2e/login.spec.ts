import { expect, test } from '@playwright/test'

test('logs in with email and password', async ({ page }) => {
	const runId = Date.now()
	const email = `user-${runId}@example.com`
	const password = 'password123'
	const seedResponse = await page.request.post('/auth', {
		data: { email, password, mode: 'signup' },
	})
	expect(seedResponse.ok()).toBe(true)
	await page.context().clearCookies()

	await page.goto('/login')
	await page.getByLabel('Email').fill(email)
	await page.getByLabel('Password').fill(password)
	await page.getByRole('button', { name: 'Sign in' }).click()

	await expect(page).toHaveURL(/\/account$/)
	await expect(
		page.getByRole('heading', { name: `Welcome, ${email}` }),
	).toBeVisible()
})

test('signs up with email and password', async ({ page }) => {
	const runId = Date.now()
	const email = `new-user-${runId}@example.com`

	await page.goto('/signup')
	await page.getByLabel('Email').fill(email)
	await page.getByLabel('Password').fill('password123')
	await page.getByRole('button', { name: 'Create account' }).click()

	await expect(page).toHaveURL(/\/account$/)
	await expect(
		page.getByRole('heading', { name: `Welcome, ${email}` }),
	).toBeVisible()
})
