import {
	HomeRoute,
	LoginRoute,
	OAuthAuthorizeRoute,
	OAuthCallbackRoute,
} from './client-routes.tsx'
import { AppliancesRoute } from './appliances-route.tsx'
import { Router } from './client-router.tsx'
import { colors, spacing, typography } from './styles/tokens.ts'

export function App() {
	return () => (
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
				<a
					href="/"
					css={{
						color: colors.primaryText,
						fontWeight: typography.fontWeight.medium,
						textDecoration: 'none',
						'&:hover': {
							textDecoration: 'underline',
						},
					}}
				>
					Home
				</a>
				<a
					href="/login"
					css={{
						color: colors.primaryText,
						fontWeight: typography.fontWeight.medium,
						textDecoration: 'none',
						'&:hover': {
							textDecoration: 'underline',
						},
					}}
				>
					Login
				</a>
				<a
					href="/appliances"
					css={{
						color: colors.primaryText,
						fontWeight: typography.fontWeight.medium,
						textDecoration: 'none',
						'&:hover': {
							textDecoration: 'underline',
						},
					}}
				>
					Appliances
				</a>
				<a
					href="/signup"
					css={{
						color: colors.primaryText,
						fontWeight: typography.fontWeight.medium,
						textDecoration: 'none',
						'&:hover': {
							textDecoration: 'underline',
						},
					}}
				>
					Signup
				</a>
			</nav>
			<Router
				setup={{
					routes: {
						'/': HomeRoute(),
						'/login': LoginRoute('login'),
						'/signup': LoginRoute('signup'),
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
