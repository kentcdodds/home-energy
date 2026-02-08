import { z } from 'zod'

const d1DatabaseSchema = z.custom<D1Database>((value) => Boolean(value), {
	message: 'Missing APP_DB binding.',
})

const optionalStringSchema = z.string().min(1).optional()
const optionalUrlSchema = z.string().url().optional()
const cloudflareEnvSchema = z
	.enum(['production', 'preview', 'test', 'development'])
	.optional()

export const EnvSchema = z.object({
	COOKIE_SECRET: z
		.string()
		.min(
			32,
			'COOKIE_SECRET must be at least 32 characters for session signing.',
		),
	APP_DB: d1DatabaseSchema,
	RESEND_API_KEY: optionalStringSchema,
	RESEND_API_BASE_URL: optionalUrlSchema,
	RESEND_FROM_EMAIL: optionalStringSchema,
	CLOUDFLARE_ENV: cloudflareEnvSchema,
})

export type AppEnv = z.infer<typeof EnvSchema>
