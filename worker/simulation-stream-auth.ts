const simulationStreamTokenVersion = 1
const defaultSimulationStreamTtlMs = 5 * 60 * 1000

type SimulationStreamTokenPayload = {
	v: number
	ownerId: number
	exp: number
}

export const simulationStreamPath = '/simulation-stream'

function encodeBase64Url(bytes: Uint8Array) {
	let binary = ''
	for (const value of bytes) {
		binary += String.fromCharCode(value)
	}
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '')
}

function decodeBase64Url(input: string) {
	if (!input) return null
	const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
	try {
		const binary = atob(padded)
		const bytes = new Uint8Array(binary.length)
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index)
		}
		return bytes
	} catch {
		return null
	}
}

async function importSimulationStreamKey(secret: string) {
	return crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify'],
	)
}

export async function createSimulationStreamToken({
	secret,
	ownerId,
	now = Date.now(),
	ttlMs = defaultSimulationStreamTtlMs,
}: {
	secret: string
	ownerId: number
	now?: number
	ttlMs?: number
}) {
	const expiresAt = now + ttlMs
	const payload: SimulationStreamTokenPayload = {
		v: simulationStreamTokenVersion,
		ownerId,
		exp: expiresAt,
	}
	const payloadEncoded = encodeBase64Url(
		new TextEncoder().encode(JSON.stringify(payload)),
	)
	const key = await importSimulationStreamKey(secret)
	const signatureBytes = new Uint8Array(
		await crypto.subtle.sign(
			'HMAC',
			key,
			new TextEncoder().encode(payloadEncoded),
		),
	)
	const signatureEncoded = encodeBase64Url(signatureBytes)
	return {
		token: `${payloadEncoded}.${signatureEncoded}`,
		expiresAt: new Date(expiresAt).toISOString(),
	}
}

export async function verifySimulationStreamToken({
	secret,
	token,
	now = Date.now(),
}: {
	secret: string
	token: string
	now?: number
}) {
	const separatorIndex = token.indexOf('.')
	if (separatorIndex < 1 || separatorIndex >= token.length - 1) {
		return { ok: false as const }
	}
	const payloadEncoded = token.slice(0, separatorIndex)
	const signatureEncoded = token.slice(separatorIndex + 1)
	const signatureBytes = decodeBase64Url(signatureEncoded)
	if (!signatureBytes) {
		return { ok: false as const }
	}
	const key = await importSimulationStreamKey(secret)
	const isValidSignature = await crypto.subtle.verify(
		'HMAC',
		key,
		signatureBytes,
		new TextEncoder().encode(payloadEncoded),
	)
	if (!isValidSignature) {
		return { ok: false as const }
	}
	const payloadBytes = decodeBase64Url(payloadEncoded)
	if (!payloadBytes) {
		return { ok: false as const }
	}
	try {
		const payload = JSON.parse(
			new TextDecoder().decode(payloadBytes),
		) as SimulationStreamTokenPayload
		if (payload.v !== simulationStreamTokenVersion) {
			return { ok: false as const }
		}
		if (!Number.isInteger(payload.ownerId) || payload.ownerId <= 0) {
			return { ok: false as const }
		}
		if (!Number.isFinite(payload.exp) || payload.exp <= now) {
			return { ok: false as const }
		}
		return {
			ok: true as const,
			ownerId: payload.ownerId,
			expiresAt: payload.exp,
		}
	} catch {
		return { ok: false as const }
	}
}
