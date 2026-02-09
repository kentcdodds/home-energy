import { createRoot } from 'remix/component'
import { McpApplianceApp } from './mcp-appliance-app.tsx'

const rootElement = document.getElementById('root') ?? document.body
createRoot(rootElement).render(<McpApplianceApp />)
