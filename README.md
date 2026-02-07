<div align="center">
  <img src="./public/logo.png" alt="epicflare logo" width="400" />

  <p>
    <strong>A starter and reference for building full-stack web applications on Cloudflare Workers</strong>
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

epicflare is a full-stack starter kit for Cloudflare Workers that packages a
Remix 3 app, server routing, and MCP endpoints into a single Worker deployment.
It is designed as a reference implementation for building user-facing products
and tool-integrated APIs on the same edge runtime, with OAuth-protected access
for agent and automation clients.

## What You Get

- A single Worker entrypoint that routes OAuth, MCP, static assets, and Remix
  requests.
- Built-in MCP (Model Context Protocol) endpoints protected by OAuth flows.
- Cloudflare D1 (SQLite) for app data, KV for sessions, and Durable Objects for
  MCP state.
- Bun-first scripts, esbuild bundling, Playwright E2E testing, and CI-friendly
  workflows.
- A guided setup script to provision Cloudflare resources and environment
  variables.

## Ideal Uses

- Edge-hosted apps that need UI and APIs in one deployment.
- Internal tooling where agents or automations talk to the same backend as the
  UI.
- Rapid prototypes that lean on Cloudflare primitives without custom infra.

## Quick Start

```bash
bunx create-epicflare
```

This will clone the template, install dependencies, run the guided setup, and
start the dev server.

See [`docs/getting-started.md`](./docs/getting-started.md) for the full setup
paths and expectations.

## Tech Stack

| Layer           | Technology                                                            |
| --------------- | --------------------------------------------------------------------- |
| Runtime         | [Cloudflare Workers](https://workers.cloudflare.com/)                 |
| UI Framework    | [Remix 3](https://remix.run/) (alpha)                                 |
| Package Manager | [Bun](https://bun.sh/)                                                |
| Database        | [Cloudflare D1](https://developers.cloudflare.com/d1/)                |
| Session/OAuth   | [Cloudflare KV](https://developers.cloudflare.com/kv/)                |
| MCP State       | [Durable Objects](https://developers.cloudflare.com/durable-objects/) |
| E2E Testing     | [Playwright](https://playwright.dev/)                                 |
| Bundler         | [esbuild](https://esbuild.github.io/)                                 |

## How It Works

```
Request → worker/index.ts
              │
              ├─→ OAuth handlers
              ├─→ MCP endpoints
              ├─→ Static assets (public/)
              └─→ Server router → Remix components
```

- `worker/index.ts` is the entrypoint for Cloudflare Workers
- OAuth requests are handled first, then MCP requests, then static assets
- Non-asset requests fall through to the server handler and router
- Client assets are bundled into `public/` and served via the `ASSETS` binding

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
