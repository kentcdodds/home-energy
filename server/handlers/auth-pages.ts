import { type BuildAction } from 'remix/fetch-router'
import { readAuthSession } from '../auth-session.ts'
import { Layout } from '../layout.ts'
import { render } from '../render.ts'
import type routes from '../routes.ts'

async function renderAuthPage(request: Request) {
	const session = await readAuthSession(request)
	if (session) {
		return Response.redirect(new URL('/account', request.url), 302)
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
