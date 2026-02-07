import { type BuildAction } from 'remix/fetch-router'
import { readAuthSession } from '../auth-session.ts'
import { Layout } from '../layout.ts'
import { render } from '../render.ts'
import type routes from '../routes.ts'

function normalizeRedirectTo(value: string | null) {
	if (!value) return null
	if (!value.startsWith('/')) return null
	if (value.startsWith('//')) return null
	return value
}

async function renderAuthPage(request: Request) {
	const session = await readAuthSession(request)
	if (session) {
		const url = new URL(request.url)
		const redirectTo = normalizeRedirectTo(url.searchParams.get('redirectTo'))
		const redirectTarget = redirectTo ?? '/account'
		return Response.redirect(new URL(redirectTarget, request.url), 302)
	}
	return render(Layout({}))
}

export const login = {
	middleware: [],
	async action({ request }) {
		return renderAuthPage(request)
	},
} satisfies BuildAction<typeof routes.login.method, typeof routes.login.pattern>

export const signup = {
	middleware: [],
	async action({ request }) {
		return renderAuthPage(request)
	},
} satisfies BuildAction<
	typeof routes.signup.method,
	typeof routes.signup.pattern
>
