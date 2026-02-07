# Manual appliance page test

## Preconditions

- App running locally.
- Test account available (e.g. `user@example.com` / `password123`).

## Steps

1. Sign in at `/login`.
2. Visit `/appliances`.
3. Add an appliance with watts and notes (e.g. "Space heater" at 1500 W with
   "Living room outlet.").
4. Add an appliance with amps and volts (e.g. "Fan" at 1.5 A and 120 V).
5. Confirm the list shows both appliances, their watt values, and the notes on
   the first entry.
6. Confirm the total watts equals 1680 W.
7. Edit the "Space heater" entry to 1600 W, update the notes, and confirm the
   totals and notes update.
8. Delete the "Fan" entry.
9. Confirm the list removes "Fan" and the total updates to 1600 W.
10. Sign out or clear cookies, then visit `/appliances` and confirm redirect to
    `/login`.
