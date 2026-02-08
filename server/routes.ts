import { form, post, route } from 'remix/fetch-router'

const routes = route({
	home: '/',
	health: '/health',
	account: '/account',
	login: '/login',
	signup: '/signup',
	passwordReset: '/password-reset',
	logout: post('/logout'),
	session: '/session',
	auth: post('/auth'),
	passwordResetRequest: post('/password-reset'),
	passwordResetConfirm: post('/password-reset/confirm'),
	appliances: form('appliances'),
})

export default routes
