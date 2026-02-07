import { form, post, route } from 'remix/fetch-router'

const routes = route({
	home: '/',
	health: '/health',
	account: '/account',
	session: '/session',
	auth: post('/auth'),
	appliances: form('appliances'),
})

export default routes
