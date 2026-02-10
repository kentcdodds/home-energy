<div align="center">
  <img src="./public/logo.png" alt="epicflare logo" width="400" />

  <p>
    <strong>Home Energy helps you track appliance energy usage and total watts</strong>
  </p>

  <p>
    <a href="https://github.com/epicweb-dev/epicflare/actions/workflows/deploy.yml"><img src="https://img.shields.io/github/actions/workflow/status/epicweb-dev/epicflare/deploy.yml?branch=main&style=flat-square&logo=github&label=CI" alt="Build Status" /></a>
    <img src="https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Bun-run-f9f1e1?style=flat-square&logo=bun&logoColor=white" alt="Bun" />
    <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
    <img src="https://img.shields.io/badge/Remix-3.0_alpha-000000?style=flat-square&logo=remix&logoColor=white" alt="Remix" />
  </p>
</div>

---

Home Energy is a small web app for tracking household appliance energy usage.
Sign in, add appliances with their wattage (or amps + volts), and the app
calculates total watts across your list. Keep the list current by deleting items
as needed, and use MCP tools to read totals or manage appliances from automation
clients.

## What It Does

- Lets you add appliances by watts or by amps + volts (stored as watts).
- Shows a running total of watts across all appliances.
- Supports deleting appliances to keep totals accurate.
- Exposes MCP tools for list, add, edit, delete, and total-watts flows.
- Exposes app-linked MCP simulation tools for reading and updating per-appliance
  knobs (`get_appliance_simulation_state`, `set_appliance_simulation_controls`,
  and `reset_appliance_simulation_controls`).
- Exposes an MCP App launch tool (`open_appliance_energy_app`) that opens an
  interactive appliance simulation UI in MCP Apps-compatible hosts.

## Who It Is For

- People estimating household loads or comparing appliance usage.
- Teams that want a simple, auditable energy-usage list with automation hooks.

## MCP App: Appliance Energy Simulator

The MCP server now includes an app-launch tool that opens an interactive
simulator UI with per-appliance knobs. App-side interactions stay local to the
UI session, and server simulation tools keep a session-scoped control state so
models can iteratively adjust scenarios. While the app is open, tool-result
notifications now rehydrate the visible UI so model tool calls update the chart
and controls in place. The app also requests fullscreen mode on connect when
the host supports it. Both flows calculate:

- Per-appliance daily kWh
- Total daily kWh
- Average watts and peak watts
- 24-hour aggregated load profile

Per-appliance knobs:

- enabled
- hours per day
- duty cycle percent
- start hour
- quantity
- optional override watts

Models can now twist those knobs via server tools (not only inside the app
runtime), which aligns with the Excalidraw MCP Apps pattern of exposing
model-callable app tools on the server.

## Project Lineage

Home Energy is based on the epicflare starter kit.

## Development Quick Start

```bash
bun install
bun run dev
```

This installs dependencies and starts the local dev server.

See [`docs/getting-started.md`](./docs/getting-started.md) for the full setup
paths and expectations.

## Documentation

| Document                                                           | Description                          |
| ------------------------------------------------------------------ | ------------------------------------ |
| [`docs/getting-started.md`](./docs/getting-started.md)             | Setup, environment variables, deploy |
| [`docs/environment-variables.md`](./docs/environment-variables.md) | Adding new env vars                  |
| [`docs/agents/setup.md`](./docs/agents/setup.md)                   | Local development and verification   |

---

<div align="center">
  <sub>Built with ❤️ by <a href="https://epicweb.dev">Epic Web</a></sub>
</div>
