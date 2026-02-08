import { type BuildAction } from 'remix/fetch-router'
import { z } from 'zod'
import { logAuditEvent, getRequestIp } from '../audit-log.ts'
import { sendEmail } from '../email.ts'
import { toHex } from '../hex.ts'
import { normalizeEmail } from '../normalize-email.ts'
import { createPasswordHash } from '../password-hash.ts'
import type { AppEnv } from '../../types/env-schema.ts'
import { createDb, sql } from '../../worker/db.ts'
import type routes from '../routes.ts'

const passwordResetRequestSchema = z.object({
	email: z.string().min(1),
})

const passwordResetConfirmSchema = z.object({
	token: z.string().min(1),
	password: z.string().min(1),
})

const passwordResetTokenSchema = z.object({
	id: z.number(),
	user_id: z.number(),
	expires_at: z.number(),
	used_at: z.string().nullable(),
	email: z.string(),
})

const resetTokenBytes = 32
const resetTokenTtlMs = 1000 * 60 * 60

function jsonResponse(data: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			'Content-Type': 'application/json',
			...init?.headers,
		},
	})
}

function createResetToken() {
	const tokenBytes = new Uint8Array(resetTokenBytes)
	crypto.getRandomValues(tokenBytes)
	const token = toHex(tokenBytes)
	const expiresAt = Date.now() + resetTokenTtlMs
	return { token, expiresAt }
}

async function hashResetToken(token: string) {
	const data = new TextEncoder().encode(token)
	const digest = await crypto.subtle.digest('SHA-256', data)
	return toHex(new Uint8Array(digest))
}

function buildResetEmail(options: { resetUrl: string }): string {
	return `
<html>
	<body style="font-family: Arial, sans-serif; background: #f8fafc; padding: 24px;">
		<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
			<tr>
				<td align="center">
					<table width="480" cellpadding="0" cellspacing="0" role="presentation" style="background: #ffffff; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0;">
						<tr>
							<td>
								<h1 style="margin: 0 0 12px; font-size: 22px; color: #0f172a;">Reset your password</h1>
								<p style="margin: 0 0 16px; color: #475569;">
									We received a request to reset your password.
									If you did not request this, you can ignore this message.
								</p>
								<p style="margin: 0 0 20px;">
									<a href="${options.resetUrl}" style="background: #2563eb; color: #ffffff; padding: 10px 18px; border-radius: 999px; text-decoration: none; display: inline-block;">
										Reset password
									</a>
								</p>
								<p style="margin: 0 0 8px; color: #64748b; font-size: 14px;">
									Or copy and paste this link into your browser:
								</p>
								<p style="margin: 0; font-size: 14px; color: #1e293b; word-break: break-all;">
									${options.resetUrl}
								</p>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>
`.trim()
}

export function createPasswordResetHandlers(appEnv: AppEnv) {
	const db = createDb(appEnv.APP_DB)

	return {
		request: {
			middleware: [],
			async action({ request, url }) {
				let body: unknown

				try {
					body = await request.json()
				} catch {
					return jsonResponse(
						{ error: 'Invalid JSON payload.' },
						{ status: 400 },
					)
				}

				const parsed = passwordResetRequestSchema.safeParse(body)
				const normalizedEmail = parsed.success
					? normalizeEmail(parsed.data.email)
					: ''
				const requestIp = getRequestIp(request) ?? undefined

				if (!normalizedEmail) {
					void logAuditEvent({
						category: 'auth',
						action: 'password_reset_request',
						result: 'failure',
						email: normalizedEmail || undefined,
						ip: requestIp,
						path: url.pathname,
						reason: 'missing_email',
					})
					return jsonResponse({ error: 'Email is required.' }, { status: 400 })
				}

				const user = await db.queryFirst(
					sql`SELECT id FROM users WHERE email = ${normalizedEmail}`,
					z.object({ id: z.number() }),
				)

				if (!user) {
					void logAuditEvent({
						category: 'auth',
						action: 'password_reset_request',
						result: 'success',
						email: normalizedEmail,
						ip: requestIp,
						path: url.pathname,
						reason: 'user_not_found',
					})
					return jsonResponse({ ok: true })
				}

				const { token, expiresAt } = createResetToken()
				const tokenHash = await hashResetToken(token)
				await db.exec(
					sql`DELETE FROM password_reset_tokens WHERE user_id = ${user.id}`,
				)
				await db.exec(
					sql`
						INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
						VALUES (${user.id}, ${tokenHash}, ${expiresAt})
					`,
				)

				const resetUrl = new URL('/password-reset', request.url)
				resetUrl.searchParams.set('token', token)
				const emailHtml = buildResetEmail({
					resetUrl: resetUrl.toString(),
				})
				let sendResult: { ok: boolean }
				try {
					sendResult = await sendEmail(appEnv, {
						to: [normalizedEmail],
						subject: 'Reset your epicflare password',
						html: emailHtml,
					})
				} catch (error) {
					sendResult = { ok: false }
					console.warn('password-reset-email-failed', error)
				}

				void logAuditEvent({
					category: 'auth',
					action: 'password_reset_request',
					result: sendResult.ok ? 'success' : 'failure',
					email: normalizedEmail,
					ip: requestIp,
					path: url.pathname,
					reason: sendResult.ok ? undefined : 'email_send_failed',
				})

				return jsonResponse({ ok: true })
			},
		} satisfies BuildAction<
			typeof routes.passwordResetRequest.method,
			typeof routes.passwordResetRequest.pattern
		>,
		confirm: {
			middleware: [],
			async action({ request, url }) {
				let body: unknown

				try {
					body = await request.json()
				} catch {
					return jsonResponse(
						{ error: 'Invalid JSON payload.' },
						{ status: 400 },
					)
				}

				const parsed = passwordResetConfirmSchema.safeParse(body)
				const requestIp = getRequestIp(request) ?? undefined

				if (!parsed.success) {
					void logAuditEvent({
						category: 'auth',
						action: 'password_reset_confirm',
						result: 'failure',
						ip: requestIp,
						path: url.pathname,
						reason: 'missing_fields',
					})
					return jsonResponse(
						{ error: 'Token and password are required.' },
						{ status: 400 },
					)
				}

				const tokenHash = await hashResetToken(parsed.data.token)
				const record = await db.queryFirst(
					sql`
						SELECT password_reset_tokens.id,
							password_reset_tokens.user_id,
							password_reset_tokens.expires_at,
							password_reset_tokens.used_at,
							users.email
						FROM password_reset_tokens
						JOIN users ON users.id = password_reset_tokens.user_id
						WHERE password_reset_tokens.token_hash = ${tokenHash}
					`,
					passwordResetTokenSchema,
				)

				const now = Date.now()
				if (!record || record.used_at || record.expires_at <= now) {
					if (record?.expires_at && record.expires_at <= now) {
						await db.exec(
							sql`DELETE FROM password_reset_tokens WHERE id = ${record.id}`,
						)
					}
					void logAuditEvent({
						category: 'auth',
						action: 'password_reset_confirm',
						result: 'failure',
						email: record?.email,
						ip: requestIp,
						path: url.pathname,
						reason: !record
							? 'token_not_found'
							: record.used_at
								? 'token_used'
								: 'token_expired',
					})
					return jsonResponse(
						{ error: 'Invalid or expired reset token.' },
						{ status: 400 },
					)
				}

				const passwordHash = await createPasswordHash(parsed.data.password)
				await db.exec(
					sql`
						UPDATE users
						SET password_hash = ${passwordHash}, updated_at = CURRENT_TIMESTAMP
						WHERE id = ${record.user_id}
					`,
				)
				await db.exec(
					sql`
						UPDATE password_reset_tokens
						SET used_at = CURRENT_TIMESTAMP
						WHERE id = ${record.id}
					`,
				)

				void logAuditEvent({
					category: 'auth',
					action: 'password_reset_confirm',
					result: 'success',
					email: record.email,
					ip: requestIp,
					path: url.pathname,
				})

				return jsonResponse({ ok: true })
			},
		} satisfies BuildAction<
			typeof routes.passwordResetConfirm.method,
			typeof routes.passwordResetConfirm.pattern
		>,
	}
}
