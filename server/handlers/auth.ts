import { type BuildAction } from 'remix/fetch-router'
import { z } from 'zod'
import { createAuthCookie } from '../auth-session.ts'
import { createPasswordHash, verifyPassword } from '../password-hash.ts'
import type routes from '../routes.ts'
import type { AppEnv } from '../../types/env-schema.ts'
import { createDb, sql } from '../../worker/db.ts'

type AuthMode = 'login' | 'signup'

const userRecordSchema = z.object({
	id: z.number(),
	password_hash: z.string(),
})

const userIdSchema = z.object({
	id: z.number(),
})

function isAuthMode(value: string): value is AuthMode {
	return value === 'login' || value === 'signup'
}

function jsonResponse(data: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			'Content-Type': 'application/json',
			...init?.headers,
		},
	})
}

function normalizeEmail(value: string) {
	return value.trim().toLowerCase()
}

async function createUser(
	db: ReturnType<typeof createDb>,
	email: string,
	password: string,
) {
	const existing = await db.queryFirst(
		sql`SELECT id FROM users WHERE email = ${email}`,
		userIdSchema,
	)
	if (existing) {
		return { error: 'Email already in use.', status: 409 }
	}
	const passwordHash = await createPasswordHash(password)
	const username = email
	const record = await db.queryFirst(
		sql`
			INSERT INTO users (username, email, password_hash)
			VALUES (${username}, ${email}, ${passwordHash})
			RETURNING id
		`,
		userIdSchema,
	)
	if (!record) {
		return { error: 'Unable to create account.', status: 500 }
	}
	return { id: record.id }
}

async function loginUser(
	db: ReturnType<typeof createDb>,
	email: string,
	password: string,
) {
	const userRecord = await db.queryFirst(
		sql`SELECT id, password_hash FROM users WHERE email = ${email}`,
		userRecordSchema,
	)
	const passwordCheck = userRecord
		? await verifyPassword(password, userRecord.password_hash)
		: null

	if (!userRecord || !passwordCheck?.valid) {
		return { error: 'Invalid email or password.', status: 401 }
	}

	if (passwordCheck.upgradedHash) {
		try {
			await db.exec(
				sql`UPDATE users SET password_hash = ${passwordCheck.upgradedHash} WHERE email = ${email}`,
			)
		} catch {
			// Ignore upgrade failures so valid logins still succeed.
		}
	}

	return { id: userRecord.id }
}

export function createAuthHandler(appEnv: AppEnv) {
	const db = createDb(appEnv.APP_DB)

	return {
		middleware: [],
		async action({ request, url }) {
			let body: unknown

			try {
				body = await request.json()
			} catch {
				return jsonResponse({ error: 'Invalid JSON payload.' }, { status: 400 })
			}

			if (!body || typeof body !== 'object') {
				return jsonResponse({ error: 'Invalid request body.' }, { status: 400 })
			}

			const { email, password, mode } = body as Record<string, unknown>
			const normalizedEmail =
				typeof email === 'string' ? normalizeEmail(email) : ''
			const normalizedPassword = typeof password === 'string' ? password : ''
			const normalizedMode =
				typeof mode === 'string' && isAuthMode(mode) ? mode : null

			if (!normalizedEmail || !normalizedPassword || !normalizedMode) {
				return jsonResponse(
					{ error: 'Email, password, and mode are required.' },
					{ status: 400 },
				)
			}

			const result =
				normalizedMode === 'signup'
					? await createUser(db, normalizedEmail, normalizedPassword)
					: await loginUser(db, normalizedEmail, normalizedPassword)

			if ('error' in result) {
				return jsonResponse({ error: result.error }, { status: result.status })
			}

			const cookie = await createAuthCookie(
				{
					id: String(result.id),
					email: normalizedEmail,
				},
				url.protocol === 'https:',
			)

			return jsonResponse(
				{ ok: true, mode: normalizedMode },
				{
					headers: {
						'Set-Cookie': cookie,
					},
				},
			)
		},
	} satisfies BuildAction<typeof routes.auth.method, typeof routes.auth.pattern>
}
