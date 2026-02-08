import { spawn, type ChildProcess } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { platform } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import getPort, { clearLockedPorts } from 'get-port'

const defaultWorkerPort = 3742
const defaultMockPort = 4599
const mockServerPattern = /^mock-[a-z0-9-]+-server\.ts$/i

const ansiReset = '\x1b[0m'
const ansiBright = '\x1b[1m'
const ansiDim = '\x1b[2m'

function colorize(text: string, color: string) {
	const bunColor = typeof Bun === 'undefined' ? null : Bun.color
	const colorCode = bunColor ? bunColor(color, 'ansi-16m') || '' : ''
	return colorCode ? `${colorCode}${text}${ansiReset}` : text
}

function bright(text: string) {
	return `${ansiBright}${text}${ansiReset}`
}

function dim(text: string) {
	return `${ansiDim}${text}${ansiReset}`
}

type OutputFilterKey = 'client' | 'worker' | 'default'

const outputFilters: Record<OutputFilterKey, Array<RegExp>> = {
	client: [],
	worker: [],
	default: [],
}

const extraArgs = process.argv.slice(2)
let shutdown: (() => void) | null = null
let devChildren: Array<ChildProcess> = []
let mockChildren: Array<ChildProcess> = []
let workerOrigin = ''

void startDev()

async function startDev() {
	await restartDev({ announce: false })
	setupInteractiveCli({
		getWorkerOrigin: () => workerOrigin,
		restart: restartDev,
	})
	shutdown = setupShutdown(() => devChildren, () => mockChildren)
}

function resolveWorkerOrigin(port: number) {
	const envOrigin = process.env.WORKER_DEV_ORIGIN
	if (envOrigin) return envOrigin.trim()
	return `http://localhost:${port}`
}

function runBunScript(
	script: string,
	args: Array<string> = [],
	envOverrides: Record<string, string> = {},
	options: { outputFilter?: OutputFilterKey } = {},
): ChildProcess {
	const bun = platform() === 'win32' ? 'bun.exe' : 'bun'
	const child = spawn(bun, ['run', '--silent', script, '--', ...args], {
		stdio: ['inherit', 'pipe', 'pipe'],
		env: { ...process.env, ...envOverrides },
	})

	pipeOutput(child, options.outputFilter)

	child.on('exit', (code, signal) => {
		if (signal) return
		if (code && code !== 0) {
			process.exitCode = code
		}
	})

	return child
}

function pipeOutput(
	child: ChildProcess,
	filterKey: OutputFilterKey = 'default',
) {
	const filters = outputFilters[filterKey]
	if (child.stdout) {
		pipeStream(child.stdout, process.stdout, filters)
	}
	if (child.stderr) {
		pipeStream(child.stderr, process.stderr, filters)
	}
}

function pipeStream(
	source: NodeJS.ReadableStream,
	target: NodeJS.WritableStream,
	filters: Array<RegExp>,
) {
	const rl = readline.createInterface({ input: source })
	rl.on('line', (line) => {
		if (filters.some((filter) => filter.test(line))) {
			return
		}
		target.write(`${line}\n`)
	})
}

function setupShutdown(
	getChildren: () => Array<ChildProcess>,
	getMockChildren: () => Array<ChildProcess>,
) {
	function doShutdown() {
		console.log(dim('\nShutting down...'))
		for (const child of [...getChildren(), ...getMockChildren()]) {
			if (!child.killed) {
				child.kill('SIGINT')
			}
		}

		setTimeout(() => {
			process.exit(0)
		}, 500)
	}

	process.on('SIGINT', doShutdown)
	process.on('SIGTERM', doShutdown)
	return doShutdown
}

function setupInteractiveCli(options: {
	getWorkerOrigin: () => string
	restart: () => Promise<void>
}) {
	const stdin = process.stdin
	if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return

	showHelp()
	logAppRunning(options.getWorkerOrigin)

	readline.emitKeypressEvents(stdin)
	stdin.setRawMode(true)
	stdin.resume()

	stdin.on('keypress', (_key, key) => {
		if (key?.ctrl && key.name === 'c') {
			shutdown?.()
			return
		}

		if (key?.name === 'return') {
			process.stdout.write('\n')
			return
		}

		switch (key?.name) {
			case 'o': {
				openInBrowser(options.getWorkerOrigin())
				break
			}
			case 'u': {
				copyToClipboard(options.getWorkerOrigin())
				break
			}
			case 'c': {
				console.clear()
				showHelp()
				logAppRunning(options.getWorkerOrigin)
				break
			}
			case 'r': {
				void options.restart()
				break
			}
			case 'h':
			case '?': {
				showHelp()
				break
			}
			case 'q': {
				shutdown?.()
				break
			}
		}
	})
}

function showHelp(header?: string) {
	if (header) console.log(header)
	console.log(`\n${bright('CLI shortcuts:')}`)
	console.log(
		`  ${colorize('o', 'cyan')} - ${colorize('open browser', 'green')}`,
	)
	console.log(
		`  ${colorize('u', 'cyan')} - ${colorize('copy URL', 'cornflowerblue')}`,
	)
	console.log(
		`  ${colorize('c', 'cyan')} - ${colorize('clear console', 'yellow')}`,
	)
	console.log(`  ${colorize('r', 'cyan')} - ${colorize('restart', 'orange')}`)
	console.log(`  ${colorize('h', 'cyan')} - ${colorize('help', 'magenta')}`)
	console.log(`  ${colorize('q', 'cyan')} - ${colorize('quit', 'firebrick')}`)
}

async function restartDev(
	{ announce }: { announce: boolean } = { announce: true },
) {
	await stopChildren([...devChildren, ...mockChildren])
	mockChildren = await startMockServers()
	const desiredPort = Number.parseInt(
		process.env.PORT ?? String(defaultWorkerPort),
		10,
	)
	const portRange = Array.from(
		{ length: 10 },
		(_, index) => desiredPort + index,
	)
	clearLockedPorts()
	const workerPort = await getPort({ port: portRange })
	workerOrigin = resolveWorkerOrigin(workerPort)
	const client = runBunScript(
		'dev:client',
		[],
		{},
		{
			outputFilter: 'client',
		},
	)
	const worker = runBunScript(
		'dev:worker',
		extraArgs,
		{ PORT: String(workerPort) },
		{ outputFilter: 'worker' },
	)
	devChildren = [client, worker]

	if (announce) {
		console.log(dim('\nRestarted dev servers.'))
		logAppRunning(() => workerOrigin)
	}
}

type MockServerScript = {
	name: string
	slug: string
	scriptPath: string
}

async function startMockServers(): Promise<Array<ChildProcess>> {
	const scripts = await discoverMockServerScripts()
	if (scripts.length === 0) {
		return []
	}

	const basePort = Number.parseInt(
		process.env.MOCK_API_PORT ?? String(defaultMockPort),
		10,
	)
	let nextPort = Number.isFinite(basePort) ? basePort : defaultMockPort

	return Promise.all(
		scripts.map(async (script) => {
			const portRange = Array.from(
				{ length: 10 },
				(_, index) => nextPort + index,
			)
			const port = await getPort({ port: portRange })
			nextPort = port + 1
			return runBunScript(
				script.scriptPath,
				[],
				{
					MOCK_API_PORT: String(port),
					MOCK_API_STORAGE_DIR: join('.mock-api', script.slug),
				},
				{ outputFilter: 'default' },
			)
		}),
	)
}

async function discoverMockServerScripts(): Promise<Array<MockServerScript>> {
	const toolsDir = join(process.cwd(), 'tools')
	const entries = await readdir(toolsDir, { withFileTypes: true }).catch(
		() => [],
	)
	const scripts = entries
		.filter(
			(entry) => entry.isFile() && mockServerPattern.test(entry.name),
		)
		.map((entry) => {
			const name = entry.name.replace(/\.ts$/i, '')
			const slug = name.replace(/-server$/i, '')
			return {
				name,
				slug,
				scriptPath: join('tools', entry.name),
			}
		})
		.sort((left, right) => left.name.localeCompare(right.name))

	return scripts
}

async function stopChildren(children: Array<ChildProcess>) {
	await Promise.all(children.map((child) => stopChild(child)))
}

async function stopChild(child: ChildProcess) {
	if (child.killed) return
	child.kill('SIGINT')
	const didExit = await waitForExit(child, 5000)
	if (didExit) return
	child.kill('SIGTERM')
	await waitForExit(child, 2000)
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
	return Promise.race([
		new Promise<boolean>((resolve) => {
			child.once('exit', () => resolve(true))
		}),
		delay(timeoutMs).then(() => false),
	])
}

function logAppRunning(getOrigin: () => string) {
	console.log(`\n${dim('App running at')} ${bright(getOrigin())}`)
}

function openInBrowser(url: string) {
	const os = platform()
	if (os === 'darwin') {
		spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
		return
	}

	if (os === 'win32') {
		spawn('cmd', ['/c', 'start', url], {
			stdio: 'ignore',
			detached: true,
		}).unref()
		return
	}

	spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
}

function copyToClipboard(text: string) {
	const os = platform()
	if (os === 'darwin') {
		const proc = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] })
		proc.stdin?.write(text)
		proc.stdin?.end()
		return
	}

	if (os === 'win32') {
		const proc = spawn('clip', [], { stdio: ['pipe', 'ignore', 'ignore'] })
		proc.stdin?.write(text)
		proc.stdin?.end()
		return
	}

	const proc = spawn('xclip', ['-selection', 'clipboard'], {
		stdio: ['pipe', 'ignore', 'ignore'],
	})
	proc.stdin?.write(text)
	proc.stdin?.end()
}
