import { type Handle } from 'remix/component'

type RouteMatch = {
	path: string
	params: Record<string, string>
}

type RouteView = (match: RouteMatch) => JSX.Element

type RouterSetup = {
	routes: Record<string, RouteView>
	fallback?: RouteView
}

const routerEvents = new EventTarget()
let routerInitialized = false

function notify() {
	routerEvents.dispatchEvent(new Event('navigate'))
}

function compileRoutePattern(pattern: string) {
	const paramNames: Array<string> = []
	const regexPattern = pattern
		.replace(/:([^/]+)/g, (_, name) => {
			paramNames.push(name)
			return '([^/]+)'
		})
		.replace(/\*/g, '.*')

	return {
		pattern: new RegExp(`^${regexPattern}$`),
		paramNames,
	}
}

function matchRoute(
	path: string,
	routes: Record<string, RouteView>,
): { view: RouteView; match: RouteMatch } | null {
	for (const [pattern, view] of Object.entries(routes)) {
		const { pattern: compiled, paramNames } = compileRoutePattern(pattern)
		const result = compiled.exec(path)
		if (!result) continue

		const params: Record<string, string> = {}
		paramNames.forEach((name, index) => {
			const value = result[index + 1]
			if (value !== undefined) params[name] = value
		})

		return {
			view,
			match: { path, params },
		}
	}

	return null
}

function ensureRouter() {
	if (routerInitialized) return
	routerInitialized = true
	window.addEventListener('popstate', notify)
}

export function getPathname() {
	if (typeof window === 'undefined') return '/'
	return window.location.pathname
}

export function navigate(to: string) {
	if (typeof window === 'undefined') return
	// Remix router bug prevents reliable client navigation right now.
	// Force full reloads; in the next Remix version we can restore SPA navigation.
	window.location.assign(to)
}

export function Router(handle: Handle, setup: RouterSetup) {
	ensureRouter()
	handle.on(routerEvents, { navigate: () => handle.update() })

	return () => {
		const path = getPathname()
		const result = matchRoute(path, setup.routes)
		if (result) {
			return result.view(result.match)
		}

		return setup.fallback ? setup.fallback({ path, params: {} }) : null
	}
}
