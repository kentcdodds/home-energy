import { type BuildAction } from 'remix/fetch-router'
import { html } from 'remix/html-template'
import { readAuthSession } from '../auth-session.ts'
import { Layout } from '../layout.ts'
import { render } from '../render.ts'
import type routes from '../routes.ts'

function escapeHtml(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function renderAccountNav(email: string) {
	const safeEmail = escapeHtml(email)
	return html`<nav
		style="display: flex; gap: var(--spacing-md); flex-wrap: wrap; align-items: center; margin-bottom: var(--spacing-xl);"
	>
		<a
			href="/"
			style="color: var(--color-primary); font-weight: var(--font-weight-medium); text-decoration: none;"
		>
			Home
		</a>
		<a
			href="/appliances"
			style="color: var(--color-primary); font-weight: var(--font-weight-medium); text-decoration: none;"
		>
			Appliances
		</a>
		<a
			href="/account"
			aria-current="page"
			style="color: var(--color-primary); font-weight: var(--font-weight-medium); text-decoration: none;"
		>
			${safeEmail}
		</a>
		<form method="post" action="/logout" style="margin: 0;">
			<button
				type="submit"
				style="padding: var(--spacing-xs) var(--spacing-md); border-radius: 999px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); font-weight: var(--font-weight-medium); cursor: pointer;"
			>
				Log out
			</button>
		</form>
	</nav>`
}

function renderAccount(email: string) {
	const safeEmail = escapeHtml(email)
	return html`<main
		style="max-width: 52rem; margin: 0 auto; padding: var(--spacing-page); font-family: var(--font-family);"
	>
		${renderAccountNav(email)}
		<section style="display: grid; gap: var(--spacing-md);">
			<h1
				style="font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); margin: 0;"
			>
				Welcome, ${safeEmail}
			</h1>
			<p style="margin: 0; color: var(--color-text-muted);">
				You are signed in to epicflare.
			</p>
		</section>
	</main>`
}

export default {
	middleware: [],
	async action({ request }) {
		const session = await readAuthSession(request)

		if (!session) {
			return Response.redirect(new URL('/login', request.url), 302)
		}

		return render(
			Layout({
				title: 'Welcome',
				entryScripts: false,
				children: renderAccount(session.email),
			}),
		)
	},
} satisfies BuildAction<
	typeof routes.account.method,
	typeof routes.account.pattern
>
