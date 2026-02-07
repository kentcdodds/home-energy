import { z } from 'zod'
import { createApplianceStore } from '../worker/appliances.ts'
import { type MCP } from './index.ts'

type ApplianceSummary = {
	id: number
	name: string
	watts: number
	created_at: string
}

type ApplianceInput = {
	name: string
	watts?: number
	amps?: number
	volts?: number
}

const applianceInputSchema = z
	.object({
		name: z.string().min(1, 'Name is required.'),
		watts: z.number().positive().optional(),
		amps: z.number().positive().optional(),
		volts: z.number().positive().optional(),
	})
	.refine(
		(data) => data.watts != null || (data.amps != null && data.volts != null),
		{
			message: 'Provide watts or amps and volts.',
		},
	)

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
		created_at: record.created_at,
	}
}

function resolveWatts(input: ApplianceInput) {
	return input.watts ?? input.amps! * input.volts!
}

function createStore(agent: MCP) {
	return createApplianceStore(agent.getDb())
}

export async function registerTools(agent: MCP) {
	const server = await agent.server
	if (!('registerTool' in server)) {
		throw new Error('MCP server does not support tool registration.')
	}

	server.registerTool(
		'list_appliances',
		{
			description: 'List appliances and return the total watts.',
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

	server.registerTool(
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

	server.registerTool(
		'add_appliances',
		{
			description:
				'Add appliances and return the updated list and total watts.',
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
					return store.create({
						ownerId,
						name: appliance.name,
						watts,
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

	server.registerTool(
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
}
