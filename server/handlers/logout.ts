import { type BuildAction } from 'remix/fetch-router'
import { clearAuthCookie } from '../auth-session.ts'
import type routes from '../routes.ts'

function isSecureRequest(request: Request) {
	return new URL(request.url).protocol === 'https:'
}

export default {
	middleware: [],
	async action({ request }) {
		const cookie = await clearAuthCookie(isSecureRequest(request))
		return new Response(null, {
			status: 302,
			headers: {
				Location: new URL('/login', request.url).toString(),
				'Set-Cookie': cookie,
			},
		})
	},
} satisfies BuildAction<
	typeof routes.logout.method,
	typeof routes.logout.pattern
>
