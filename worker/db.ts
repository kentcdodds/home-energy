import { z } from 'zod'

type D1Value = string | number | boolean | null | ArrayBuffer | Uint8Array

export type DbQuery<Params extends ReadonlyArray<D1Value>> = {
	sql: string
	params: Params
}

type ZodSchema<T> = z.ZodType<T>

export function sql<Params extends ReadonlyArray<D1Value>>(
	strings: TemplateStringsArray,
	...params: Params
): DbQuery<Params> {
	const sqlText = strings.reduce(
		(accumulator, chunk, index) =>
			`${accumulator}${chunk}${index < params.length ? '?' : ''}`,
		'',
	)
	return { sql: sqlText, params }
}

const writeRetryDelaysMs = [50, 150, 300]

function isWriteQuery(sqlText: string) {
	return /^(insert|update|delete|replace|create|drop|alter)\b/i.test(
		sqlText.trim(),
	)
}

function isWriteDisabledError(error: unknown) {
	return (
		error instanceof Error &&
		/write action is temporarily disabled/i.test(error.message)
	)
}

function sleep(delayMs: number) {
	return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function withWriteRetry<T>(action: () => Promise<T>) {
	let lastError: unknown = null
	for (const delayMs of [0, ...writeRetryDelaysMs]) {
		if (delayMs) {
			await sleep(delayMs)
		}
		try {
			return await action()
		} catch (error) {
			if (!isWriteDisabledError(error)) {
				throw error
			}
			lastError = error
		}
	}
	throw lastError ?? new Error('Write retry failed with unknown error')
}

export function createDb(db: D1Database) {
	function prepare<Params extends ReadonlyArray<D1Value>>(
		query: DbQuery<Params>,
	) {
		return db.prepare(query.sql).bind(...query.params)
	}

	return {
		async queryFirst<T, Params extends ReadonlyArray<D1Value>>(
			query: DbQuery<Params>,
			schema: ZodSchema<T>,
		): Promise<T | null> {
			const row = isWriteQuery(query.sql)
				? await withWriteRetry(() => prepare(query).first())
				: await prepare(query).first()
			if (!row) return null
			return schema.parse(row) as T
		},
		async queryAll<T, Params extends ReadonlyArray<D1Value>>(
			query: DbQuery<Params>,
			schema: ZodSchema<T>,
		): Promise<Array<T>> {
			const result = await prepare(query).all()
			const rows = Array.isArray(result?.results) ? result.results : []
			return schema.array().parse(rows) as Array<T>
		},
		async exec<Params extends ReadonlyArray<D1Value>>(query: DbQuery<Params>) {
			if (!isWriteQuery(query.sql)) {
				return prepare(query).run()
			}
			return withWriteRetry(() => prepare(query).run())
		},
	}
}
