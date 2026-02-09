# MCP appliance tools

Expose appliance list and management actions through the MCP server so totals
are available outside the Remix UI.

## Scope

- Replace the math demo tool with appliance-focused tools
- Ensure MCP requests are scoped to the authenticated user
- Provide tools for list, add, delete, and total watts
- Provide an MCP App launch tool/resource pair for interactive appliance
  simulation controls

## Acceptance criteria

- MCP tools exist for listing appliances and getting total watts
- MCP tools exist for adding and deleting appliances
- Each tool uses the authenticated user context from MCP auth
- Tool responses are structured and include watts values
- MCP Apps hosts can launch a `ui://...` appliance simulator resource via a
  linked tool (`_meta.ui.resourceUri`)

## MCP server best practices (from reference servers)

- Design tools for LLMs, not a 1:1 API mirror: keep names clear, add helpful
  descriptions, and provide smart defaults so fewer calls are needed.
- Favor discovery-first flows: provide a single tool that returns needed IDs or
  metadata to reduce follow-up calls and confusion.
- Batch operations where possible (e.g. add/delete multiple items) to reduce
  tool-call count.
- Validate inputs with strict schemas; return friendly, actionable validation
  errors instead of raw exceptions.
- Return structured output that matches declared schemas, and include a concise
  human-readable summary in `content` for clarity.
- Mark tools with annotations (read-only, destructive, idempotent) so clients
  can apply appropriate UX safeguards.
- Support cancellation: pass request metadata through to tools and abort
  long-running work when the client cancels.
- Separate client auth from provider credentials; avoid leaking provider tokens
  to clients and store secrets securely.
- Provide basic operational endpoints and metadata (health, server info,
  protocol version support) for easier debugging and deployment.

## Testing

Automated: extend MCP server tests to cover list/add/delete, totals, and MCP app
launch payloads. Manual: use an MCP client/host to add an appliance, list
appliances, read total watts, then launch the appliance simulator app.
