/// <reference types="bun" />
import { beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { RequestContext } from 'remix/fetch-router'
import { z } from 'zod'
import { createPasswordHash } from '../password-hash.ts'
import { setAuthSessionSecret } from '../auth-session.ts'
import { createAuthHandler } from './auth.ts'
import { createDb, sql } from '../../worker/db.ts'

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
	return record.id
}

function createAuthRequest(body: unknown, url: string, handler: ReturnType<typeof createAuthHandler>) {
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

beforeAll(() => {
	setAuthSessionSecret('test-cookie-secret-0123456789abcdef0123456789')
})

test('auth handler returns 400 for invalid JSON', async () => {
	await using database = await createTestDatabase()
	const appEnv = { COOKIE_SECRET: 'test-secret', APP_DB: database.appDb }
	const handler = createAuthHandler(appEnv)
	const authRequest = createAuthRequest('{', 'http://example.com/auth', handler)
	const response = await authRequest.run()
	expect(response.status).toBe(400)
	const payload = await response.json()
	expect(payload).toEqual({ error: 'Invalid JSON payload.' })
})

test('auth handler returns 400 for missing fields', async () => {
	await using database = await createTestDatabase()
	const appEnv = { COOKIE_SECRET: 'test-secret', APP_DB: database.appDb }
	const handler = createAuthHandler(appEnv)
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

test('auth handler creates accounts for signup', async () => {
	await using database = await createTestDatabase()
	const appEnv = { COOKIE_SECRET: 'test-secret', APP_DB: database.appDb }
	const handler = createAuthHandler(appEnv)
	const authRequest = createAuthRequest(
		{ email: 'new@example.com', password: 'secret', mode: 'signup' },
		'http://example.com/auth',
		handler,
	)
	const response = await authRequest.run()
	expect(response.status).toBe(200)
	const payload = await response.json()
	expect(payload).toEqual({ ok: true, mode: 'signup' })
	const db = createDb(database.appDb)
	const record = await db.queryFirst(
		sql`SELECT id FROM users WHERE email = ${'new@example.com'}`,
		z.object({ id: z.number() }),
	)
	expect(record).not.toBeNull()
})

test('auth handler returns ok with a session cookie for login', async () => {
	await using database = await createTestDatabase()
	const appEnv = { COOKIE_SECRET: 'test-secret', APP_DB: database.appDb }
	const handler = createAuthHandler(appEnv)
	const db = createDb(database.appDb)
	await createUser(db, 'a@b.com', 'secret')
	const authRequest = createAuthRequest(
		{ email: 'a@b.com', password: 'secret', mode: 'login' },
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

test('auth handler sets Secure cookie over https', async () => {
	await using database = await createTestDatabase()
	const appEnv = { COOKIE_SECRET: 'test-secret', APP_DB: database.appDb }
	const handler = createAuthHandler(appEnv)
	const db = createDb(database.appDb)
	await createUser(db, 'secure@example.com', 'secret')
	const authRequest = createAuthRequest(
		{ email: 'secure@example.com', password: 'secret', mode: 'login' },
		'https://example.com/auth',
		handler,
	)
	const response = await authRequest.run()
	const setCookie = response.headers.get('Set-Cookie') ?? ''
	expect(setCookie).toContain('Secure')
})
