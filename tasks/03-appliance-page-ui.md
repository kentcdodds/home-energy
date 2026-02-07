# Appliance page UI

Create a logged-in page that lets users manage appliances and see totals in the
Remix UI.

## Scope

- Add a dedicated logged-in page (not the home page)
- Show a form for adding appliances with watts or amps+volts
- Render a sorted list with delete actions and a total watts summary

## Acceptance criteria

- Logged-out users are redirected to login
- The page has a clear title and summary of total watts
- Adding an appliance updates the list and total
- Deleting an appliance removes it and updates the total
- The list shows name and watts for each appliance

## Testing

Automated: add or update Playwright coverage for add/delete and totals on the
logged-in page. Manual: sign in, add multiple appliances, delete one, and
confirm the list and total watts update correctly.
