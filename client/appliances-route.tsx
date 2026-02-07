import { type Handle } from 'remix/component'
import { navigate } from './client-router.tsx'
import {
	colors,
	radius,
	shadows,
	spacing,
	transitions,
	typography,
} from './styles/tokens.ts'

function buildLoginRedirect() {
	if (typeof window === 'undefined') return '/login'
	const url = new URL(window.location.href)
	const redirectTo = `${url.pathname}${url.search}`
	const params = new URLSearchParams({ redirectTo })
	return `/login?${params.toString()}`
}

function createTimeoutController(
	timeoutMs: number,
	parentSignal?: AbortSignal,
) {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
	let onParentAbort: (() => void) | undefined

	if (parentSignal) {
		if (parentSignal.aborted) {
			controller.abort()
		} else {
			onParentAbort = () => controller.abort()
			parentSignal.addEventListener('abort', onParentAbort, { once: true })
		}
	}

	return {
		controller,
		cancel: () => {
			clearTimeout(timeoutId)
			if (onParentAbort && parentSignal) {
				parentSignal.removeEventListener('abort', onParentAbort)
			}
		},
	}
}

type Appliance = {
	id: number
	name: string
	watts: number
	notes: string | null
	created_at: string
}

type AppliancesPayload =
	| { ok: true; appliances: Array<Appliance>; totalWatts: number }
	| { ok: false; error: string }

type AppliancesStatus = 'idle' | 'loading' | 'ready' | 'error'

function getPayloadError(payload: unknown) {
	if (
		typeof payload === 'object' &&
		payload !== null &&
		'error' in payload &&
		typeof (payload as { error?: unknown }).error === 'string'
	) {
		return (payload as { error: string }).error
	}
	return null
}

function AppliancesPage(handle: Handle) {
	let status: AppliancesStatus = 'loading'
	let appliances: Array<Appliance> = []
	let totalWatts = 0
	let message: string | null = null
	let isSubmitting = false
	let isLoadQueued = false

	async function loadAppliances(signal: AbortSignal) {
		const { controller, cancel } = createTimeoutController(10_000, signal)
		try {
			const response = await fetch('/appliances', {
				headers: { Accept: 'application/json' },
				credentials: 'include',
				signal: controller.signal,
			})

			if (signal.aborted) return

			if (response.status === 401) {
				navigate(buildLoginRedirect())
				return
			}

			const payload = (await response
				.json()
				.catch(() => null)) as AppliancesPayload | null

			if (!response.ok || !payload) {
				status = 'error'
				setMessage(getPayloadError(payload) ?? 'Unable to load appliances.')
				handle.update()
				return
			}

			setReadyState(payload)
			handle.update()
		} catch {
			if (signal.aborted) return
			status = 'error'
			setMessage('Unable to load appliances.')
			handle.update()
		} finally {
			isLoadQueued = false
			cancel()
			if (signal.aborted && status === 'loading') {
				handle.update()
			}
		}
	}

	function setMessage(nextMessage: string | null) {
		message = nextMessage
	}

	function setReadyState(payload: AppliancesPayload) {
		if (!payload.ok) {
			status = 'error'
			message = payload.error
			return
		}
		appliances = payload.appliances
		totalWatts = payload.totalWatts
		status = 'ready'
		message = null
	}

	async function submitForm(body: URLSearchParams): Promise<boolean> {
		let didSucceed = false
		if (isSubmitting) return false
		isSubmitting = true
		handle.update()

		const { controller, cancel } = createTimeoutController(10_000)
		try {
			const response = await fetch('/appliances', {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				credentials: 'include',
				body,
				signal: controller.signal,
			})

			if (response.status === 401) {
				isSubmitting = false
				handle.update()
				navigate(buildLoginRedirect())
				return didSucceed
			}

			if (!response.ok) {
				const payload = (await response
					.json()
					.catch(() => null)) as AppliancesPayload | null
				isSubmitting = false
				setMessage(getPayloadError(payload) ?? 'Unable to save appliance.')
				handle.update()
				return didSucceed
			}

			isSubmitting = false
			if (typeof window !== 'undefined') {
				window.location.assign('/appliances')
				return true
			}
			handle.update()
			didSucceed = true
		} catch {
			isSubmitting = false
			setMessage('Network error. Please try again.')
			handle.update()
		} finally {
			cancel()
		}
		return didSucceed
	}

	async function handleCreate(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		const form = event.currentTarget
		const formData = new FormData(form)
		formData.set('intent', 'create')
		const body = new URLSearchParams()
		for (const [key, value] of formData.entries()) {
			if (typeof value === 'string') {
				body.set(key, value)
			}
		}
		const didSucceed = await submitForm(body)
		if (didSucceed) {
			form.reset()
		}
	}

	async function handleDelete(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		const formData = new FormData(event.currentTarget)
		formData.set('intent', 'delete')
		const body = new URLSearchParams()
		for (const [key, value] of formData.entries()) {
			if (typeof value === 'string') {
				body.set(key, value)
			}
		}
		await submitForm(body)
	}

	return () => {
		if (status === 'loading' && !isLoadQueued) {
			isLoadQueued = true
			handle.queueTask(loadAppliances)
		}
		return (
			<section css={{ display: 'grid', gap: spacing.xl }}>
				<header css={{ display: 'grid', gap: spacing.xs }}>
					<h1
						css={{
							fontSize: typography.fontSize['2xl'],
							fontWeight: typography.fontWeight.semibold,
							margin: 0,
							color: colors.text,
						}}
					>
						Appliances
					</h1>
					<p css={{ margin: 0, color: colors.textMuted }}>
						Track your appliance energy usage and totals.
					</p>
				</header>

				<section
					css={{
						display: 'grid',
						gap: spacing.lg,
						padding: spacing.lg,
						borderRadius: radius.lg,
						border: `1px solid ${colors.border}`,
						backgroundColor: colors.surface,
						boxShadow: shadows.sm,
					}}
				>
					<div css={{ display: 'grid', gap: spacing.xs }}>
						<p
							css={{
								margin: 0,
								fontWeight: typography.fontWeight.medium,
								color: colors.text,
							}}
						>
							Total watts
						</p>
						<p
							css={{
								margin: 0,
								fontSize: typography.fontSize.xl,
								fontWeight: typography.fontWeight.semibold,
								color: colors.primaryText,
							}}
						>
							{totalWatts} W
						</p>
					</div>
					<form
						css={{ display: 'grid', gap: spacing.md }}
						on={{ submit: handleCreate }}
					>
						<label css={{ display: 'grid', gap: spacing.xs }}>
							<span
								css={{
									color: colors.text,
									fontWeight: typography.fontWeight.medium,
									fontSize: typography.fontSize.sm,
								}}
							>
								Appliance name
							</span>
							<input
								type="text"
								name="name"
								required
								placeholder="Space heater"
								css={{
									padding: spacing.sm,
									borderRadius: radius.md,
									border: `1px solid ${colors.border}`,
									fontSize: typography.fontSize.base,
									fontFamily: typography.fontFamily,
								}}
							/>
						</label>
						<label css={{ display: 'grid', gap: spacing.xs }}>
							<span
								css={{
									color: colors.text,
									fontWeight: typography.fontWeight.medium,
									fontSize: typography.fontSize.sm,
								}}
							>
								Notes (optional)
							</span>
							<textarea
								name="notes"
								rows={3}
								maxLength={500}
								placeholder="Located near the kitchen outlet."
								css={{
									padding: spacing.sm,
									borderRadius: radius.md,
									border: `1px solid ${colors.border}`,
									fontSize: typography.fontSize.base,
									fontFamily: typography.fontFamily,
									resize: 'vertical',
								}}
							/>
						</label>
						<div css={{ display: 'grid', gap: spacing.sm }}>
							<label css={{ display: 'grid', gap: spacing.xs }}>
								<span
									css={{
										color: colors.text,
										fontWeight: typography.fontWeight.medium,
										fontSize: typography.fontSize.sm,
									}}
								>
									Watts
								</span>
								<input
									type="number"
									name="watts"
									min="1"
									step="1"
									placeholder="1500"
									css={{
										padding: spacing.sm,
										borderRadius: radius.md,
										border: `1px solid ${colors.border}`,
										fontSize: typography.fontSize.base,
										fontFamily: typography.fontFamily,
									}}
								/>
							</label>
							<p css={{ margin: 0, color: colors.textMuted }}>
								Or enter amps and volts instead.
							</p>
							<div css={{ display: 'grid', gap: spacing.md }}>
								<label css={{ display: 'grid', gap: spacing.xs }}>
									<span
										css={{
											color: colors.text,
											fontWeight: typography.fontWeight.medium,
											fontSize: typography.fontSize.sm,
										}}
									>
										Amps
									</span>
									<input
										type="number"
										name="amps"
										min="0"
										step="0.1"
										placeholder="1.5"
										css={{
											padding: spacing.sm,
											borderRadius: radius.md,
											border: `1px solid ${colors.border}`,
											fontSize: typography.fontSize.base,
											fontFamily: typography.fontFamily,
										}}
									/>
								</label>
								<label css={{ display: 'grid', gap: spacing.xs }}>
									<span
										css={{
											color: colors.text,
											fontWeight: typography.fontWeight.medium,
											fontSize: typography.fontSize.sm,
										}}
									>
										Volts
									</span>
									<input
										type="number"
										name="volts"
										min="0"
										step="1"
										placeholder="120"
										css={{
											padding: spacing.sm,
											borderRadius: radius.md,
											border: `1px solid ${colors.border}`,
											fontSize: typography.fontSize.base,
											fontFamily: typography.fontFamily,
										}}
									/>
								</label>
							</div>
						</div>
						<button
							type="submit"
							disabled={isSubmitting}
							css={{
								padding: `${spacing.sm} ${spacing.lg}`,
								borderRadius: radius.full,
								border: 'none',
								backgroundColor: colors.primary,
								color: colors.onPrimary,
								fontSize: typography.fontSize.base,
								fontWeight: typography.fontWeight.semibold,
								cursor: isSubmitting ? 'not-allowed' : 'pointer',
								opacity: isSubmitting ? 0.7 : 1,
								transition: `transform ${transitions.fast}, background-color ${transitions.normal}`,
								'&:hover': isSubmitting
									? undefined
									: {
											backgroundColor: colors.primaryHover,
											transform: 'translateY(-1px)',
										},
								'&:active': isSubmitting
									? undefined
									: {
											backgroundColor: colors.primaryActive,
											transform: 'translateY(0)',
										},
							}}
						>
							{isSubmitting ? 'Adding...' : 'Add appliance'}
						</button>
					</form>
					{message ? (
						<p
							css={{ color: colors.error, fontSize: typography.fontSize.sm }}
							role="alert"
						>
							{message}
						</p>
					) : null}
				</section>

				<section css={{ display: 'grid', gap: spacing.md }}>
					<h2
						css={{
							fontSize: typography.fontSize.lg,
							fontWeight: typography.fontWeight.semibold,
							margin: 0,
							color: colors.text,
						}}
					>
						Appliance list
					</h2>
					{status === 'loading' ? (
						<p css={{ margin: 0, color: colors.textMuted }}>
							Loading appliances…
						</p>
					) : null}
					{status === 'ready' && appliances.length === 0 ? (
						<p css={{ margin: 0, color: colors.textMuted }}>
							No appliances added yet.
						</p>
					) : null}
					<ul
						css={{
							listStyle: 'none',
							padding: 0,
							margin: 0,
							display: 'grid',
							gap: spacing.sm,
						}}
					>
						{appliances.map((appliance) => (
							<li
								key={appliance.id}
								css={{
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'center',
									padding: spacing.md,
									borderRadius: radius.md,
									border: `1px solid ${colors.border}`,
									backgroundColor: colors.surface,
								}}
							>
								<div css={{ display: 'grid', gap: spacing.xs }}>
									<span
										css={{
											fontWeight: typography.fontWeight.medium,
											color: colors.text,
										}}
									>
										{appliance.name}
									</span>
									<span css={{ color: colors.textMuted }}>
										{appliance.watts} W
									</span>
									{appliance.notes ? (
										<span
											css={{
												color: colors.textMuted,
												fontSize: typography.fontSize.sm,
												whiteSpace: 'pre-wrap',
											}}
										>
											{appliance.notes}
										</span>
									) : null}
								</div>
								<form on={{ submit: handleDelete }}>
									<input type="hidden" name="id" value={appliance.id} />
									<button
										type="submit"
										disabled={isSubmitting}
										aria-label={`Delete ${appliance.name}`}
										css={{
											padding: `${spacing.xs} ${spacing.md}`,
											borderRadius: radius.full,
											border: `1px solid ${colors.border}`,
											backgroundColor: 'transparent',
											color: colors.text,
											fontSize: typography.fontSize.sm,
											fontWeight: typography.fontWeight.medium,
											cursor: isSubmitting ? 'not-allowed' : 'pointer',
											opacity: isSubmitting ? 0.7 : 1,
										}}
									>
										Delete
									</button>
								</form>
							</li>
						))}
					</ul>
				</section>
			</section>
		)
	}
}

export function AppliancesRoute() {
	return (_match: { path: string; params: Record<string, string> }) => (
		<AppliancesPage />
	)
}
