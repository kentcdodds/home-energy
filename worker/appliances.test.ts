import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { z } from 'zod'
import { createApplianceStore } from './appliances.ts'
import { createDb, sql } from './db.ts'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
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

async function createUser(db: ReturnType<typeof createDb>) {
	const username = `user-${crypto.randomUUID()}`
	const email = `${username}@example.com`
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

test('appliance helpers create, list, update, and delete', async () => {
	await using database = await createTestDatabase()
	const db = createDb(database.appDb)
	const store = createApplianceStore(db)

	const ownerId = await createUser(db)
	const otherOwnerId = await createUser(db)

	const first = await store.create({
		ownerId,
		name: 'Toaster',
		watts: 800,
	})
	const second = await store.create({
		ownerId,
		name: 'Microwave',
		watts: 1200,
	})
	await store.create({
		ownerId: otherOwnerId,
		name: 'Fan',
		watts: 60,
	})

	const list = await store.listByOwner(ownerId)
	expect(list).toHaveLength(2)
	expect(list.every((item) => item.owner_id === ownerId)).toBe(true)
	expect(list.map((item) => item.id)).toContain(first.id)
	expect(list.map((item) => item.id)).toContain(second.id)

	const fetched = await store.getById({ id: first.id, ownerId })
	expect(fetched?.watts).toBe(800)

	const updated = await store.update({
		id: first.id,
		ownerId,
		name: 'Toaster XL',
		watts: 900,
	})
	expect(updated?.watts).toBe(900)

	await store.remove({ id: first.id, ownerId })
	const afterDelete = await store.getById({ id: first.id, ownerId })
	expect(afterDelete).toBeNull()
})
