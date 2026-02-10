import { z } from 'zod'
import {
	registerAppResource,
	registerAppTool,
	RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { createApplianceStore } from '../worker/appliances.ts'
import { applianceSummarySchema } from '../worker/model-schemas.ts'
import { type ApplianceSimulationControl, type MCP } from './index.ts'

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
	simulationToolNames: Array<string>
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

type ApplianceControlUpdateInput = {
	id?: number
	name?: string
	enabled?: boolean
	hoursPerDay?: number
	dutyCyclePercent?: number
	startHour?: number
	quantity?: number
	overrideWatts?: number | null
}

type ApplianceWithControl = ApplianceSummary & {
	control: ApplianceSimulationControl
}

type ApplianceDerived = {
	effectiveWatts: number
	dailyKwh: number
	averageWatts: number
	hourlyLoadWatts: Array<number>
}

type ApplianceWithDerived = ApplianceWithControl & {
	derived: ApplianceDerived
}

type SimulationTotals = {
	dailyKwh: number
	averageWatts: number
	peakWatts: number
}

type SimulationSnapshot = {
	appliances: Array<ApplianceWithDerived>
	totals: SimulationTotals
	hourlyLoadWatts: Array<number>
}

type SimulationToolPayload = {
	ok: true
	appliances: Array<{
		id: number
		name: string
		baseWatts: number
		notes: string | null
		control: ApplianceSimulationControl
		derived: Omit<ApplianceDerived, 'hourlyLoadWatts'>
	}>
	totals: SimulationTotals
	hourlyLoadWatts: Array<number>
	applianceCount: number
	updatedAt: string
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

const applianceControlUpdateSchema = z
	.object({
		id: z.number().int().positive().optional(),
		name: z.string().min(1, 'Name is required.').optional(),
		enabled: z.boolean().optional(),
		hoursPerDay: z.number().min(0).max(24).optional(),
		dutyCyclePercent: z.number().min(0).max(100).optional(),
		startHour: z.number().min(0).max(23).optional(),
		quantity: z.number().int().min(1).max(100).optional(),
		overrideWatts: z.number().positive().max(100_000).nullable().optional(),
	})
	.superRefine((data, context) => {
		const hasTarget = data.id != null || data.name != null
		if (!hasTarget) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Provide appliance id or appliance name to update.',
			})
		}
		const hasControlUpdate =
			data.enabled != null ||
			data.hoursPerDay != null ||
			data.dutyCyclePercent != null ||
			data.startHour != null ||
			data.quantity != null ||
			data.overrideWatts !== undefined
		if (!hasControlUpdate) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Provide at least one control field to update.',
			})
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

function formatKwh(value: number) {
	return `${value.toFixed(2)} kWh`
}

function clampNumber(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

function createDefaultControl(): ApplianceSimulationControl {
	return {
		enabled: true,
		hoursPerDay: 8,
		dutyCyclePercent: 100,
		startHour: 6,
		quantity: 1,
		overrideWatts: null,
	}
}

function normalizeControl(
	control: ApplianceSimulationControl,
): ApplianceSimulationControl {
	return {
		enabled: control.enabled,
		hoursPerDay: clampNumber(control.hoursPerDay, 0, 24),
		dutyCyclePercent: clampNumber(control.dutyCyclePercent, 0, 100),
		startHour: clampNumber(Math.round(control.startHour), 0, 23),
		quantity: clampNumber(Math.round(control.quantity), 1, 100),
		overrideWatts:
			control.overrideWatts == null
				? null
				: clampNumber(control.overrideWatts, 1, 100_000),
	}
}

function getEffectiveWatts(appliance: ApplianceWithControl) {
	return appliance.control.overrideWatts ?? appliance.watts
}

function getOverlap(
	intervalStart: number,
	intervalEnd: number,
	windowStart: number,
	windowEnd: number,
) {
	const start = Math.max(intervalStart, windowStart)
	const end = Math.min(intervalEnd, windowEnd)
	return Math.max(0, end - start)
}

function calculateHourlyLoad(
	control: ApplianceSimulationControl,
	effectiveWatts: number,
) {
	const hourly = Array.from({ length: 24 }, () => 0)
	if (!control.enabled) return hourly
	if (effectiveWatts <= 0) return hourly

	const runHours = clampNumber(control.hoursPerDay, 0, 24)
	if (runHours <= 0) return hourly

	const dutyMultiplier = clampNumber(control.dutyCyclePercent, 0, 100) / 100
	if (dutyMultiplier <= 0) return hourly

	const quantity = clampNumber(control.quantity, 1, 100)
	const watts = effectiveWatts * quantity * dutyMultiplier
	const startHour = clampNumber(control.startHour, 0, 23)
	const endHour = startHour + runHours

	for (let hour = 0; hour < 24; hour++) {
		const intervalStart = hour
		const intervalEnd = hour + 1
		const sameDayOverlap = getOverlap(
			intervalStart,
			intervalEnd,
			startHour,
			Math.min(endHour, 24),
		)
		const wrappedOverlap =
			endHour > 24 ? getOverlap(intervalStart, intervalEnd, 0, endHour - 24) : 0
		const overlap = sameDayOverlap + wrappedOverlap
		hourly[hour] = watts * overlap
	}

	return hourly
}

function calculateApplianceDerived(
	appliance: ApplianceWithControl,
): ApplianceWithDerived {
	const effectiveWatts = getEffectiveWatts(appliance)
	const hourlyLoadWatts = calculateHourlyLoad(appliance.control, effectiveWatts)
	const totalWattHours = hourlyLoadWatts.reduce((sum, value) => sum + value, 0)
	const dailyKwh = totalWattHours / 1000
	const averageWatts = totalWattHours / 24
	return {
		...appliance,
		derived: {
			effectiveWatts,
			dailyKwh,
			averageWatts,
			hourlyLoadWatts,
		},
	}
}

function calculateSimulation(
	appliances: Array<ApplianceWithControl>,
): SimulationSnapshot {
	const appliancesWithDerived = appliances.map(calculateApplianceDerived)
	const hourlyLoadWatts = Array.from({ length: 24 }, (_value, hour) =>
		appliancesWithDerived.reduce(
			(sum, appliance) => sum + (appliance.derived.hourlyLoadWatts[hour] ?? 0),
			0,
		),
	)
	const totalWattHours = hourlyLoadWatts.reduce((sum, value) => sum + value, 0)
	const dailyKwh = totalWattHours / 1000
	const averageWatts = totalWattHours / 24
	const peakWatts = hourlyLoadWatts.reduce(
		(maxValue, value) => Math.max(maxValue, value),
		0,
	)
	return {
		appliances: appliancesWithDerived,
		totals: { dailyKwh, averageWatts, peakWatts },
		hourlyLoadWatts,
	}
}

function toSimulationToolPayload(
	snapshot: SimulationSnapshot,
): SimulationToolPayload {
	return {
		ok: true,
		appliances: snapshot.appliances.map((appliance) => ({
			id: appliance.id,
			name: appliance.name,
			baseWatts: appliance.watts,
			notes: appliance.notes,
			control: appliance.control,
			derived: {
				effectiveWatts: appliance.derived.effectiveWatts,
				dailyKwh: appliance.derived.dailyKwh,
				averageWatts: appliance.derived.averageWatts,
			},
		})),
		totals: snapshot.totals,
		hourlyLoadWatts: snapshot.hourlyLoadWatts,
		applianceCount: snapshot.appliances.length,
		updatedAt: new Date().toISOString(),
	}
}

async function syncStoredSimulationControls(
	agent: MCP,
	ownerId: number,
	appliances: Array<ApplianceSummary>,
) {
	const controls = await agent.getSimulationControls(ownerId)
	const knownIds = new Set(appliances.map((item) => item.id))
	let removedCount = 0
	for (const id of controls.keys()) {
		if (knownIds.has(id)) continue
		controls.delete(id)
		removedCount += 1
	}
	if (removedCount > 0) {
		await agent.setSimulationControls(ownerId, controls)
	}
	return controls
}

function withSimulationControls(
	appliances: Array<ApplianceSummary>,
	controls: Map<number, ApplianceSimulationControl>,
): Array<ApplianceWithControl> {
	return appliances.map((appliance) => ({
		...appliance,
		control: normalizeControl(
			controls.get(appliance.id) ?? createDefaultControl(),
		),
	}))
}

async function persistSimulationControls(
	agent: MCP,
	ownerId: number,
	appliances: Array<ApplianceWithControl>,
) {
	const controls = new Map<number, ApplianceSimulationControl>()
	for (const appliance of appliances) {
		controls.set(appliance.id, appliance.control)
	}
	await agent.setSimulationControls(ownerId, controls)
}

function findApplianceIndexForUpdate(
	appliances: Array<ApplianceWithControl>,
	update: ApplianceControlUpdateInput,
) {
	if (typeof update.id === 'number') {
		return appliances.findIndex((item) => item.id === update.id)
	}
	const normalizedName = update.name?.trim().toLowerCase()
	if (!normalizedName) return -1
	return appliances.findIndex(
		(item) => item.name.trim().toLowerCase() === normalizedName,
	)
}

function applySimulationControlUpdates(
	appliances: Array<ApplianceWithControl>,
	updates: Array<ApplianceControlUpdateInput>,
) {
	const nextAppliances = [...appliances]
	const missingTargets: Array<string> = []
	let appliedCount = 0
	for (const update of updates) {
		const index = findApplianceIndexForUpdate(nextAppliances, update)
		if (index < 0) {
			const missingLabel =
				update.id != null
					? `id:${update.id}`
					: update.name != null
						? `name:${update.name}`
						: 'unknown'
			missingTargets.push(missingLabel)
			continue
		}
		const current = nextAppliances[index]
		if (!current) continue
		const nextControl = normalizeControl({
			enabled:
				update.enabled == null ? current.control.enabled : update.enabled,
			hoursPerDay:
				update.hoursPerDay == null
					? current.control.hoursPerDay
					: update.hoursPerDay,
			dutyCyclePercent:
				update.dutyCyclePercent == null
					? current.control.dutyCyclePercent
					: update.dutyCyclePercent,
			startHour:
				update.startHour == null ? current.control.startHour : update.startHour,
			quantity:
				update.quantity == null ? current.control.quantity : update.quantity,
			overrideWatts:
				update.overrideWatts === undefined
					? current.control.overrideWatts
					: update.overrideWatts,
		})
		nextAppliances[index] = { ...current, control: nextControl }
		appliedCount += 1
	}
	return { nextAppliances, appliedCount, missingTargets }
}

async function getSimulationSnapshot(agent: MCP, ownerId: number) {
	const store = createStore(agent)
	const list = await store.listByOwner(ownerId)
	const summary = summarizeAppliances(list.map(toSummary))
	const controls = await syncStoredSimulationControls(
		agent,
		ownerId,
		summary.appliances,
	)
	const appliancesWithControl = withSimulationControls(
		summary.appliances,
		controls,
	)
	const snapshot = calculateSimulation(appliancesWithControl)
	return { appliancesWithControl, snapshot }
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
		origins.push(`${url.protocol}//127.0.0.1:${port}`)
	} else if (url.hostname === '127.0.0.1') {
		origins.push(`${url.protocol}//localhost:${port}`)
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
	const simulationToolNames = [
		'get_appliance_simulation_state',
		'set_appliance_simulation_controls',
		'reset_appliance_simulation_controls',
	] as const

	registerAppTool(
		agent.server,
		'get_appliance_simulation_state',
		{
			title: 'Get Appliance Simulation State',
			description:
				'Get appliance knob values, derived totals, and the 24-hour load profile.',
			inputSchema: {},
			annotations: { readOnlyHint: true },
			_meta: {
				ui: {
					resourceUri: applianceAppResourceUri,
					visibility: ['model', 'app'],
				},
			},
		},
		async () => {
			const ownerId = await agent.requireOwnerId()
			const { snapshot } = await getSimulationSnapshot(agent, ownerId)
			const payload = toSimulationToolPayload(snapshot)
			return {
				content: [
					{
						type: 'text',
						text: `Current daily load is ${formatKwh(payload.totals.dailyKwh)} with peak ${formatWatts(payload.totals.peakWatts)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		},
	)

	registerAppTool(
		agent.server,
		'set_appliance_simulation_controls',
		{
			title: 'Set Appliance Simulation Controls',
			description:
				'Update simulation knobs by appliance id or name and return recalculated totals.',
			inputSchema: {
				updates: z.array(applianceControlUpdateSchema).min(1),
			},
			annotations: { idempotentHint: true },
			_meta: {
				ui: {
					resourceUri: applianceAppResourceUri,
					visibility: ['model', 'app'],
				},
			},
		},
		async ({ updates }: { updates: Array<ApplianceControlUpdateInput> }) => {
			const ownerId = await agent.requireOwnerId()
			const { appliancesWithControl } = await getSimulationSnapshot(
				agent,
				ownerId,
			)
			const { nextAppliances, appliedCount, missingTargets } =
				applySimulationControlUpdates(appliancesWithControl, updates)
			await persistSimulationControls(agent, ownerId, nextAppliances)
			const snapshot = calculateSimulation(nextAppliances)
			const payload = {
				...toSimulationToolPayload(snapshot),
				appliedCount,
				missingTargets,
			}
			const missingText =
				missingTargets.length > 0
					? ` Missing targets: ${missingTargets.join(', ')}.`
					: ''
			return {
				content: [
					{
						type: 'text',
						text: `Applied ${appliedCount} simulation update(s).${missingText} Daily load is ${formatKwh(payload.totals.dailyKwh)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		},
	)

	registerAppTool(
		agent.server,
		'reset_appliance_simulation_controls',
		{
			title: 'Reset Appliance Simulation Controls',
			description:
				'Reset simulation knobs for selected appliance ids, or all appliances when ids is omitted.',
			inputSchema: {
				ids: z.array(z.number().int().positive()).optional(),
			},
			annotations: { idempotentHint: true },
			_meta: {
				ui: {
					resourceUri: applianceAppResourceUri,
					visibility: ['model', 'app'],
				},
			},
		},
		async ({ ids }: { ids?: Array<number> }) => {
			const ownerId = await agent.requireOwnerId()
			const controls = await agent.getSimulationControls(ownerId)
			let resetCount = 0
			if (ids == null) {
				resetCount = controls.size
				controls.clear()
			} else {
				for (const id of ids) {
					if (controls.delete(id)) {
						resetCount += 1
					}
				}
			}
			await agent.setSimulationControls(ownerId, controls)
			const { snapshot } = await getSimulationSnapshot(agent, ownerId)
			const payload = {
				...toSimulationToolPayload(snapshot),
				resetCount,
				resetAll: ids == null,
			}
			return {
				content: [
					{
						type: 'text',
						text: `Reset controls for ${resetCount} appliance(s). Daily load is ${formatKwh(payload.totals.dailyKwh)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		},
	)

	registerAppTool(
		agent.server,
		'open_appliance_energy_app',
		{
			title: 'Open Appliance Energy App',
			description:
				'Open the interactive appliance energy app and use simulation tools to twist per-appliance knobs.',
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
				simulationToolNames: [...simulationToolNames],
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
