import { createMockApiServer, createResendMockRoutes } from './mock-api.ts'

const port = Number.parseInt(process.env.MOCK_API_PORT ?? '4599', 10)
const storageDir = process.env.MOCK_API_STORAGE_DIR ?? '.mock-api'

const { baseUrl } = await createMockApiServer({
	port,
	storageDir,
	routes: createResendMockRoutes(),
})

console.info(`Mock API server listening on ${baseUrl}`)
