import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'

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

test('logs in with email and password', async ({ page }) => {
	const email = `user-${randomUUID()}@example.com`
	const password = 'password123'
	await registerUser(page.request, email, password)
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
	const email = `new-user-${randomUUID()}@example.com`

	await page.goto('/signup')

	await page.getByLabel('Email').fill(email)
	await page.getByLabel('Password').fill('password123')
	await page.getByRole('button', { name: 'Create account' }).click()

	await expect(page).toHaveURL(/\/account$/)
	await expect(
		page.getByRole('heading', { name: `Welcome, ${email}` }),
	).toBeVisible()
})
