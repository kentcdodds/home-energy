/// <reference types="bun" />
import { beforeAll, expect, test } from 'bun:test'
import { RequestContext } from 'remix/fetch-router'
import { createAuthCookie, setAuthSessionSecret } from '../auth-session.ts'
import session from './session.ts'

function createSessionRequest(
	url: string,
	cookie?: string,
	method: string = 'GET',
) {
	const headers = new Headers()
	if (cookie) {
		headers.set('Cookie', cookie)
	}

	const request = new Request(url, { method, headers })
	const context = new RequestContext(request)

	return {
		run: () => session.action(context),
	}
}

beforeAll(() => {
	setAuthSessionSecret('test-cookie-secret')
})

test('session handler returns ok false when missing cookie', async () => {
	const sessionRequest = createSessionRequest('http://example.com/session')
	const response = await sessionRequest.run()
	expect(response.status).toBe(200)
	const payload = await response.json()
	expect(payload).toEqual({ ok: false })
})

test('session handler returns session info when cookie is present', async () => {
	const cookie = await createAuthCookie(
		{ id: 'user-id', email: 'user@example.com' },
		false,
	)
	const sessionRequest = createSessionRequest(
		'http://example.com/session',
		cookie,
	)
	const response = await sessionRequest.run()
	expect(response.status).toBe(200)
	const payload = await response.json()
	expect(payload).toEqual({
		ok: true,
		session: { email: 'user@example.com' },
	})
})
