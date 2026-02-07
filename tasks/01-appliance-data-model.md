# Appliance data model

Define the storage layer for appliances so they can be owned by a user, queried
efficiently, and extended later without breaking the MVP.

## Scope

- Add a new D1 migration for an appliances table owned by a user
- Store watts as the canonical value
- Provide DB helpers for CRUD operations with Zod parsing

## Acceptance criteria

- A new migration creates an appliances table tied to a user identifier
- The table stores at least: id, owner reference, name, watts, created_at
- Indexes exist to efficiently query appliances by owner
- DB helpers return typed results and validate rows via Zod
- No other tables are modified outside of the new migration

## Testing

Automated: add or update tests that create a user, insert appliances, and query
by owner using the DB helper layer. Manual: run local migrations, insert a
sample appliance, and verify the row round-trips with the expected watts value.
