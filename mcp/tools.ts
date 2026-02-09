import { z } from 'zod'
import {
	registerAppResource,
	registerAppTool,
	RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { createApplianceStore } from '../worker/appliances.ts'
import { applianceSummarySchema } from '../worker/model-schemas.ts'
import { type MCP } from './index.ts'

type ApplianceSummary = z.infer<typeof applianceSummarySchema>
type ApplianceAppSeed = Pick<
	ApplianceSummary,
	'id' | 'name' | 'watts' | 'notes'
>
type OpenApplianceEnergyAppPayload = {
	ok: true
	appliances: Array<ApplianceAppSeed>
	applianceCount: number
	generatedAt: string
}

type ApplianceInput = {
	name: string
	watts?: number
	amps?: number
	volts?: number
	notes?: string
}

type ApplianceEditInput = {
	id: number
	name?: string
	watts?: number
	amps?: number
	volts?: number
	notes?: string | null
}

const applianceInputSchema = z
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
		{
			message: 'Provide watts or amps and volts.',
		},
	)

const applianceEditSchema = z
	.object({
		id: z.number().int().positive(),
		name: z.string().min(1, 'Name is required.').optional(),
		watts: z.number().positive().optional(),
		amps: z.number().positive().optional(),
		volts: z.number().positive().optional(),
		notes: z
			.string()
			.max(500, 'Notes must be 500 characters or fewer.')
			.nullable()
			.optional(),
	})
	.superRefine((data, context) => {
		const hasPowerInput =
			data.watts != null || data.amps != null || data.volts != null
		const hasUpdates =
			data.name != null || data.notes !== undefined || hasPowerInput
		if (!hasUpdates) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Provide at least one field to update.',
			})
		}
		if (hasPowerInput && data.watts == null) {
			if (data.amps == null || data.volts == null) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: 'Provide watts or amps and volts.',
				})
			}
		}
	})

function sortAppliances(list: Array<ApplianceSummary>) {
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

function formatWatts(watts: number) {
	return `${Math.round(watts)}W`
}

function toSummary(record: ApplianceSummary) {
	return {
		id: record.id,
		name: record.name,
		watts: record.watts,
		notes: record.notes,
		created_at: record.created_at,
	}
}

type AppliancePowerInput = {
	watts?: number
	amps?: number
	volts?: number
}

function resolveWatts(input: AppliancePowerInput) {
	return input.watts ?? input.amps! * input.volts!
}

function resolveOptionalWatts(input: AppliancePowerInput) {
	if (input.watts != null) return input.watts
	if (input.amps != null && input.volts != null) {
		return input.amps * input.volts
	}
	return undefined
}

function resolveNotes(input: ApplianceInput) {
	const normalized = input.notes?.trim()
	return normalized ? normalized : null
}

function resolveOptionalNotes(input: ApplianceEditInput) {
	if (input.notes === undefined) return undefined
	if (input.notes === null) return null
	const normalized = input.notes.trim()
	return normalized ? normalized : null
}

function createStore(agent: MCP) {
	return createApplianceStore(agent.getDb())
}

function createApplianceAppHtml(origin: string, assetVersion: string) {
	const base = new URL(origin)
	const appScriptUrl = new URL('/mcp-appliance-app.js', base)
	const stylesUrl = new URL('/styles.css', base)
	appScriptUrl.searchParams.set('v', assetVersion)
	stylesUrl.searchParams.set('v', assetVersion)
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Appliance Energy Simulator</title>
		<link rel="stylesheet" href="${stylesUrl.toString()}" />
		<style>
			html, body, #root {
				width: 100%;
				height: 100%;
				margin: 0;
				padding: 0;
			}
			body {
				font-family: var(--font-family), system-ui, sans-serif;
				background: var(--color-background);
				color: var(--color-text);
			}
		</style>
	</head>
	<body>
		<div id="root"></div>
		<script src="${appScriptUrl.toString()}"></script>
	</body>
</html>`
}

/**
 * Domains to declare for MCPJam App Builder CSP (strict mode).
 * Includes both localhost and 127.0.0.1 for the same port in local dev
 * so script/style loads work regardless of which host the client used to connect.
 */
function getCspDomains(origin: string): string[] {
	const url = new URL(origin)
	const port = url.port || (url.protocol === 'https:' ? '443' : '80')
	const origins = [origin]
	if (url.hostname === 'localhost') {
		origins.push(`http://127.0.0.1:${port}`)
	} else if (url.hostname === '127.0.0.1') {
		origins.push(`http://localhost:${port}`)
	}
	return [...new Set(origins)]
}

function toApplianceAppSeed(appliance: ApplianceSummary): ApplianceAppSeed {
	return {
		id: appliance.id,
		name: appliance.name,
		watts: appliance.watts,
		notes: appliance.notes,
	}
}

export async function registerTools(agent: MCP) {
	agent.server.registerTool(
		'list_appliances',
		{
			description: 'List appliances (including notes) and return total watts.',
			inputSchema: {},
			annotations: { readOnlyHint: true },
		},
		async () => {
			const ownerId = await agent.requireOwnerId()
			const store = createStore(agent)
			const list = await store.listByOwner(ownerId)
			const summary = summarizeAppliances(list.map(toSummary))
			const payload = { ok: true, ...summary }
			return {
				content: [
					{
						type: 'text',
						text: `Found ${summary.appliances.length} appliances totaling ${formatWatts(
							summary.totalWatts,
						)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		},
	)

	agent.server.registerTool(
		'get_total_watts',
		{
			description: 'Get the total watts for the current appliance list.',
			inputSchema: {},
			annotations: { readOnlyHint: true },
		},
		async () => {
			const ownerId = await agent.requireOwnerId()
			const store = createStore(agent)
			const list = await store.listByOwner(ownerId)
			const summary = summarizeAppliances(list.map(toSummary))
			const payload = {
				ok: true,
				totalWatts: summary.totalWatts,
				applianceCount: summary.appliances.length,
			}
			return {
				content: [
					{
						type: 'text',
						text: `Total appliance usage is ${formatWatts(summary.totalWatts)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		},
	)

	agent.server.registerTool(
		'add_appliances',
		{
			description: 'Add appliances with optional notes and return totals.',
			inputSchema: {
				appliances: z.array(applianceInputSchema).min(1),
			},
			annotations: { destructiveHint: true, idempotentHint: false },
		},
		async ({ appliances }: { appliances: Array<ApplianceInput> }) => {
			const ownerId = await agent.requireOwnerId()
			const store = createStore(agent)
			const created = await Promise.all(
				appliances.map(async (appliance) => {
					const watts = resolveWatts(appliance)
					const notes = resolveNotes(appliance)
					return store.create({
						ownerId,
						name: appliance.name,
						watts,
						notes,
					})
				}),
			)
			const list = await store.listByOwner(ownerId)
			const summary = summarizeAppliances(list.map(toSummary))
			const payload = {
				ok: true,
				added: created.map(toSummary),
				...summary,
			}
			return {
				content: [
					{
						type: 'text',
						text: `Added ${created.length} appliance(s); total is ${formatWatts(
							summary.totalWatts,
						)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		},
	)

	agent.server.registerTool(
		'edit_appliances',
		{
			description:
				'Edit appliances by id (omit fields to keep existing values) and return the updated list and total watts.',
			inputSchema: {
				updates: z.array(applianceEditSchema).min(1),
			},
			annotations: { destructiveHint: true, idempotentHint: true },
		},
		async ({ updates }: { updates: Array<ApplianceEditInput> }) => {
			const ownerId = await agent.requireOwnerId()
			const store = createStore(agent)
			const updated: Array<ApplianceSummary> = []
			const missingIds: Array<number> = []

			for (const update of updates) {
				const existing = await store.getById({
					id: update.id,
					ownerId,
				})
				if (!existing) {
					missingIds.push(update.id)
					continue
				}
				const watts = resolveOptionalWatts(update) ?? existing.watts
				const notes = resolveOptionalNotes(update)
				const record = await store.update({
					id: update.id,
					ownerId,
					name: update.name ?? existing.name,
					watts,
					notes,
				})
				if (record) {
					updated.push(toSummary(record))
				} else {
					missingIds.push(update.id)
				}
			}

			const list = await store.listByOwner(ownerId)
			const summary = summarizeAppliances(list.map(toSummary))
			const payload = {
				ok: true,
				updated,
				missingIds,
				...summary,
			}
			const missingText = missingIds.length
				? ` ${missingIds.length} missing.`
				: ''
			return {
				content: [
					{
						type: 'text',
						text: `Updated ${updated.length} appliance(s).${missingText} Total is ${formatWatts(
							summary.totalWatts,
						)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		},
	)

	agent.server.registerTool(
		'delete_appliances',
		{
			description: 'Delete appliances by id and return the updated list.',
			inputSchema: {
				ids: z.array(z.number().int().positive()).min(1),
			},
			annotations: { destructiveHint: true, idempotentHint: true },
		},
		async ({ ids }: { ids: Array<number> }) => {
			const ownerId = await agent.requireOwnerId()
			const store = createStore(agent)
			for (const id of ids) {
				await store.remove({ id, ownerId })
			}
			const list = await store.listByOwner(ownerId)
			const summary = summarizeAppliances(list.map(toSummary))
			const payload = { ok: true, deletedIds: ids, ...summary }
			return {
				content: [
					{
						type: 'text',
						text: `Deleted ${ids.length} appliance(s); total is ${formatWatts(
							summary.totalWatts,
						)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		},
	)

	const applianceAppResourceUri = 'ui://home-energy/appliance-simulator'

	registerAppTool(
		agent.server,
		'open_appliance_energy_app',
		{
			title: 'Open Appliance Energy App',
			description:
				'Open the interactive appliance energy app with local per-appliance controls and load chart.',
			inputSchema: {},
			annotations: { readOnlyHint: true },
			_meta: { ui: { resourceUri: applianceAppResourceUri } },
		},
		async () => {
			const ownerId = await agent.requireOwnerId()
			const store = createStore(agent)
			const list = await store.listByOwner(ownerId)
			const summary = summarizeAppliances(list.map(toSummary))
			const payload: OpenApplianceEnergyAppPayload = {
				ok: true,
				appliances: summary.appliances.map(toApplianceAppSeed),
				applianceCount: summary.appliances.length,
				generatedAt: new Date().toISOString(),
			}
			return {
				content: [
					{
						type: 'text',
						text: `Opened appliance energy app with ${summary.appliances.length} appliance(s).`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		},
	)

	registerAppResource(
		agent.server,
		'appliance_energy_app_ui',
		applianceAppResourceUri,
		{
			mimeType: RESOURCE_MIME_TYPE,
			description: 'Interactive appliance energy simulator app.',
		},
		async () => {
			const baseUrl = agent.requireDomain()
			const origin = new URL(baseUrl).origin
			const cspDomains = getCspDomains(origin)
			const assetVersion = `${Date.now().toString(36)}-${crypto.randomUUID()}`
			return {
				contents: [
					{
						uri: applianceAppResourceUri,
						mimeType: RESOURCE_MIME_TYPE,
						text: createApplianceAppHtml(origin, assetVersion),
						_meta: {
							ui: {
								csp: {
									resourceDomains: cspDomains,
									connectDomains: cspDomains,
								},
								prefersBorder: true,
							},
						},
					},
				],
			}
		},
	)
}
