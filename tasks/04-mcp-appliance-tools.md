# MCP appliance tools

Expose appliance list and management actions through the MCP server so totals
are available outside the Remix UI.

## Scope

- Replace the math demo tool with appliance-focused tools
- Ensure MCP requests are scoped to the authenticated user
- Provide tools for list, add, delete, and total watts

## Acceptance criteria

- MCP tools exist for listing appliances and getting total watts
- MCP tools exist for adding and deleting appliances
- Each tool uses the authenticated user context from MCP auth
- Tool responses are structured and include watts values

## Testing

Automated: extend MCP server tests to cover list/add/delete and totals. Manual:
use an MCP client to add an appliance, list appliances, and read the total watts
response.
