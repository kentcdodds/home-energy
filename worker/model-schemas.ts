import { z } from 'zod'

export const userSchema = z.object({
	id: z.number(),
	username: z.string(),
	email: z.string(),
	password_hash: z.string(),
	created_at: z.string(),
	updated_at: z.string(),
})

export type UserRecord = z.infer<typeof userSchema>

export const userIdSchema = userSchema.pick({ id: true })
export type UserIdRecord = z.infer<typeof userIdSchema>

export const userPasswordSchema = userSchema.pick({ password_hash: true })
export type UserPasswordRecord = z.infer<typeof userPasswordSchema>

export const passwordResetTokenSchema = z.object({
	id: z.number(),
	user_id: z.number(),
	token_hash: z.string(),
	expires_at: z.number(),
	created_at: z.string(),
	used_at: z.string().nullable(),
})

export type PasswordResetTokenRecord = z.infer<typeof passwordResetTokenSchema>

export const passwordResetTokenLookupSchema = passwordResetTokenSchema.pick({
	id: true,
	user_id: true,
	expires_at: true,
	used_at: true,
})

export type PasswordResetTokenLookupRecord = z.infer<
	typeof passwordResetTokenLookupSchema
>

export const applianceSchema = z.object({
	id: z.number(),
	owner_id: z.number(),
	name: z.string(),
	watts: z.number(),
	notes: z.string().nullable(),
	created_at: z.string(),
})

export type ApplianceRecord = z.infer<typeof applianceSchema>

export const applianceSummarySchema = applianceSchema.pick({
	id: true,
	name: true,
	watts: true,
	notes: true,
	created_at: true,
})
export type ApplianceSummary = z.infer<typeof applianceSummarySchema>
