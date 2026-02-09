import { access } from 'node:fs/promises'

const target = './types/worker-configuration.d.ts'
const shouldForce = process.env.FORCE_GENERATE_WORKER_TYPES === '1'

if (!shouldForce && (await fileExists(target))) {
	console.log(
		'Skipping worker type generation because the file already exists. Set FORCE_GENERATE_WORKER_TYPES=1 to regenerate.',
	)
	process.exit(0)
}

const proc = Bun.spawn(
	[process.execPath, './wrangler-env.ts', 'types', target],
	{
		stdio: ['inherit', 'inherit', 'inherit'],
	},
)

const exitCode = await proc.exited
process.exit(exitCode)

async function fileExists(path: string) {
	try {
		await access(path)
		return true
	} catch {
		return false
	}
}
