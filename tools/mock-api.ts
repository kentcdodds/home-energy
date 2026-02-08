import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

export type MockApiRequestRecord = {
	id: string
	routeId: string | null
	method: string
	pathname: string
	query: Record<string, string>
	headers: Record<string, string>
	body: string | null
	timestamp: string
}

type MockApiRoute = {
	id: string
	method: string
	pathname: string | RegExp
	handler?: (request: {
		url: URL
		method: string
		headers: Headers
		body: string | null
	}) => Promise<MockApiResponse> | MockApiResponse
}

type MockApiResponse = {
	status?: number
	headers?: Record<string, string>
	body?: string | object | null
}

type MockApiServerOptions = {
	port: number
	storageDir: string
	routes: Array<MockApiRoute>
}

const mockApiRequestSchema = z.object({
	id: z.string(),
	routeId: z.string().nullable(),
	method: z.string(),
	pathname: z.string(),
	query: z.record(z.string(), z.string()),
	headers: z.record(z.string(), z.string()),
	body: z.string().nullable(),
	timestamp: z.string(),
})

export const resendEmailPayloadSchema = z.object({
	from: z.string(),
	to: z.array(z.string()).or(z.string()),
	subject: z.string(),
	html: z.string(),
})

export async function createMockApiServer(options: MockApiServerOptions) {
	const requestsDir = join(options.storageDir, 'requests')
	await mkdir(requestsDir, { recursive: true })

	const server = Bun.serve({
		port: options.port,
		async fetch(request) {
			const url = new URL(request.url)
			const body = request.method === 'GET' ? null : await request.text()
			const route = matchRoute(options.routes, request.method, url.pathname)
			const record: MockApiRequestRecord = {
				id: crypto.randomUUID(),
				routeId: route?.id ?? null,
				method: request.method,
				pathname: url.pathname,
				query: Object.fromEntries(url.searchParams.entries()),
				headers: Object.fromEntries(request.headers.entries()),
				body: body || null,
				timestamp: new Date().toISOString(),
			}
			await writeFile(
				join(requestsDir, `${Date.now()}-${record.id}.json`),
				JSON.stringify(record, null, 2),
			)

			const response = route?.handler
				? await route.handler({
						url,
						method: request.method,
						headers: request.headers,
						body: body || null,
					})
				: {
						status: 404,
						body: { error: 'Route not mocked.' },
					}

			return buildResponse(response)
		},
	})

	return {
		server,
		baseUrl: `http://127.0.0.1:${server.port}`,
		storageDir: options.storageDir,
		requestsDir,
		close: () => server.stop(true),
	}
}

export function createResendMockRoutes(): Array<MockApiRoute> {
	return [
		{
			id: 'resend.send-email',
			method: 'POST',
			pathname: '/emails',
			handler: ({ body }) => {
				let payload: unknown = null
				if (body) {
					try {
						payload = JSON.parse(body)
					} catch {
						return {
							status: 400,
							body: { error: 'Invalid JSON payload.' },
						}
					}
				}
				const parsed = resendEmailPayloadSchema.safeParse(payload)
				if (!parsed.success) {
					return {
						status: 422,
						body: { error: 'Invalid email payload.' },
					}
				}
				return {
					status: 200,
					body: { id: `mock_${crypto.randomUUID()}` },
				}
			},
		},
	]
}

export async function readMockApiRequests(storageDir: string) {
	const requestsDir = join(storageDir, 'requests')
	const entries = await readdir(requestsDir).catch(() => [])
	const records = await Promise.all(
		entries.map(async (entry) => {
			const raw = await readFile(join(requestsDir, entry), 'utf-8')
			const parsed = mockApiRequestSchema.safeParse(JSON.parse(raw))
			return parsed.success ? parsed.data : null
		}),
	)
	return records.filter((record): record is MockApiRequestRecord =>
		Boolean(record),
	)
}

function matchRoute(
	routes: Array<MockApiRoute>,
	method: string,
	pathname: string,
) {
	return routes.find((route) => {
		if (route.method.toUpperCase() !== method.toUpperCase()) return false
		if (typeof route.pathname === 'string') {
			return route.pathname === pathname
		}
		return route.pathname.test(pathname)
	})
}

function buildResponse(response: MockApiResponse) {
	const status = response.status ?? 200
	const headers = new Headers(response.headers ?? {})
	if (response.body === undefined || response.body === null) {
		return new Response(null, { status, headers })
	}

	if (typeof response.body === 'string') {
		if (!headers.has('Content-Type')) {
			headers.set('Content-Type', 'text/plain')
		}
		return new Response(response.body, { status, headers })
	}

	if (!headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json')
	}
	return new Response(JSON.stringify(response.body), { status, headers })
}
