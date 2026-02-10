import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { MCP } from '../mcp/index.ts'
import { handleRequest } from '../server/handler.ts'
import { simulationHubConnectPath, SimulationHub } from './simulation-hub.ts'
import {
	simulationStreamPath,
	verifySimulationStreamToken,
} from './simulation-stream-auth.ts'
import {
	apiHandler,
	handleAuthorizeRequest,
	handleAuthorizeInfo,
	handleOAuthCallback,
	oauthPaths,
	oauthScopes,
} from './oauth-handlers.ts'
import {
	handleMcpRequest,
	handleProtectedResourceMetadata,
	isProtectedResourceMetadataRequest,
	mcpResourcePath,
} from './mcp-auth.ts'
import { withCors } from './utils.ts'

type SimulationHubBindingEnv = Env & {
	SIMULATION_HUB: DurableObjectNamespace
}

async function handleSimulationStreamRequest(request: Request, env: Env) {
	const upgradeHeader = request.headers.get('Upgrade')
	if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
		return new Response('Expected websocket upgrade.', { status: 426 })
	}
	const url = new URL(request.url)
	const token = url.searchParams.get('token')
	if (!token) {
		return new Response('Missing simulation stream token.', { status: 401 })
	}
	const tokenResult = await verifySimulationStreamToken({
		secret: env.COOKIE_SECRET,
		token,
	})
	if (!tokenResult.ok) {
		return new Response('Invalid simulation stream token.', { status: 401 })
	}
	const simulationEnv = env as SimulationHubBindingEnv
	const hubId = simulationEnv.SIMULATION_HUB.idFromName(
		`owner:${tokenResult.ownerId}`,
	)
	const hub = simulationEnv.SIMULATION_HUB.get(hubId)
	const hubUrl = new URL(request.url)
	hubUrl.pathname = simulationHubConnectPath
	hubUrl.search = ''
	return hub.fetch(new Request(hubUrl.toString(), request))
}

export { MCP, SimulationHub }

const appHandler = withCors({
	getCorsHeaders(request) {
		const origin = request.headers.get('Origin')
		if (!origin) return null
		const requestOrigin = new URL(request.url).origin
		if (origin !== requestOrigin) return null
		return {
			'Access-Control-Allow-Origin': origin,
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'content-type, authorization',
			Vary: 'Origin',
		}
	},
	async handler(request, env, ctx) {
		const url = new URL(request.url)

		if (url.pathname === oauthPaths.authorize) {
			return handleAuthorizeRequest(request, env)
		}

		if (url.pathname === oauthPaths.authorizeInfo) {
			return handleAuthorizeInfo(request, env)
		}

		if (url.pathname === oauthPaths.callback) {
			return handleOAuthCallback(request)
		}

		if (url.pathname === '/.well-known/appspecific/com.chrome.devtools.json') {
			return new Response(null, { status: 204 })
		}

		if (isProtectedResourceMetadataRequest(url.pathname)) {
			return handleProtectedResourceMetadata(request)
		}

		if (url.pathname === mcpResourcePath) {
			return handleMcpRequest({
				request,
				env,
				ctx,
				fetchMcp: MCP.serve(mcpResourcePath, {
					binding: 'MCP_OBJECT',
				}).fetch,
			})
		}

		if (url.pathname === simulationStreamPath) {
			return handleSimulationStreamRequest(request, env)
		}

		// Try to serve static assets for safe methods only
		if (env.ASSETS && (request.method === 'GET' || request.method === 'HEAD')) {
			const response = await env.ASSETS.fetch(request)
			if (response.ok) {
				return response
			}
		}

		return handleRequest(request, env)
	},
})

const oauthProvider = new OAuthProvider({
	apiRoute: oauthPaths.apiPrefix,
	apiHandler,
	defaultHandler: {
		fetch(request, env, ctx) {
			// @ts-expect-error https://github.com/cloudflare/workers-oauth-provider/issues/71
			return appHandler(request, env, ctx)
		},
	},
	authorizeEndpoint: oauthPaths.authorize,
	tokenEndpoint: oauthPaths.token,
	clientRegistrationEndpoint: oauthPaths.register,
	scopesSupported: oauthScopes,
})

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		return oauthProvider.fetch(request, env, ctx)
	},
} satisfies ExportedHandler<Env>
