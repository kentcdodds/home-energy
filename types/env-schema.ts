import { z } from 'zod'

const d1DatabaseSchema = z.custom<D1Database>((value) => Boolean(value), {
	message: 'Missing APP_DB binding.',
})

export const EnvSchema = z.object({
	COOKIE_SECRET: z
		.string()
		.min(1, 'Missing COOKIE_SECRET for session signing.'),
	APP_DB: d1DatabaseSchema,
})

export type AppEnv = z.infer<typeof EnvSchema>
