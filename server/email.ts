import { z } from 'zod'
import type { AppEnv } from '../types/env-schema.ts'

const resendResponseSchema = z.object({ id: z.string() })

export type SendEmailRequest = {
	to: Array<string>
	subject: string
	html: string
}

type EmailConfig = {
	baseUrl: string
	apiKey: string | null
	fromEmail: string
	isProduction: boolean
}

function getEmailConfig(appEnv: AppEnv): EmailConfig {
	const baseUrl = appEnv.RESEND_API_BASE_URL ?? 'https://api.resend.com'
	const apiKey = appEnv.RESEND_API_KEY ?? null
	const fromEmail = appEnv.RESEND_FROM_EMAIL ?? 'no-reply@epicflare.dev'
	const envName = appEnv.CLOUDFLARE_ENV ?? 'production'
	const isProduction =
		envName === 'production' && baseUrl === 'https://api.resend.com'

	return {
		baseUrl,
		apiKey,
		fromEmail,
		isProduction,
	}
}

export async function sendEmail(appEnv: AppEnv, message: SendEmailRequest) {
	const config = getEmailConfig(appEnv)
	const payload = {
		from: config.fromEmail,
		to: message.to,
		subject: message.subject,
		html: message.html,
	}

	if (!config.apiKey && config.isProduction) {
		console.warn(
			'resend-api-key-missing',
			JSON.stringify({
				to: message.to,
				from: config.fromEmail,
				subject: message.subject,
				body: message.html,
			}),
		)
		return { ok: false, skipped: true }
	}

	const response = await fetch(new URL('/emails', config.baseUrl), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
		},
		body: JSON.stringify(payload),
	})
	const bodyText = await response.text()
	let jsonPayload: unknown = null
	if (bodyText) {
		try {
			jsonPayload = JSON.parse(bodyText)
		} catch {
			jsonPayload = bodyText
		}
	}
	const parsed = resendResponseSchema.safeParse(jsonPayload)

	if (!response.ok) {
		console.warn(
			'resend-send-failed',
			JSON.stringify({
				status: response.status,
				body: jsonPayload,
			}),
		)
	}

	return {
		ok: response.ok,
		id: parsed.success ? parsed.data.id : undefined,
	}
}
