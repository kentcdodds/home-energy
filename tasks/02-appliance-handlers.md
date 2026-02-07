# Appliance handlers and validation

Add server-side handlers for listing, adding, and deleting appliances with
simple validation and totals.

## Scope

- Create authenticated handlers for list, add, and delete
- Validate inputs with Zod, including watts or amps+volts conversion
- Compute total watts and return sorted results

## Acceptance criteria

- Unauthenticated requests redirect to login or return a 401
- Inputs require a name and either watts or amps+volts
- Amps+volts are converted to watts and only watts are stored
- List results are sorted by watts in a consistent order
- A total watts value is returned alongside the list

## Testing

Automated: add handler tests for validation errors, add/delete flows, and total
watts computation. Manual: submit valid and invalid forms in the UI and confirm
error messages, sorted list order, and total watts output.
