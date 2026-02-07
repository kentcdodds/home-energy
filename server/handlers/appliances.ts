import { type BuildAction } from 'remix/fetch-router'
import { Layout } from '../layout.ts'
import { render } from '../render.ts'
import { z } from 'zod'
import { readAuthSession } from '../auth-session.ts'
import type routes from '../routes.ts'
import { createApplianceStore } from '../../worker/appliances.ts'
import { createDb, sql } from '../../worker/db.ts'
import {
	applianceSummarySchema,
	userIdSchema,
} from '../../worker/model-schemas.ts'
import type { AppEnv } from '../../types/env-schema.ts'

type ApplianceSummary = z.infer<typeof applianceSummarySchema>
type ApplianceListResponse = {
	appliances: Array<ApplianceSummary>
	totalWatts: number
}

const createSchema = z
	.object({
		name: z.string().min(1, 'Name is required.'),
		watts: z.number().positive().optional(),
		amps: z.number().positive().optional(),
		volts: z.number().positive().optional(),
		notes: z
			.string()
			.max(500, 'Notes must be 500 characters or fewer.')
			.optional(),
	})
	.refine(
		(data) => data.watts != null || (data.amps != null && data.volts != null),
		{ message: 'Provide watts or amps and volts.' },
	)

const updateSchema = z
	.object({
		id: z.number().int().positive(),
		name: z.string().min(1, 'Name is required.'),
		watts: z.number().positive().optional(),
		amps: z.number().positive().optional(),
		volts: z.number().positive().optional(),
		notes: z
			.string()
			.max(500, 'Notes must be 500 characters or fewer.')
			.nullable()
			.optional(),
	})
	.refine(
		(data) => data.watts != null || (data.amps != null && data.volts != null),
		{ message: 'Provide watts or amps and volts.' },
	)

const deleteSchema = z.object({
	id: z.number().int().positive(),
})

function jsonResponse(data: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			'Content-Type': 'application/json',
			...init?.headers,
		},
	})
}

function wantsJson(request: Request) {
	return request.headers.get('Accept')?.includes('application/json') ?? false
}

function buildLoginRedirect(request: Request) {
	const url = new URL(request.url)
	const redirectTo = `${url.pathname}${url.search}`
	const loginUrl = new URL('/login', url)
	loginUrl.searchParams.set('redirectTo', redirectTo)
	return loginUrl
}

function unauthorizedResponse(request: Request) {
	return wantsJson(request)
		? jsonResponse({ ok: false, error: 'Unauthorized' }, { status: 401 })
		: Response.redirect(buildLoginRedirect(request), 302)
}

function parseNumber(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return undefined
	const normalized = value.trim()
	if (!normalized) return undefined
	const numberValue = Number(normalized)
	return Number.isFinite(numberValue) ? numberValue : undefined
}

function parseOptionalText(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return undefined
	const normalized = value.trim()
	return normalized ? normalized : undefined
}

function parseOptionalNotes(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') return undefined
	const normalized = value.trim()
	return normalized ? normalized : null
}

function normalizeEmail(email: string) {
	return email.trim().toLowerCase()
}

async function resolveUserId(db: ReturnType<typeof createDb>, email: string) {
	const record = await db.queryFirst(
		sql`SELECT id FROM users WHERE email = ${email}`,
		userIdSchema,
	)
	return record?.id ?? null
}

async function ensureUserId(db: ReturnType<typeof createDb>, email: string) {
	const existing = await resolveUserId(db, email)
	if (existing) return existing

	const username = email || `user-${crypto.randomUUID()}`
	const passwordHash = `hash-${crypto.randomUUID()}`
	const record = await db.queryFirst(
		sql`
			INSERT INTO users (username, email, password_hash)
			VALUES (${username}, ${email}, ${passwordHash})
			RETURNING id
		`,
		userIdSchema,
	)
	return record?.id ?? null
}

function sortAppliances(list: ApplianceListResponse['appliances']) {
	return [...list].sort((left, right) => {
		if (left.watts !== right.watts) {
			return right.watts - left.watts
		}
		const nameComparison = left.name.localeCompare(right.name)
		if (nameComparison !== 0) return nameComparison
		return left.id - right.id
	})
}

function summarizeAppliances(list: Array<ApplianceSummary>) {
	const sorted = sortAppliances(list)
	const totalWatts = sorted.reduce((total, item) => total + item.watts, 0)
	return { appliances: sorted, totalWatts }
}

async function requireOwnerId(
	request: Request,
	db: ReturnType<typeof createDb>,
): Promise<number | Response> {
	const session = await readAuthSession(request)
	if (!session) {
		return unauthorizedResponse(request)
	}

	const userId = await ensureUserId(db, normalizeEmail(session.email))
	if (!userId) {
		return unauthorizedResponse(request)
	}

	return userId
}

function toValidationError(error: z.ZodError) {
	return error.issues[0]?.message ?? 'Invalid input.'
}

export function createAppliancesHandlers(appEnv: AppEnv) {
	const db = createDb(appEnv.APP_DB)
	const store = createApplianceStore(db)

	const index = {
		middleware: [],
		async action({ request }) {
			const ownerId = await requireOwnerId(request, db)
			if (ownerId instanceof Response) return ownerId

			if (!wantsJson(request)) {
				return render(Layout({ title: 'Appliances' }))
			}

			const list = await store.listByOwner(ownerId)
			const summary = summarizeAppliances(list)
			return jsonResponse({ ok: true, ...summary })
		},
	} satisfies BuildAction<
		typeof routes.appliances.index.method,
		typeof routes.appliances.index.pattern
	>

	const action = {
		middleware: [],
		async action({ request }) {
			const ownerId = await requireOwnerId(request, db)
			if (ownerId instanceof Response) return ownerId

			let formData: FormData
			try {
				formData = await request.formData()
			} catch {
				return jsonResponse(
					{ ok: false, error: 'Invalid form data.' },
					{ status: 400 },
				)
			}

			const intent = String(formData.get('intent') ?? '').trim()

			if (intent === 'create') {
				const payload = {
					name: String(formData.get('name') ?? '').trim(),
					watts: parseNumber(formData.get('watts')),
					amps: parseNumber(formData.get('amps')),
					volts: parseNumber(formData.get('volts')),
					notes: parseOptionalText(formData.get('notes')),
				}
				const result = createSchema.safeParse(payload)
				if (!result.success) {
					return jsonResponse(
						{ ok: false, error: toValidationError(result.error) },
						{ status: 400 },
					)
				}

				const watts =
					result.data.watts ?? result.data.amps! * result.data.volts!
				const notes = result.data.notes ?? null
				await store.create({
					ownerId,
					name: result.data.name,
					watts,
					notes,
				})
			} else if (intent === 'update') {
				const payload = {
					id: parseNumber(formData.get('id')),
					name: String(formData.get('name') ?? '').trim(),
					watts: parseNumber(formData.get('watts')),
					amps: parseNumber(formData.get('amps')),
					volts: parseNumber(formData.get('volts')),
					notes: parseOptionalNotes(formData.get('notes')),
				}
				const result = updateSchema.safeParse(payload)
				if (!result.success) {
					return jsonResponse(
						{ ok: false, error: toValidationError(result.error) },
						{ status: 400 },
					)
				}

				const watts =
					result.data.watts ?? result.data.amps! * result.data.volts!
				const updated = await store.update({
					id: result.data.id,
					ownerId,
					name: result.data.name,
					watts,
					notes: result.data.notes,
				})
				if (!updated) {
					return jsonResponse(
						{ ok: false, error: 'Appliance not found.' },
						{ status: 404 },
					)
				}
			} else if (intent === 'delete') {
				const payload = { id: parseNumber(formData.get('id')) }
				const result = deleteSchema.safeParse(payload)
				if (!result.success) {
					return jsonResponse(
						{ ok: false, error: toValidationError(result.error) },
						{ status: 400 },
					)
				}

				await store.remove({ id: result.data.id, ownerId })
			} else {
				return jsonResponse(
					{ ok: false, error: 'Invalid intent.' },
					{ status: 400 },
				)
			}

			const list = await store.listByOwner(ownerId)
			const summary = summarizeAppliances(list)
			return jsonResponse({ ok: true, ...summary })
		},
	} satisfies BuildAction<
		typeof routes.appliances.action.method,
		typeof routes.appliances.action.pattern
	>

	return { index, action }
}
