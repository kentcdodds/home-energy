import { z } from 'zod'
import { createDb, sql } from './db.ts'

const applianceSchema = z.object({
	id: z.number(),
	owner_id: z.number(),
	name: z.string(),
	watts: z.number(),
	notes: z.string().nullable(),
	created_at: z.string(),
})

export type ApplianceRecord = z.infer<typeof applianceSchema>

type ApplianceInsert = {
	ownerId: number
	name: string
	watts: number
	notes?: string | null
}

type ApplianceUpdate = {
	id: number
	ownerId: number
	name: string
	watts: number
	notes?: string | null
}

type ApplianceLookup = {
	id: number
	ownerId: number
}

export type ApplianceStore = {
	create: (input: ApplianceInsert) => Promise<ApplianceRecord>
	getById: (input: ApplianceLookup) => Promise<ApplianceRecord | null>
	listByOwner: (ownerId: number) => Promise<Array<ApplianceRecord>>
	update: (input: ApplianceUpdate) => Promise<ApplianceRecord | null>
	remove: (input: ApplianceLookup) => Promise<void>
}

export function createApplianceStore(
	db: ReturnType<typeof createDb>,
): ApplianceStore {
	async function create(input: ApplianceInsert) {
		const notes = input.notes ?? null
		const record = await db.queryFirst(
			sql`
				INSERT INTO appliances (owner_id, name, watts, notes)
				VALUES (${input.ownerId}, ${input.name}, ${input.watts}, ${notes})
				RETURNING id, owner_id, name, watts, notes, created_at
			`,
			applianceSchema,
		)
		if (!record) {
			throw new Error('Failed to create appliance')
		}
		return record
	}

	function getById(input: ApplianceLookup) {
		return db.queryFirst(
			sql`
				SELECT id, owner_id, name, watts, notes, created_at
				FROM appliances
				WHERE id = ${input.id} AND owner_id = ${input.ownerId}
				LIMIT 1
			`,
			applianceSchema,
		)
	}

	function listByOwner(ownerId: number) {
		return db.queryAll(
			sql`
				SELECT id, owner_id, name, watts, notes, created_at
				FROM appliances
				WHERE owner_id = ${ownerId}
				ORDER BY created_at DESC, id DESC
			`,
			applianceSchema,
		)
	}

	function update(input: ApplianceUpdate) {
		const notes = input.notes ?? null
		const hasNotes = input.notes !== undefined
		return db.queryFirst(
			sql`
				UPDATE appliances
				SET name = ${input.name}, watts = ${input.watts}, notes = CASE
					WHEN ${hasNotes} THEN ${notes}
					ELSE notes
				END
				WHERE id = ${input.id} AND owner_id = ${input.ownerId}
				RETURNING id, owner_id, name, watts, notes, created_at
			`,
			applianceSchema,
		)
	}

	async function remove(input: ApplianceLookup) {
		await db.exec(
			sql`
				DELETE FROM appliances
				WHERE id = ${input.id} AND owner_id = ${input.ownerId}
			`,
		)
	}

	return { create, getById, listByOwner, update, remove }
}
