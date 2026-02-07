import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { z } from 'zod'
import { createAuthCookie, setAuthSessionSecret } from '../auth-session.ts'
import { createAppliancesHandlers } from './appliances.ts'
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
	const applianceMigration = await Bun.file(
		join(projectRoot, 'migrations', '0002-appliances.sql'),
	).text()
	await runMigration(appDb, userMigration)
	await runMigration(appDb, applianceMigration)

	return {
		appDb,
		[Symbol.asyncDispose]: async () => {
			await miniflare.dispose()
			await rm(persistDir, { recursive: true, force: true })
		},
	}
}

async function createUser(db: ReturnType<typeof createDb>, email: string) {
	const username = email.split('@')[0] ?? `user-${crypto.randomUUID()}`
	const passwordHash = `hash-${crypto.randomUUID()}`
	const row = await db.queryFirst(
		sql`
			INSERT INTO users (username, email, password_hash)
			VALUES (${username}, ${email}, ${passwordHash})
			RETURNING id
		`,
		z.object({ id: z.number() }),
	)
	if (!row) {
		throw new Error('Failed to create user')
	}
	return row.id
}

async function createSessionCookie(email: string) {
	setAuthSessionSecret('test-secret')
	return createAuthCookie({ id: crypto.randomUUID(), email }, false)
}

function buildRequest(
	path: string,
	options: {
		method?: string
		headers?: Record<string, string>
		body?: BodyInit | null
	},
) {
	return new Request(`https://example.com${path}`, {
		method: options.method ?? 'GET',
		headers: options.headers,
		body: options.body,
	})
}

test('validation requires name', async () => {
	await using database = await createTestDatabase()
	const appEnv = { COOKIE_SECRET: 'test-secret', APP_DB: database.appDb }
	const handlers = createAppliancesHandlers(appEnv)
	const db = createDb(database.appDb)
	const email = 'user@example.com'
	await createUser(db, email)
	const cookie = await createSessionCookie(email)

	const body = new URLSearchParams({ intent: 'create', watts: '1200' })
	const request = buildRequest('/appliances', {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			Cookie: cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body,
	})
	const response = await handlers.action.action({ request } as never)
	expect(response.status).toBe(400)
	const payload = await response.json()
	expect(payload).toEqual({ ok: false, error: 'Name is required.' })
})

test('validation requires watts or amps+volts', async () => {
	await using database = await createTestDatabase()
	const appEnv = { COOKIE_SECRET: 'test-secret', APP_DB: database.appDb }
	const handlers = createAppliancesHandlers(appEnv)
	const db = createDb(database.appDb)
	const email = 'user@example.com'
	await createUser(db, email)
	const cookie = await createSessionCookie(email)

	const body = new URLSearchParams({ intent: 'create', name: 'Lamp' })
	const request = buildRequest('/appliances', {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			Cookie: cookie,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body,
	})
	const response = await handlers.action.action({ request } as never)
	expect(response.status).toBe(400)
	const payload = await response.json()
	expect(payload).toEqual({
		ok: false,
		error: 'Provide watts or amps and volts.',
	})
})

test('create and delete appliances updates totals and sorting', async () => {
	await using database = await createTestDatabase()
	const appEnv = { COOKIE_SECRET: 'test-secret', APP_DB: database.appDb }
	const handlers = createAppliancesHandlers(appEnv)
	const db = createDb(database.appDb)
	const email = 'user@example.com'
	await createUser(db, email)
	const cookie = await createSessionCookie(email)

	function createRequest(data: Record<string, string>) {
		return buildRequest('/appliances', {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Cookie: cookie,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams(data),
		})
	}

	const firstResponse = await handlers.action.action({
		request: createRequest({
			intent: 'create',
			name: 'Toaster',
			amps: '5',
			volts: '120',
		}),
	} as never)
	expect(firstResponse.status).toBe(200)

	const secondResponse = await handlers.action.action({
		request: createRequest({
			intent: 'create',
			name: 'Microwave',
			watts: '1200',
		}),
	} as never)
	expect(secondResponse.status).toBe(200)

	const listResponse = await handlers.index.action({
		request: buildRequest('/appliances', {
			headers: { Accept: 'application/json', Cookie: cookie },
		}),
	} as never)
	const listPayload = await listResponse.json()
	expect(listPayload.totalWatts).toBe(1800)
	expect(
		listPayload.appliances.map((item: { name: string }) => item.name),
	).toEqual(['Microwave', 'Toaster'])

	const deleteResponse = await handlers.action.action({
		request: createRequest({
			intent: 'delete',
			id: String(listPayload.appliances[0].id),
		}),
	} as never)
	expect(deleteResponse.status).toBe(200)
	const deletePayload = await deleteResponse.json()
	expect(deletePayload.totalWatts).toBe(600)
	expect(deletePayload.appliances).toHaveLength(1)
	expect(deletePayload.appliances[0].name).toBe('Toaster')
})
