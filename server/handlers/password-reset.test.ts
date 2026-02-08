/// <reference types="bun" />
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import getPort from 'get-port'
import { Miniflare } from 'miniflare'
import { RequestContext } from 'remix/fetch-router'
import { z } from 'zod'
import {
	createMockApiServer,
	createResendMockRoutes,
	readMockApiRequests,
	resendEmailPayloadSchema,
} from '../../tools/mock-api.ts'
import { createPasswordHash, verifyPassword } from '../password-hash.ts'
import { createPasswordResetHandlers } from './password-reset.ts'
import { createDb, sql } from '../../worker/db.ts'
import { userPasswordSchema } from '../../worker/model-schemas.ts'
import type { AppEnv } from '../../types/env-schema.ts'

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
	const resetMigration = await Bun.file(
		join(projectRoot, 'migrations', '0004-password-reset-tokens.sql'),
	).text()
	await runMigration(appDb, userMigration)
	await runMigration(appDb, resetMigration)

	return {
		appDb,
		[Symbol.asyncDispose]: async () => {
			await miniflare.dispose()
			await rm(persistDir, { recursive: true, force: true })
		},
	}
}

async function createMockServer() {
	const storageDir = await mkdtemp(join(tmpdir(), 'epicflare-mock-api-'))
	const port = await getPort()
	const server = await createMockApiServer({
		port,
		storageDir,
		routes: createResendMockRoutes(),
	})

	return {
		...server,
		[Symbol.asyncDispose]: async () => {
			server.close()
			await rm(storageDir, { recursive: true, force: true })
		},
	}
}

async function createUser(
	db: ReturnType<typeof createDb>,
	email: string,
	password: string,
) {
	const passwordHash = await createPasswordHash(password)
	await db.exec(
		sql`
			INSERT INTO users (username, email, password_hash)
			VALUES (${email}, ${email}, ${passwordHash})
		`,
	)
}

function createResetRequest(
	url: string,
	body: unknown,
	handler: ReturnType<typeof createPasswordResetHandlers>['request'],
) {
	const request = new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	const context = new RequestContext(request)
	return handler.action(context)
}

function createConfirmRequest(
	url: string,
	body: unknown,
	handler: ReturnType<typeof createPasswordResetHandlers>['confirm'],
) {
	const request = new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	const context = new RequestContext(request)
	return handler.action(context)
}

test('password reset request sends email and updates password', async () => {
	await using database = await createTestDatabase()
	await using mockServer = await createMockServer()
	const db = createDb(database.appDb)
	const email = 'reset@example.com'
	await createUser(db, email, 'old-password')

	const appEnv = {
		COOKIE_SECRET: 'test-cookie-secret-0123456789abcdef0123456789',
		APP_DB: database.appDb,
		RESEND_API_BASE_URL: mockServer.baseUrl,
		RESEND_API_KEY: 'test-resend-key',
		RESEND_FROM_EMAIL: 'no-reply@epicflare.dev',
		CLOUDFLARE_ENV: 'test',
	} satisfies AppEnv
	const handlers = createPasswordResetHandlers(appEnv)

	const response = await createResetRequest(
		'http://example.com/password-reset',
		{ email },
		handlers.request,
	)
	expect(response.status).toBe(200)
	const payload = await response.json()
	expect(payload).toEqual({ ok: true })

	const requests = await readMockApiRequests(mockServer.storageDir)
	const resendRequest = requests.find(
		(record) => record.routeId === 'resend.send-email',
	)
	expect(resendRequest).not.toBeNull()
	if (!resendRequest) {
		throw new Error('Expected resend request to be recorded.')
	}
	const emailPayload = resendEmailPayloadSchema.parse(
		JSON.parse(resendRequest.body ?? '{}'),
	)
	const toList = Array.isArray(emailPayload.to)
		? emailPayload.to
		: [emailPayload.to]
	expect(toList).toEqual([email])
	expect(emailPayload.subject).toContain('Reset')
	expect(emailPayload.html).toContain('/password-reset?token=')

	const tokenMatch = emailPayload.html.match(/token=([a-f0-9]+)/)
	const token = tokenMatch?.[1]
	expect(token).toBeTruthy()
	if (!token) {
		throw new Error('Expected token in reset email.')
	}

	const confirmResponse = await createConfirmRequest(
		'http://example.com/password-reset/confirm',
		{ token, password: 'new-password' },
		handlers.confirm,
	)
	expect(confirmResponse.status).toBe(200)
	const confirmPayload = await confirmResponse.json()
	expect(confirmPayload).toEqual({ ok: true })

	const updated = await db.queryFirst(
		sql`SELECT password_hash FROM users WHERE email = ${email}`,
		userPasswordSchema,
	)
	expect(updated).not.toBeNull()
	if (!updated) {
		throw new Error('Expected updated user password.')
	}
	const verifyResult = await verifyPassword(
		'new-password',
		updated.password_hash,
	)
	expect(verifyResult.valid).toBe(true)

	const tokenRows = await db.queryAll(
		sql`
			SELECT password_reset_tokens.used_at
			FROM password_reset_tokens
			JOIN users ON users.id = password_reset_tokens.user_id
			WHERE users.email = ${email}
		`,
		z.object({ used_at: z.string().nullable() }),
	)
	expect(tokenRows.some((row) => row.used_at)).toBe(true)
})
