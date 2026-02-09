import { App, type McpUiHostContext } from '@modelcontextprotocol/ext-apps'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type Handle } from 'remix/component'

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
		if (!ids || ids.length === 0) {
			updateSimulation(
				applianceRows.map((item) => ({
					...item,
					control: createDefaultControl(),
				})),
			)
			handle.update()
			return applianceRows.length
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

			const nextApp = new App(appInfo, { tools: { listChanged: false } })

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

			nextApp.onlisttools = async () => ({
				tools: [
					'get_appliance_simulation_state',
					'set_appliance_controls',
					'reset_appliance_controls',
				],
			})

			nextApp.oncalltool = handleToolCall

			await nextApp.connect()
			if (signal.aborted) return

			hostContext = nextApp.getHostContext()
			connectionStatus = 'connected'
			connectionMessage = 'Connected.'
			handle.update()
		} catch (error) {
			if (signal.aborted) return
			connectionStatus = 'error'
			connectionMessage = null
			loadError = error instanceof Error ? error.message : 'Connection failed.'
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
		return {
			paddingTop: hostContext?.safeAreaInsets?.top ?? 0,
			paddingRight: hostContext?.safeAreaInsets?.right ?? 0,
			paddingBottom: hostContext?.safeAreaInsets?.bottom ?? 0,
			paddingLeft: hostContext?.safeAreaInsets?.left ?? 0,
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
					gap: '1rem',
					padding: '1rem',
					background: '#ffffff',
					color: '#111827',
				}}
			>
				<header
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
						gap: '1rem',
						flexWrap: 'wrap',
					}}
				>
					<div style={{ display: 'grid', gap: '0.25rem' }}>
						<h1 style={{ margin: 0, fontSize: '1.25rem' }}>
							Appliance Energy Simulator
						</h1>
						<p style={{ margin: 0, color: '#4b5563' }}>
							Local-only appliance knobs and load calculations.
						</p>
					</div>
					<p
						style={{
							margin: 0,
							fontWeight: 600,
							color:
								connectionStatus === 'error'
									? '#b91c1c'
									: connectionStatus === 'connected'
										? '#047857'
										: '#92400e',
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
						gap: '0.75rem',
					}}
				>
					<article
						style={{
							border: '1px solid #e5e7eb',
							borderRadius: '0.75rem',
							padding: '0.75rem',
							display: 'grid',
							gap: '0.25rem',
						}}
					>
						<p style={{ margin: 0, color: '#6b7280' }}>Daily energy</p>
						<p style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
							{formatKwh(simulation.totals.dailyKwh)}
						</p>
					</article>
					<article
						style={{
							border: '1px solid #e5e7eb',
							borderRadius: '0.75rem',
							padding: '0.75rem',
							display: 'grid',
							gap: '0.25rem',
						}}
					>
						<p style={{ margin: 0, color: '#6b7280' }}>Peak load</p>
						<p style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
							{formatWatts(simulation.totals.peakWatts)}
						</p>
					</article>
					<article
						style={{
							border: '1px solid #e5e7eb',
							borderRadius: '0.75rem',
							padding: '0.75rem',
							display: 'grid',
							gap: '0.25rem',
						}}
					>
						<p style={{ margin: 0, color: '#6b7280' }}>Average load</p>
						<p style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>
							{formatWatts(simulation.totals.averageWatts)}
						</p>
					</article>
				</section>

				<section
					style={{
						display: 'grid',
						gridTemplateColumns: 'minmax(0, 18rem) minmax(0, 1fr)',
						gap: '1rem',
						minHeight: 0,
					}}
				>
					<aside
						style={{
							border: '1px solid #e5e7eb',
							borderRadius: '0.75rem',
							padding: '0.75rem',
							display: 'grid',
							gap: '0.75rem',
							alignContent: 'start',
							overflow: 'auto',
						}}
					>
						<label style={{ display: 'grid', gap: '0.35rem' }}>
							<span style={{ fontWeight: 600 }}>Select appliance</span>
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
									padding: '0.5rem',
									borderRadius: '0.5rem',
									border: '1px solid #d1d5db',
									background: '#fff',
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
								gap: '0.35rem',
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
							border: '1px solid #e5e7eb',
							borderRadius: '0.75rem',
							padding: '0.75rem',
							display: 'grid',
							gap: '0.75rem',
							alignContent: 'start',
							overflow: 'auto',
						}}
					>
						{connectionMessage ? (
							<p style={{ margin: 0, color: '#6b7280' }}>{connectionMessage}</p>
						) : null}
						{loadError ? (
							<p style={{ margin: 0, color: '#b91c1c' }} role="alert">
								{loadError}
							</p>
						) : null}

						{selected ? (
							<section style={{ display: 'grid', gap: '0.75rem' }}>
								<header style={{ display: 'grid', gap: '0.35rem' }}>
									<h2 style={{ margin: 0, fontSize: '1rem' }}>
										{selected.name}
									</h2>
									<p style={{ margin: 0, color: '#6b7280' }}>
										Base: {formatWatts(selected.watts)} · Effective:{' '}
										{formatWatts(selected.derived.effectiveWatts)}
									</p>
									{selected.notes ? (
										<p style={{ margin: 0, color: '#6b7280' }}>
											{selected.notes}
										</p>
									) : null}
								</header>

								<label
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '0.5rem',
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

								<label style={{ display: 'grid', gap: '0.35rem' }}>
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
											padding: '0.5rem',
											borderRadius: '0.5rem',
											border: '1px solid #d1d5db',
										}}
									/>
								</label>

								<label style={{ display: 'grid', gap: '0.35rem' }}>
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
											padding: '0.5rem',
											borderRadius: '0.5rem',
											border: '1px solid #d1d5db',
										}}
									/>
								</label>

								<label style={{ display: 'grid', gap: '0.35rem' }}>
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
											padding: '0.5rem',
											borderRadius: '0.5rem',
											border: '1px solid #d1d5db',
										}}
									/>
								</label>

								<label style={{ display: 'grid', gap: '0.35rem' }}>
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
											padding: '0.5rem',
											borderRadius: '0.5rem',
											border: '1px solid #d1d5db',
										}}
									/>
								</label>

								<label style={{ display: 'grid', gap: '0.35rem' }}>
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
											padding: '0.5rem',
											borderRadius: '0.5rem',
											border: '1px solid #d1d5db',
										}}
									/>
								</label>

								<p style={{ margin: 0 }}>
									<strong>Appliance daily load:</strong>{' '}
									{formatKwh(selected.derived.dailyKwh)}
								</p>
							</section>
						) : (
							<p style={{ margin: 0, color: '#6b7280' }}>
								Select an appliance to adjust knobs.
							</p>
						)}

						<section style={{ display: 'grid', gap: '0.5rem' }}>
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
									border: '1px solid #e5e7eb',
									borderRadius: '0.5rem',
									padding: '0.4rem',
									background: '#f9fafb',
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
												background: '#2563eb',
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
									color: '#6b7280',
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
