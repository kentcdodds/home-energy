/// <reference types="bun" />
import { beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { RequestContext } from 'remix/fetch-router'
import { z } from 'zod'
import { setAuthSessionSecret } from '../auth-session.ts'
import { createPasswordHash, verifyPassword } from '../password-hash.ts'
import { createDb, sql } from '../../worker/db.ts'
import { createAuthHandler } from './auth.ts'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))

async function runMigration(db: D1Database, sqlText: string) {
	const statements = sqlText
		.split(';')
		.map((statement) => statement.trim())
		.filter(Boolean)
	for (const statement of statements) {
		await db.prepare(statement).run()
	}
}

async function createTestDatabase() {
	const persistDir = await mkdtemp(join(tmpdir(), 'epicflare-d1-test-'))
	const miniflare = new Miniflare({
		modules: true,
		script: 'export default { fetch() { return new Response("ok") } }',
		d1Databases: { APP_DB: 'APP_DB' },
		d1Persist: persistDir,
	})
	const appDb = await miniflare.getD1Database('APP_DB')
	const userMigration = await Bun.file(
		join(projectRoot, 'migrations', '0001-init.sql'),
	).text()
	await runMigration(appDb, userMigration)

	return {
		appDb,
		[Symbol.asyncDispose]: async () => {
			await miniflare.dispose()
			await rm(persistDir, { recursive: true, force: true })
		},
	}
}

function createAuthRequest(
	body: unknown,
	url: string,
	handler: ReturnType<typeof createAuthHandler>,
) {
	const request = new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	})
	const context = new RequestContext(request)

	return {
		run: () => handler.action(context),
	}
}

async function createUser(
	db: ReturnType<typeof createDb>,
	email: string,
	password: string,
) {
	const passwordHash = await createPasswordHash(password)
	const record = await db.queryFirst(
		sql`
			INSERT INTO users (username, email, password_hash)
			VALUES (${email}, ${email}, ${passwordHash})
			RETURNING id
		`,
		z.object({ id: z.number() }),
	)
	if (!record) {
		throw new Error('Failed to create user')
	}
	return { id: record.id, passwordHash }
}

beforeAll(() => {
	setAuthSessionSecret('test-cookie-secret')
})

test('auth handler returns 400 for invalid JSON', async () => {
	await using database = await createTestDatabase()
	const handler = createAuthHandler({
		COOKIE_SECRET: 'test-cookie-secret',
		APP_DB: database.appDb,
	})
	const authRequest = createAuthRequest('{', 'http://example.com/auth', handler)
	const response = await authRequest.run()
	expect(response.status).toBe(400)
	const payload = await response.json()
	expect(payload).toEqual({ error: 'Invalid JSON payload.' })
})

test('auth handler returns 400 for missing fields', async () => {
	await using database = await createTestDatabase()
	const handler = createAuthHandler({
		COOKIE_SECRET: 'test-cookie-secret',
		APP_DB: database.appDb,
	})
	const authRequest = createAuthRequest(
		{ email: 'a@b.com' },
		'http://example.com/auth',
		handler,
	)
	const response = await authRequest.run()
	expect(response.status).toBe(400)
	const payload = await response.json()
	expect(payload).toEqual({
		error: 'Email, password, and mode are required.',
	})
})

test('auth handler creates users on signup', async () => {
	await using database = await createTestDatabase()
	const handler = createAuthHandler({
		COOKIE_SECRET: 'test-cookie-secret',
		APP_DB: database.appDb,
	})
	const authRequest = createAuthRequest(
		{ email: 'new-user@example.com', password: 'secret', mode: 'signup' },
		'http://example.com/auth',
		handler,
	)
	const response = await authRequest.run()
	expect(response.status).toBe(200)
	const payload = await response.json()
	expect(payload).toEqual({ ok: true, mode: 'signup' })
	const setCookie = response.headers.get('Set-Cookie') ?? ''
	expect(setCookie).toContain('epicflare_session=')

	const db = createDb(database.appDb)
	const record = await db.queryFirst(
		sql`SELECT email, password_hash FROM users WHERE email = ${'new-user@example.com'}`,
		z.object({ email: z.string(), password_hash: z.string() }),
	)
	if (!record) {
		throw new Error('Expected user record to be created.')
	}
	const passwordCheck = await verifyPassword('secret', record.password_hash)
	expect(passwordCheck.valid).toBe(true)
})

test('auth handler validates credentials for login', async () => {
	await using database = await createTestDatabase()
	const handler = createAuthHandler({
		COOKIE_SECRET: 'test-cookie-secret',
		APP_DB: database.appDb,
	})
	const db = createDb(database.appDb)
	await createUser(db, 'login-user@example.com', 'secret')

	const authRequest = createAuthRequest(
		{ email: 'login-user@example.com', password: 'secret', mode: 'login' },
		'http://example.com/auth',
		handler,
	)
	const response = await authRequest.run()
	expect(response.status).toBe(200)
	const payload = await response.json()
	expect(payload).toEqual({ ok: true, mode: 'login' })
	const setCookie = response.headers.get('Set-Cookie') ?? ''
	expect(setCookie).toContain('epicflare_session=')
})

test('auth handler rejects invalid login credentials', async () => {
	await using database = await createTestDatabase()
	const handler = createAuthHandler({
		COOKIE_SECRET: 'test-cookie-secret',
		APP_DB: database.appDb,
	})
	const db = createDb(database.appDb)
	await createUser(db, 'login-user@example.com', 'secret')

	const authRequest = createAuthRequest(
		{ email: 'login-user@example.com', password: 'wrong', mode: 'login' },
		'http://example.com/auth',
		handler,
	)
	const response = await authRequest.run()
	expect(response.status).toBe(401)
	const payload = await response.json()
	expect(payload).toEqual({ error: 'Invalid email or password.' })
})

test('auth handler sets Secure cookie over https', async () => {
	await using database = await createTestDatabase()
	const handler = createAuthHandler({
		COOKIE_SECRET: 'test-cookie-secret',
		APP_DB: database.appDb,
	})
	const authRequest = createAuthRequest(
		{ email: 'secure@example.com', password: 'secret', mode: 'signup' },
		'https://example.com/auth',
		handler,
	)
	const response = await authRequest.run()
	const setCookie = response.headers.get('Set-Cookie') ?? ''
	expect(setCookie).toContain('Secure')
})
