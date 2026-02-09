import { form, post, route } from 'remix/fetch-router'

const routes = route({
	home: '/',
	health: '/health',
	account: '/account',
	login: '/login',
	signup: '/signup',
	logout: post('/logout'),
	passwordResetRequest: post('/password-reset'),
	passwordResetConfirm: post('/password-reset/confirm'),
	session: '/session',
	auth: post('/auth'),
	appliances: form('appliances'),
})

export default routes
