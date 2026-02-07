import { createRouter } from 'remix/fetch-router'
import account from './handlers/account.ts'
import { createAppliancesHandlers } from './handlers/appliances.ts'
import auth from './handlers/auth.ts'
import { login, signup } from './handlers/auth-pages.ts'
import health from './handlers/health.ts'
import home from './handlers/home.ts'
import logout from './handlers/logout.ts'
import session from './handlers/session.ts'
import { Layout } from './layout.ts'
import { render } from './render.ts'
import routes from './routes.ts'
import type { AppEnv } from '../types/env-schema.ts'

export function createAppRouter(appEnv: AppEnv) {
	const router = createRouter({
		middleware: [],
		async defaultHandler() {
			return render(Layout({}))
		},
	})

	router.map(routes.home, home)
	router.map(routes.health, health)
	router.map(routes.account, account)
	router.map(routes.login, login)
	router.map(routes.signup, signup)
	router.map(routes.session, session)
	router.post(routes.auth, auth)
	router.post(routes.logout, logout)

	const appliances = createAppliancesHandlers(appEnv)
	router.get(routes.appliances.index, appliances.index)
	router.post(routes.appliances.action, appliances.action)

	return router
}
