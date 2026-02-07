import { invariant } from '@epic-web/invariant'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { TokenSummary } from '@cloudflare/workers-oauth-provider'
import { McpAgent } from 'agents/mcp'
import { createDb, sql } from '../worker/db.ts'
import { userIdSchema } from '../worker/model-schemas.ts'
import { registerTools } from './tools.ts'

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

export type State = {}
export type Props = {
	baseUrl: string
	user?: TokenSummary['grant']['props']
}
export class MCP extends McpAgent<Env, State, Props> {
	server = new McpServer(
		{
			name: 'MCP',
			version: '1.0.0',
		},
		{
			instructions:
				'Use this server to manage appliance energy data for the authenticated user.',
		},
	)
	async init() {
		await registerTools(this)
	}
	requireDomain() {
		const baseUrl = this.props?.baseUrl
		invariant(
			baseUrl,
			'This should never happen, but somehow we did not get the baseUrl from the request handler',
		)
		return baseUrl
	}

	requireUser() {
		const user = this.props?.user
		invariant(
			user,
			'This should never happen, but somehow we did not get the user from the request handler',
		)
		return user
	}

	getDb() {
		return createDb(this.env.APP_DB)
	}

	async requireOwnerId() {
		const user = this.requireUser()
		invariant(
			user.email,
			'This should never happen, but somehow we did not get the user email from the request handler',
		)
		const db = this.getDb()
		const ownerId = await ensureUserId(db, normalizeEmail(user.email))
		invariant(
			ownerId,
			'This should never happen, but somehow we did not resolve the user id from the request handler',
		)
		return ownerId
	}
}
