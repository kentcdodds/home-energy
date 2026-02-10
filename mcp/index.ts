import { invariant } from '@epic-web/invariant'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { TokenSummary } from '@cloudflare/workers-oauth-provider'
import { McpAgent } from 'agents/mcp'
import { normalizeEmail } from '../server/normalize-email.ts'
import { createDb, sql } from '../worker/db.ts'
import { userIdSchema } from '../worker/model-schemas.ts'
import {
	simulationHubControlGetPath,
	simulationHubControlSetPath,
	simulationHubPublishPath,
} from '../worker/simulation-hub.ts'
import { registerTools } from './tools.ts'

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
export type ApplianceSimulationControl = {
	enabled: boolean
	hoursPerDay: number
	dutyCyclePercent: number
	startHour: number
	quantity: number
	overrideWatts: number | null
}
export type Props = {
	baseUrl: string
	user?: TokenSummary['grant']['props']
}

type SimulationHubBindingEnv = Env & {
	SIMULATION_HUB: DurableObjectNamespace
}

export class MCP extends McpAgent<Env, State, Props> {
	server = new McpServer(
		{
			name: 'MCP',
			version: '1.0.0',
		},
		{
			instructions:
				'Use this server to manage appliance energy data and run per-appliance simulation knobs for the authenticated user.',
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

	requireCookieSecret() {
		const secret = this.env.COOKIE_SECRET
		invariant(
			secret,
			'This should never happen, but somehow we did not get COOKIE_SECRET from the environment',
		)
		return secret
	}

	private getSimulationHub(ownerId: number) {
		const simulationEnv = this.env as SimulationHubBindingEnv
		const hubId = simulationEnv.SIMULATION_HUB.idFromName(`owner:${ownerId}`)
		return simulationEnv.SIMULATION_HUB.get(hubId)
	}

	private createSimulationHubRequest(pathname: string, init?: RequestInit) {
		const baseUrl = new URL(this.requireDomain())
		baseUrl.pathname = pathname
		baseUrl.search = ''
		return new Request(baseUrl.toString(), init)
	}

	private toSimulationControlsMap(value: unknown) {
		const controls = new Map<number, ApplianceSimulationControl>()
		if (!value || typeof value !== 'object') return controls
		for (const [idText, control] of Object.entries(
			value as Record<string, ApplianceSimulationControl>,
		)) {
			const id = Number(idText)
			if (!Number.isInteger(id) || id <= 0) continue
			if (!control || typeof control !== 'object') continue
			controls.set(id, control)
		}
		return controls
	}

	async getSimulationControls(ownerId: number) {
		const hub = this.getSimulationHub(ownerId)
		const response = await hub.fetch(
			this.createSimulationHubRequest(simulationHubControlGetPath),
		)
		if (!response.ok) {
			return new Map<number, ApplianceSimulationControl>()
		}
		const body = (await response.json().catch(() => null)) as {
			controls?: unknown
		} | null
		return this.toSimulationControlsMap(body?.controls)
	}

	async setSimulationControls(
		ownerId: number,
		controls: Map<number, ApplianceSimulationControl>,
	) {
		const hub = this.getSimulationHub(ownerId)
		const controlsRecord = Object.fromEntries(
			Array.from(controls.entries(), ([id, control]) => [String(id), control]),
		)
		await hub.fetch(
			this.createSimulationHubRequest(simulationHubControlSetPath, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ controls: controlsRecord }),
			}),
		)
	}

	async publishSimulationUpdate(ownerId: number, payload: unknown) {
		const hub = this.getSimulationHub(ownerId)
		await hub.fetch(
			this.createSimulationHubRequest(simulationHubPublishPath, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ payload }),
			}),
		)
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
