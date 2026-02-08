import { type Handle } from 'remix/component'
import {
	AccountRoute,
	HomeRoute,
	LoginRoute,
	OAuthAuthorizeRoute,
	OAuthCallbackRoute,
	PasswordResetRoute,
} from './client-routes.tsx'
import { AppliancesRoute } from './appliances-route.tsx'
import { Router } from './client-router.tsx'
import { colors, spacing, typography } from './styles/tokens.ts'

type SessionStatus = 'idle' | 'loading' | 'ready'

export function App(handle: Handle) {
	let sessionStatus: SessionStatus = 'idle'
	let sessionEmail = ''

	handle.queueTask(async (signal) => {
		if (sessionStatus !== 'idle') return
		sessionStatus = 'loading'

		try {
			const response = await fetch('/session', {
				headers: { Accept: 'application/json' },
				credentials: 'include',
				signal,
			})
			if (signal.aborted) return
			const payload = await response.json().catch(() => null)
			const email =
				response.ok &&
				payload?.ok &&
				typeof payload?.session?.email === 'string'
					? payload.session.email.trim()
					: ''
			sessionEmail = email
		} catch {
			if (signal.aborted) return
			sessionEmail = ''
		}

		sessionStatus = 'ready'
		handle.update()
	})

	const navLinkCss = {
		color: colors.primary,
		fontWeight: typography.fontWeight.medium,
		textDecoration: 'none',
		'&:hover': {
			textDecoration: 'underline',
		},
	}

	const logOutButtonCss = {
		padding: `${spacing.xs} ${spacing.md}`,
		borderRadius: '999px',
		border: `1px solid ${colors.border}`,
		backgroundColor: 'transparent',
		color: colors.text,
		fontWeight: typography.fontWeight.medium,
		cursor: 'pointer',
	}

	return () => {
		const isSessionReady = sessionStatus === 'ready'
		const isLoggedIn = isSessionReady && Boolean(sessionEmail)
		const showAuthLinks = isSessionReady && !isLoggedIn

		return (
			<main
				css={{
					maxWidth: '52rem',
					margin: '0 auto',
					padding: spacing['2xl'],
					fontFamily: typography.fontFamily,
				}}
			>
				<nav
					css={{
						display: 'flex',
						gap: spacing.md,
						flexWrap: 'wrap',
						marginBottom: spacing.xl,
					}}
				>
					<a href="/" css={navLinkCss}>
						Home
					</a>
					{showAuthLinks ? (
						<>
							<a href="/login" css={navLinkCss}>
								Login
							</a>
							<a href="/signup" css={navLinkCss}>
								Signup
							</a>
						</>
					) : null}
					{isLoggedIn ? (
						<>
							<a href="/appliances" css={navLinkCss}>
								Appliances
							</a>
							<a href="/account" css={navLinkCss}>
								{sessionEmail}
							</a>
							<form method="post" action="/logout" css={{ margin: 0 }}>
								<button type="submit" css={logOutButtonCss}>
									Log out
								</button>
							</form>
						</>
					) : null}
				</nav>
				<Router
					setup={{
						routes: {
							'/': HomeRoute(),
							'/account': AccountRoute(),
							'/login': LoginRoute('login'),
							'/signup': LoginRoute('signup'),
							'/password-reset': PasswordResetRoute(),
							'/appliances': AppliancesRoute(),
							'/oauth/authorize': OAuthAuthorizeRoute(),
							'/oauth/callback': OAuthCallbackRoute(),
						},
						fallback: () => (
							<section>
								<h2
									css={{
										fontSize: typography.fontSize.lg,
										fontWeight: typography.fontWeight.semibold,
										marginBottom: spacing.sm,
										color: colors.text,
									}}
								>
									Not Found
								</h2>
								<p css={{ color: colors.textMuted }}>
									That route does not exist.
								</p>
							</section>
						),
					}}
				/>
			</main>
		)
	}
}
