import type { ApplianceSimulationControl } from '../mcp/index.ts'

const controlsStorageKey = 'simulation-controls'

export const simulationHubConnectPath = '/connect'
export const simulationHubControlGetPath = '/controls/get'
export const simulationHubControlSetPath = '/controls/set'
export const simulationHubPublishPath = '/publish'

type SimulationControlsRecord = Record<string, ApplianceSimulationControl>

type SimulationStreamEnvelope = {
	type: 'simulation_state_updated'
	payload: unknown
}

function isFiniteNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value)
}

function toSimulationControl(
	value: unknown,
): ApplianceSimulationControl | null {
	if (!value || typeof value !== 'object') return null
	const candidate = value as Record<string, unknown>
	if (typeof candidate.enabled !== 'boolean') return null
	if (!isFiniteNumber(candidate.hoursPerDay)) return null
	if (!isFiniteNumber(candidate.dutyCyclePercent)) return null
	if (!isFiniteNumber(candidate.startHour)) return null
	if (!isFiniteNumber(candidate.quantity)) return null
	if (
		candidate.overrideWatts != null &&
		!isFiniteNumber(candidate.overrideWatts)
	) {
		return null
	}
	return {
		enabled: candidate.enabled,
		hoursPerDay: candidate.hoursPerDay,
		dutyCyclePercent: candidate.dutyCyclePercent,
		startHour: candidate.startHour,
		quantity: candidate.quantity,
		overrideWatts:
			candidate.overrideWatts == null ? null : candidate.overrideWatts,
	}
}

function normalizeSimulationControlsRecord(value: unknown) {
	if (!value || typeof value !== 'object') return {}
	const normalized: SimulationControlsRecord = {}
	for (const [idText, control] of Object.entries(
		value as Record<string, unknown>,
	)) {
		const id = Number(idText)
		if (!Number.isInteger(id) || id <= 0) continue
		const nextControl = toSimulationControl(control)
		if (!nextControl) continue
		normalized[String(id)] = nextControl
	}
	return normalized
}

export class SimulationHub extends DurableObject<Env> {
	private async readControls() {
		const stored =
			await this.ctx.storage.get<SimulationControlsRecord>(controlsStorageKey)
		return normalizeSimulationControlsRecord(stored)
	}

	private async writeControls(controls: SimulationControlsRecord) {
		const ids = Object.keys(controls)
		if (ids.length === 0) {
			await this.ctx.storage.delete(controlsStorageKey)
			return
		}
		await this.ctx.storage.put(controlsStorageKey, controls)
	}

	private async broadcastSimulationUpdate(payload: unknown) {
		const message: SimulationStreamEnvelope = {
			type: 'simulation_state_updated',
			payload,
		}
		const encoded = JSON.stringify(message)
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(encoded)
			} catch {
				try {
					socket.close(1011, 'Simulation update failed.')
				} catch {
					// Ignore cleanup failures.
				}
			}
		}
	}

	private handleWebSocketConnect(request: Request) {
		const upgradeHeader = request.headers.get('Upgrade')
		if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
			return new Response('Expected websocket upgrade.', { status: 426 })
		}
		const pair = new WebSocketPair()
		const clientSocket = pair[0]
		const serverSocket = pair[1]
		this.ctx.acceptWebSocket(serverSocket)
		return new Response(null, {
			status: 101,
			webSocket: clientSocket,
		})
	}

	async fetch(request: Request) {
		const url = new URL(request.url)
		if (url.pathname === simulationHubConnectPath) {
			return this.handleWebSocketConnect(request)
		}
		if (
			request.method === 'GET' &&
			url.pathname === simulationHubControlGetPath
		) {
			return Response.json({
				ok: true,
				controls: await this.readControls(),
			})
		}
		if (
			request.method === 'POST' &&
			url.pathname === simulationHubControlSetPath
		) {
			const body = (await request.json().catch(() => null)) as {
				controls?: unknown
			} | null
			if (!body) {
				return new Response('Invalid JSON body.', { status: 400 })
			}
			const controls = normalizeSimulationControlsRecord(body.controls)
			await this.writeControls(controls)
			return Response.json({ ok: true })
		}
		if (
			request.method === 'POST' &&
			url.pathname === simulationHubPublishPath
		) {
			const body = (await request.json().catch(() => null)) as {
				payload?: unknown
			} | null
			if (!body || body.payload == null) {
				return new Response('Missing payload.', { status: 400 })
			}
			await this.broadcastSimulationUpdate(body.payload)
			return Response.json({ ok: true })
		}
		return new Response('Not found.', { status: 404 })
	}
}
