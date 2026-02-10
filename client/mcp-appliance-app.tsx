import { App, type McpUiHostContext } from '@modelcontextprotocol/ext-apps'
import {
	ListToolsRequestSchema,
	type CallToolResult,
	type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { type Handle } from 'remix/component'
import { colors, radius, spacing, typography } from './styles/tokens.ts'

type ConnectionStatus = 'connecting' | 'connected' | 'error'

type ApplianceSeed = {
	id: number
	name: string
	watts: number
	notes: string | null
}

type ApplianceControl = {
	enabled: boolean
	hoursPerDay: number
	dutyCyclePercent: number
	startHour: number
	quantity: number
	overrideWatts: number | null
}

type ApplianceWithControl = ApplianceSeed & {
	control: ApplianceControl
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

type LaunchPayload = {
	ok: true
	appliances: Array<ApplianceSeed>
	applianceCount: number
	generatedAt: string
}

type ToolUpdate = {
	id?: number
	name?: string
	enabled?: boolean
	hoursPerDay?: number
	dutyCyclePercent?: number
	startHour?: number
	quantity?: number
	overrideWatts?: number | null
}

type SimulationToolPayload = {
	ok: true
	appliances: Array<{
		id: number
		name: string
		baseWatts: number
		notes: string | null
		control: ApplianceControl
		derived: Omit<ApplianceDerived, 'hourlyLoadWatts'>
	}>
	totals: SimulationTotals
	hourlyLoadWatts: Array<number>
	updatedAt: string
}

const appInfo = { name: 'Appliance Energy App', version: '1.0.0' }
const appCapabilities = {
	tools: { listChanged: false },
	availableDisplayModes: ['inline', 'fullscreen'],
} satisfies NonNullable<ConstructorParameters<typeof App>[1]>

const appToolDefinitions: Array<Tool> = [
	{
		name: 'get_appliance_simulation_state',
		description:
			'Get current appliance knob values, derived totals, and hourly load profile.',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'set_appliance_controls',
		description:
			'Update per-appliance control knobs by appliance id or name and return recalculated totals.',
		inputSchema: {
			type: 'object',
			properties: {
				updates: {
					type: 'array',
					minItems: 1,
					items: {
						type: 'object',
						properties: {
							id: { type: 'number', minimum: 1 },
							name: { type: 'string' },
							enabled: { type: 'boolean' },
							hoursPerDay: { type: 'number', minimum: 0, maximum: 24 },
							dutyCyclePercent: { type: 'number', minimum: 0, maximum: 100 },
							startHour: { type: 'number', minimum: 0, maximum: 23 },
							quantity: { type: 'number', minimum: 1, maximum: 100 },
							overrideWatts: { type: ['number', 'null'], minimum: 1 },
						},
					},
				},
			},
			required: ['updates'],
		},
	},
	{
		name: 'reset_appliance_controls',
		description:
			'Reset controls to defaults for selected appliance ids, or for all appliances if ids is omitted.',
		inputSchema: {
			type: 'object',
			properties: {
				ids: {
					type: 'array',
					items: { type: 'number', minimum: 1 },
				},
			},
		},
	},
]

function clampNumber(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

function toFiniteNumber(value: unknown) {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	if (!normalized) return null
	const parsed = Number(normalized)
	return Number.isFinite(parsed) ? parsed : null
}

function normalizeControl(control: ApplianceControl): ApplianceControl {
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

function createDefaultControl(): ApplianceControl {
	return {
		enabled: true,
		hoursPerDay: 8,
		dutyCyclePercent: 100,
		startHour: 6,
		quantity: 1,
		overrideWatts: null,
	}
}

function buildApplianceWithControl(seed: ApplianceSeed): ApplianceWithControl {
	return {
		...seed,
		control: createDefaultControl(),
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
	control: ApplianceControl,
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
		updatedAt: new Date().toISOString(),
	}
}

function formatWatts(value: number) {
	return `${Math.round(value).toLocaleString()} W`
}

function formatKwh(value: number) {
	return `${value.toFixed(2)} kWh`
}

function isLaunchPayload(value: unknown): value is LaunchPayload {
	if (!value || typeof value !== 'object') return false
	const payload = value as Record<string, unknown>
	return (
		payload.ok === true &&
		Array.isArray(payload.appliances) &&
		typeof payload.applianceCount === 'number'
	)
}

async function requestFullscreenDisplayMode(app: App) {
	const context = app.getHostContext()
	const availableDisplayModes = context?.availableDisplayModes
	if (!availableDisplayModes?.includes('fullscreen')) {
		return { attempted: false, granted: context?.displayMode === 'fullscreen' }
	}
	try {
		const result = await app.requestDisplayMode({ mode: 'fullscreen' })
		return { attempted: true, granted: result.mode === 'fullscreen' }
	} catch {
		return { attempted: true, granted: false }
	}
}

export function McpApplianceApp(handle: Handle) {
	let hostContext: McpUiHostContext | undefined
	let connectionStatus: ConnectionStatus = 'connecting'
	let connectionMessage: string | null = 'Connecting to host…'
	let loadError: string | null = null
	let isConnectQueued = false

	let applianceRows: Array<ApplianceWithControl> = []
	let selectedApplianceId: number | null = null
	let simulation = calculateSimulation(applianceRows)

	function updateSimulation(nextRows: Array<ApplianceWithControl>) {
		applianceRows = nextRows
		simulation = calculateSimulation(applianceRows)
		if (selectedApplianceId == null && applianceRows.length > 0) {
			selectedApplianceId = applianceRows[0]?.id ?? null
		}
		if (selectedApplianceId != null) {
			const exists = applianceRows.some(
				(item) => item.id === selectedApplianceId,
			)
			if (!exists) {
				selectedApplianceId = applianceRows[0]?.id ?? null
			}
		}
	}

	function hydrateFromLaunchPayload(payload: LaunchPayload) {
		const rows = payload.appliances.map(buildApplianceWithControl)
		updateSimulation(rows)
		connectionMessage = `Loaded ${payload.applianceCount} appliance(s).`
		loadError = null
		handle.update()
	}

	function findApplianceIndex(update: ToolUpdate) {
		if (typeof update.id === 'number') {
			return applianceRows.findIndex((item) => item.id === update.id)
		}
		if (typeof update.name === 'string' && update.name.trim()) {
			const normalized = update.name.trim().toLowerCase()
			return applianceRows.findIndex(
				(item) => item.name.trim().toLowerCase() === normalized,
			)
		}
		return -1
	}

	function applyToolUpdates(updates: Array<ToolUpdate>) {
		const nextRows = [...applianceRows]
		const missingTargets: Array<string> = []
		let appliedCount = 0

		for (const update of updates) {
			const index = findApplianceIndex(update)
			if (index < 0) {
				const label =
					typeof update.id === 'number'
						? `id:${update.id}`
						: typeof update.name === 'string'
							? `name:${update.name}`
							: 'unknown'
				missingTargets.push(label)
				continue
			}
			const current = nextRows[index]
			if (!current) continue
			const nextControl = normalizeControl({
				enabled:
					typeof update.enabled === 'boolean'
						? update.enabled
						: current.control.enabled,
				hoursPerDay:
					toFiniteNumber(update.hoursPerDay) ?? current.control.hoursPerDay,
				dutyCyclePercent:
					toFiniteNumber(update.dutyCyclePercent) ??
					current.control.dutyCyclePercent,
				startHour:
					toFiniteNumber(update.startHour) ?? current.control.startHour,
				quantity: toFiniteNumber(update.quantity) ?? current.control.quantity,
				overrideWatts:
					update.overrideWatts === null
						? null
						: (toFiniteNumber(update.overrideWatts) ??
							current.control.overrideWatts),
			})
			nextRows[index] = { ...current, control: nextControl }
			appliedCount += 1
		}

		if (appliedCount > 0) {
			updateSimulation(nextRows)
			loadError = null
			handle.update()
		}

		return { appliedCount, missingTargets }
	}

	function resetControls(ids: Array<number> | null) {
		if (ids === null) {
			updateSimulation(
				applianceRows.map((item) => ({
					...item,
					control: createDefaultControl(),
				})),
			)
			handle.update()
			return applianceRows.length
		}
		if (ids.length === 0) {
			return 0
		}
		const targetSet = new Set(ids)
		let changedCount = 0
		const nextRows = applianceRows.map((item) => {
			if (!targetSet.has(item.id)) return item
			changedCount += 1
			return { ...item, control: createDefaultControl() }
		})
		updateSimulation(nextRows)
		handle.update()
		return changedCount
	}

	async function handleToolCall(
		params: Parameters<NonNullable<App['oncalltool']>>[0],
	): Promise<CallToolResult> {
		if (params.name === 'get_appliance_simulation_state') {
			const payload = toSimulationToolPayload(simulation)
			return {
				content: [
					{
						type: 'text',
						text: `Current daily load is ${formatKwh(payload.totals.dailyKwh)} with a peak of ${formatWatts(payload.totals.peakWatts)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		}

		if (params.name === 'set_appliance_controls') {
			const args =
				params.arguments && typeof params.arguments === 'object'
					? (params.arguments as Record<string, unknown>)
					: {}
			const updates = Array.isArray(args.updates)
				? (args.updates as Array<ToolUpdate>)
				: []
			if (updates.length === 0) {
				return {
					isError: true,
					content: [
						{
							type: 'text',
							text: 'Expected non-empty updates array for set_appliance_controls.',
						},
					],
				}
			}
			const { appliedCount, missingTargets } = applyToolUpdates(updates)
			const payload = toSimulationToolPayload(simulation)
			const missingText =
				missingTargets.length > 0
					? ` Missing targets: ${missingTargets.join(', ')}.`
					: ''
			return {
				content: [
					{
						type: 'text',
						text: `Applied ${appliedCount} control update(s).${missingText} Daily load is ${formatKwh(payload.totals.dailyKwh)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		}

		if (params.name === 'reset_appliance_controls') {
			const args =
				params.arguments && typeof params.arguments === 'object'
					? (params.arguments as Record<string, unknown>)
					: {}
			const ids = Array.isArray(args.ids)
				? args.ids
						.map((value) => toFiniteNumber(value))
						.filter((value): value is number => value != null)
						.map((value) => Math.round(value))
				: null
			const changedCount = resetControls(ids)
			const payload = toSimulationToolPayload(simulation)
			return {
				content: [
					{
						type: 'text',
						text: `Reset controls for ${changedCount} appliance(s). Daily load is ${formatKwh(payload.totals.dailyKwh)}.`,
					},
					{ type: 'text', text: JSON.stringify(payload) },
				],
				structuredContent: payload,
			}
		}

		return {
			isError: true,
			content: [
				{
					type: 'text',
					text: `Unknown app tool: ${params.name}`,
				},
			],
		}
	}

	async function connect(signal: AbortSignal) {
		try {
			connectionStatus = 'connecting'
			connectionMessage = 'Connecting to host…'
			loadError = null
			handle.update()

			const nextApp = new App(appInfo, appCapabilities)

			nextApp.ontoolresult = (result) => {
				const payload = (result as { structuredContent?: unknown })
					.structuredContent
				if (!isLaunchPayload(payload)) return
				hydrateFromLaunchPayload(payload)
			}

			nextApp.onhostcontextchanged = (context) => {
				hostContext = { ...hostContext, ...context }
				handle.update()
			}

			nextApp.setRequestHandler(ListToolsRequestSchema, async () => ({
				tools: appToolDefinitions,
			}))

			nextApp.oncalltool = handleToolCall
			const timeoutMs = 8000
			let timeoutHandle: ReturnType<typeof setTimeout> | null = null
			try {
				await Promise.race([
					nextApp.connect(),
					new Promise<never>((_, reject) => {
						timeoutHandle = setTimeout(() => {
							reject(
								new Error(`Host handshake timed out after ${timeoutMs}ms.`),
							)
						}, timeoutMs)
					}),
				])
			} finally {
				if (timeoutHandle) clearTimeout(timeoutHandle)
			}

			// connect() resolved successfully, so prefer connected state even if this
			// task signal was aborted during intermediate updates.
			hostContext = nextApp.getHostContext()
			const fullscreenRequest = await requestFullscreenDisplayMode(nextApp)
			hostContext = nextApp.getHostContext()
			connectionStatus = 'connected'
			if (hostContext?.displayMode === 'fullscreen') {
				connectionMessage = 'Connected in fullscreen mode.'
			} else if (fullscreenRequest.attempted) {
				connectionMessage =
					'Connected. Host kept inline mode after fullscreen request.'
			} else {
				connectionMessage = 'Connected in inline mode.'
			}
			handle.update()
		} catch (error) {
			connectionStatus = 'error'
			connectionMessage = null
			const message =
				error instanceof Error ? error.message : 'Connection failed.'
			loadError = signal.aborted
				? `${message} (task signal aborted during handshake)`
				: message
			handle.update()
		}
	}

	function getSelectedAppliance() {
		if (selectedApplianceId == null) return null
		return (
			simulation.appliances.find((item) => item.id === selectedApplianceId) ??
			null
		)
	}

	function updateSelectedControl(
		key: keyof ApplianceControl,
		value: boolean | number | null,
	) {
		const selected = getSelectedAppliance()
		if (!selected) return
		const nextRows = applianceRows.map((item) => {
			if (item.id !== selected.id) return item
			const nextControl = normalizeControl({
				...item.control,
				[key]: value as never,
			})
			return { ...item, control: nextControl }
		})
		updateSimulation(nextRows)
		handle.update()
	}

	function getSafeAreaPadding() {
		const safeAreaInsets = hostContext?.safeAreaInsets
		const top = safeAreaInsets?.top ?? 0
		const right = safeAreaInsets?.right ?? 0
		const bottom = safeAreaInsets?.bottom ?? 0
		const left = safeAreaInsets?.left ?? 0
		return {
			paddingTop: `calc(${spacing.md} + ${top}px)`,
			paddingRight: `calc(${spacing.md} + ${right}px)`,
			paddingBottom: `calc(${spacing.md} + ${bottom}px)`,
			paddingLeft: `calc(${spacing.md} + ${left}px)`,
		}
	}

	return () => {
		if (!isConnectQueued) {
			isConnectQueued = true
			handle.queueTask(connect)
		}

		const selected = getSelectedAppliance()
		const hourlyMax = simulation.hourlyLoadWatts.reduce(
			(maxValue, value) => Math.max(maxValue, value),
			0,
		)

		return (
			<main
				style={{
					...getSafeAreaPadding(),
					height: '100%',
					boxSizing: 'border-box',
					display: 'grid',
					gridTemplateRows: 'auto auto 1fr',
					gap: spacing.md,
					background: colors.background,
					color: colors.text,
					fontFamily: typography.fontFamily,
				}}
			>
				<header
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						gap: spacing.md,
						flexWrap: 'wrap',
					}}
				>
					<div style={{ display: 'grid', gap: spacing.xs }}>
						<h1
							style={{
								margin: 0,
								fontSize: typography.fontSize.lg,
								fontWeight: typography.fontWeight.semibold,
							}}
						>
							Appliance Energy Simulator
						</h1>
						<p style={{ margin: 0, color: colors.textMuted }}>
							Local-only appliance knobs and load calculations.
						</p>
					</div>
					<p
						style={{
							margin: 0,
							fontWeight: typography.fontWeight.semibold,
							color:
								connectionStatus === 'error'
									? colors.error
									: connectionStatus === 'connected'
										? colors.primaryText
										: colors.textMuted,
						}}
					>
						{connectionStatus === 'connected'
							? 'Connected'
							: connectionStatus === 'error'
								? 'Connection error'
								: 'Connecting…'}
					</p>
				</header>

				<section
					style={{
						display: 'grid',
						gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
						gap: spacing.sm,
					}}
				>
					<article
						style={{
							border: `1px solid ${colors.border}`,
							borderRadius: radius.lg,
							padding: spacing.sm,
							display: 'grid',
							gap: spacing.xs,
							background: colors.surface,
						}}
					>
						<p style={{ margin: 0, color: colors.textMuted }}>Daily energy</p>
						<p
							style={{
								margin: 0,
								fontSize: typography.fontSize.lg,
								fontWeight: typography.fontWeight.semibold,
							}}
						>
							{formatKwh(simulation.totals.dailyKwh)}
						</p>
					</article>
					<article
						style={{
							border: `1px solid ${colors.border}`,
							borderRadius: radius.lg,
							padding: spacing.sm,
							display: 'grid',
							gap: spacing.xs,
							background: colors.surface,
						}}
					>
						<p style={{ margin: 0, color: colors.textMuted }}>Peak load</p>
						<p
							style={{
								margin: 0,
								fontSize: typography.fontSize.lg,
								fontWeight: typography.fontWeight.semibold,
							}}
						>
							{formatWatts(simulation.totals.peakWatts)}
						</p>
					</article>
					<article
						style={{
							border: `1px solid ${colors.border}`,
							borderRadius: radius.lg,
							padding: spacing.sm,
							display: 'grid',
							gap: spacing.xs,
							background: colors.surface,
						}}
					>
						<p style={{ margin: 0, color: colors.textMuted }}>Average load</p>
						<p
							style={{
								margin: 0,
								fontSize: typography.fontSize.lg,
								fontWeight: typography.fontWeight.semibold,
							}}
						>
							{formatWatts(simulation.totals.averageWatts)}
						</p>
					</article>
				</section>

				<section
					style={{
						display: 'grid',
						gridTemplateColumns: 'minmax(0, 18rem) minmax(0, 1fr)',
						gap: spacing.md,
						minHeight: 0,
					}}
				>
					<aside
						style={{
							border: `1px solid ${colors.border}`,
							borderRadius: radius.lg,
							padding: spacing.sm,
							display: 'grid',
							gap: spacing.sm,
							alignContent: 'start',
							overflow: 'auto',
							background: colors.surface,
						}}
					>
						<label style={{ display: 'grid', gap: spacing.xs }}>
							<span style={{ fontWeight: typography.fontWeight.semibold }}>
								Select appliance
							</span>
							<select
								value={selectedApplianceId ?? ''}
								on={{
									change: (event) => {
										if (!(event.currentTarget instanceof HTMLSelectElement))
											return
										const nextId = toFiniteNumber(event.currentTarget.value)
										selectedApplianceId =
											nextId == null ? null : Math.round(nextId)
										handle.update()
									},
								}}
								style={{
									padding: spacing.sm,
									borderRadius: radius.md,
									border: `1px solid ${colors.border}`,
									background: colors.background,
									color: colors.text,
									fontFamily: typography.fontFamily,
								}}
							>
								<option value="">Select…</option>
								{simulation.appliances.map((appliance) => (
									<option key={appliance.id} value={appliance.id}>
										{appliance.name}
									</option>
								))}
							</select>
						</label>

						<ul
							style={{
								margin: 0,
								paddingLeft: '1.1rem',
								display: 'grid',
								gap: spacing.xs,
							}}
						>
							{simulation.appliances.map((appliance) => (
								<li key={appliance.id}>
									<strong>{appliance.name}</strong> —{' '}
									{formatKwh(appliance.derived.dailyKwh)}
								</li>
							))}
						</ul>
					</aside>

					<div
						style={{
							border: `1px solid ${colors.border}`,
							borderRadius: radius.lg,
							padding: spacing.sm,
							display: 'grid',
							gap: spacing.sm,
							alignContent: 'start',
							overflow: 'auto',
							background: colors.surface,
						}}
					>
						{connectionMessage ? (
							<p style={{ margin: 0, color: colors.textMuted }}>
								{connectionMessage}
							</p>
						) : null}
						{loadError ? (
							<p style={{ margin: 0, color: colors.error }} role="alert">
								{loadError}
							</p>
						) : null}

						{selected ? (
							<section style={{ display: 'grid', gap: spacing.sm }}>
								<header style={{ display: 'grid', gap: spacing.xs }}>
									<h2 style={{ margin: 0, fontSize: typography.fontSize.base }}>
										{selected.name}
									</h2>
									<p style={{ margin: 0, color: colors.textMuted }}>
										Base: {formatWatts(selected.watts)} · Effective:{' '}
										{formatWatts(selected.derived.effectiveWatts)}
									</p>
									{selected.notes ? (
										<p style={{ margin: 0, color: colors.textMuted }}>
											{selected.notes}
										</p>
									) : null}
								</header>

								<label
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: spacing.sm,
									}}
								>
									<input
										type="checkbox"
										checked={selected.control.enabled}
										on={{
											change: (event) => {
												if (!(event.currentTarget instanceof HTMLInputElement))
													return
												updateSelectedControl(
													'enabled',
													event.currentTarget.checked,
												)
											},
										}}
									/>
									<span>Enabled</span>
								</label>

								<label style={{ display: 'grid', gap: spacing.xs }}>
									<span>Hours per day</span>
									<input
										type="number"
										min="0"
										max="24"
										step="0.25"
										value={selected.control.hoursPerDay}
										on={{
											input: (event) => {
												if (!(event.currentTarget instanceof HTMLInputElement))
													return
												const next = toFiniteNumber(event.currentTarget.value)
												if (next == null) return
												updateSelectedControl('hoursPerDay', next)
											},
										}}
										style={{
											padding: spacing.sm,
											borderRadius: radius.md,
											border: `1px solid ${colors.border}`,
											background: colors.background,
											color: colors.text,
											fontFamily: typography.fontFamily,
										}}
									/>
								</label>

								<label style={{ display: 'grid', gap: spacing.xs }}>
									<span>Duty cycle (%)</span>
									<input
										type="number"
										min="0"
										max="100"
										step="1"
										value={selected.control.dutyCyclePercent}
										on={{
											input: (event) => {
												if (!(event.currentTarget instanceof HTMLInputElement))
													return
												const next = toFiniteNumber(event.currentTarget.value)
												if (next == null) return
												updateSelectedControl('dutyCyclePercent', next)
											},
										}}
										style={{
											padding: spacing.sm,
											borderRadius: radius.md,
											border: `1px solid ${colors.border}`,
											background: colors.background,
											color: colors.text,
											fontFamily: typography.fontFamily,
										}}
									/>
								</label>

								<label style={{ display: 'grid', gap: spacing.xs }}>
									<span>Start hour (0–23)</span>
									<input
										type="number"
										min="0"
										max="23"
										step="1"
										value={selected.control.startHour}
										on={{
											input: (event) => {
												if (!(event.currentTarget instanceof HTMLInputElement))
													return
												const next = toFiniteNumber(event.currentTarget.value)
												if (next == null) return
												updateSelectedControl('startHour', next)
											},
										}}
										style={{
											padding: spacing.sm,
											borderRadius: radius.md,
											border: `1px solid ${colors.border}`,
											background: colors.background,
											color: colors.text,
											fontFamily: typography.fontFamily,
										}}
									/>
								</label>

								<label style={{ display: 'grid', gap: spacing.xs }}>
									<span>Quantity</span>
									<input
										type="number"
										min="1"
										max="100"
										step="1"
										value={selected.control.quantity}
										on={{
											input: (event) => {
												if (!(event.currentTarget instanceof HTMLInputElement))
													return
												const next = toFiniteNumber(event.currentTarget.value)
												if (next == null) return
												updateSelectedControl('quantity', next)
											},
										}}
										style={{
											padding: spacing.sm,
											borderRadius: radius.md,
											border: `1px solid ${colors.border}`,
											background: colors.background,
											color: colors.text,
											fontFamily: typography.fontFamily,
										}}
									/>
								</label>

								<label style={{ display: 'grid', gap: spacing.xs }}>
									<span>Override watts (optional)</span>
									<input
										type="number"
										min="1"
										step="1"
										placeholder="Use base watts when blank"
										value={selected.control.overrideWatts ?? ''}
										on={{
											input: (event) => {
												if (!(event.currentTarget instanceof HTMLInputElement))
													return
												const value = event.currentTarget.value.trim()
												if (!value) {
													updateSelectedControl('overrideWatts', null)
													return
												}
												const next = toFiniteNumber(value)
												if (next == null) return
												updateSelectedControl('overrideWatts', next)
											},
										}}
										style={{
											padding: spacing.sm,
											borderRadius: radius.md,
											border: `1px solid ${colors.border}`,
											background: colors.background,
											color: colors.text,
											fontFamily: typography.fontFamily,
										}}
									/>
								</label>

								<p style={{ margin: 0 }}>
									<strong>Appliance daily load:</strong>{' '}
									{formatKwh(selected.derived.dailyKwh)}
								</p>
							</section>
						) : (
							<p style={{ margin: 0, color: colors.textMuted }}>
								Select an appliance to adjust knobs.
							</p>
						)}

						<section style={{ display: 'grid', gap: spacing.sm }}>
							<h3 style={{ margin: 0, fontSize: '0.95rem' }}>
								Hourly load profile
							</h3>
							<div
								style={{
									display: 'grid',
									gridTemplateColumns: 'repeat(24, minmax(0, 1fr))',
									alignItems: 'end',
									gap: '0.2rem',
									height: '7.5rem',
									border: `1px solid ${colors.border}`,
									borderRadius: radius.md,
									padding: '0.4rem',
									background: colors.background,
								}}
							>
								{simulation.hourlyLoadWatts.map((value, hour) => {
									const ratio = hourlyMax > 0 ? value / hourlyMax : 0
									return (
										<div
											key={hour}
											title={`${hour}:00 · ${formatWatts(value)}`}
											style={{
												height: `${Math.max(6, ratio * 100)}%`,
												borderRadius: '0.2rem',
												background: colors.primary,
											}}
										/>
									)
								})}
							</div>
							<div
								style={{
									display: 'grid',
									gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
									fontSize: '0.75rem',
									color: colors.textMuted,
								}}
							>
								{Array.from({ length: 12 }, (_value, index) => (
									<span key={index} style={{ textAlign: 'center' }}>
										{String(index * 2).padStart(2, '0')}
									</span>
								))}
							</div>
						</section>
					</div>
				</section>
			</main>
		)
	}
}
