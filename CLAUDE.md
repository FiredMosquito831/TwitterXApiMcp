# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                  # npm workspaces, Node >= 24
npm run build                # tsc -b across project references (order matters)
npm test                     # build + all five test phases

node packages/cli/dist/index.js --help
node packages/cli/dist/index.js ops
node packages/cli/dist/index.js posts create --text "hi" --dry-run   # no credentials needed
node packages/cli/dist/index.js auth status
node packages/cli/dist/index.js config set-unofficial on --i-understand

node scripts/test-core.mjs        # PKCE, pricing, limiter, state, cookies, materials
node scripts/test-ops.mjs         # operation behavior with a fake transport
node scripts/verify-registry.mjs  # names, annotations, cost fns, unofficial warnings
node scripts/mcp-smoke.mjs        # real stdio handshake + tools/list
node scripts/test-mcp.mjs         # operations_search / operations_invoke

npm run package:build             # bundles for npm/, plugin server, pip/ vendor
npm run package:pack              # build + npm pack inside npm/
node npm/bin/xctl.mjs --help      # test the bundled CLI
MCP_ENTRY=npm/dist/mcp.mjs node scripts/mcp-smoke.mjs
MCP_ENTRY=plugins/xctl/servers/xctl.mjs node scripts/mcp-smoke.mjs
```

## Architecture

Five packages, dependency direction `core ← ops ← {unofficial, cli, mcp}`:

- **`packages/core`** — everything infrastructure: `OfficialTransport` over X API v2, OAuth 2.0 PKCE (`oauth.ts`), keychain-backed credential store with a 0600 file fallback (`credentials.ts`), JSON config (`config.ts`), `node:sqlite` state with an in-memory fallback (`state.ts`), header-seeded rate limiter, and the USD spend meter. `createRuntime()` is **async** because it may refresh tokens and open state.
- **`packages/ops`** — the operation registry: 49 official operations, each declaring zod input/output, rate class, cost, MCP annotations and `run()`. `run()` must not import commander, the MCP SDK, or a transport implementation.
- **`packages/unofficial`** — the opt-in private-web-API adapter: cookie parsing/import, runtime query-id discovery from JS bundles, `x-client-transaction-id` generation (ported from MIT prior art — see `THIRD_PARTY_NOTICES.md`), and 11 operations (likes, follows, profile edits, avatar/banner, pin, quote, long note).
- **`packages/cli`** — commander front-end. Subcommands and flags are generated from the registry via `z.toJSONSchema`; unofficial ops only register when config enables them and require `--confirm`.
- **`packages/mcp`** — MCP v2 server. Registers 49 official tools + 2 meta-tools by default; 60 + 2 when unofficial is enabled. Runtime construction is lazy and shared; official tools check `ctx.hasToken`, unofficial tools attach a cookie-backed client.

Adding an operation is one entry in `packages/ops/src/registry.ts` (or `packages/unofficial/src/ops.ts`). It appears as `x <group> <verb>`, as an MCP tool, and in `x ops` with no other edits.

### Distribution packages

Three artifacts are built from the same source by `scripts/build-npm.mjs`:

- **`npm/`** — publishable `x-mcp-automation` with esbuild bundles in `dist/` (gitignored) and four bin launchers. `@napi-rs/keyring` is the only external; everything else is bundled.
- **`pip/`** — `x-mcp-automation` launcher (hatchling). It vendors the same `cli.mjs`/`mcp.mjs` (gitignored) and requires Node 24 at runtime.
- **`plugins/xctl/`** — Claude Code plugin. `servers/xctl.mjs` is the vendored MCP bundle and **is committed**, because plugins install from a git ref.

`npm/package.json` is the single version source; the build script writes that version into the marketplace, plugin manifest and `pyproject.toml`. `xctl install` runs `claude plugin marketplace add` + `plugin install`. See `docs/PACKAGING.md`.

## Invariants to preserve

- Every write is `destructiveHint: true`, `idempotentHint: false`, and has a `cost()` function. Writes are never retried automatically — a retried post can duplicate.
- Reads are `readOnlyHint: true`; they must not be marked destructive.
- `mcpName` is snake_case from `id` (`posts.create` → `posts_create`) and must be unique across both registries.
- Unofficial operations must contain `UNOFFICIAL` in their description and only declare `transports: ['unofficial']`.
- No bulk or engagement-farming verbs. One target per invocation. This is a product constraint, not a missing feature.
- Cost is real money: the price card lives in `packages/core/src/cost.ts`. A post with a URL is $0.20, not $0.015.
- `npm/package.json` is the only version source. Never hand-edit the version in `plugin.json`, `marketplace.json` or `pyproject.toml`; `package:build` syncs them.

## Gotchas

- **MCP SDK v2 uses different package names.** Import from `@modelcontextprotocol/server` and `@modelcontextprotocol/server/stdio` (v2.3.x). `@modelcontextprotocol/sdk` is legacy v1.
- **zod v4 only.** `import * as z from 'zod/v4'`. Zod 3 typechecks but fails at `tools/list`.
- **stdout is the JSON-RPC channel** in the MCP server. All logging goes to stderr.
- ESM + NodeNext: relative imports need `.js` extensions in `.ts` sources.
- `exactOptionalPropertyTypes` is on — optional properties must be spread conditionally, not assigned `undefined`. Helper parameter types often need `?: T | undefined`.
- **Do not coerce numeric-looking CLI strings globally.** Ids are strings; number fields use `z.coerce.number()`. A global numeric coercion broke `x likes add --id 123` once already.
- `node:sqlite` emits an experimental warning on import; `openState` temporarily filters that specific warning so CLI output stays clean.
- OAuth authorization codes live **30 seconds** — the exchange happens inside the callback handler. Access tokens last 2 hours; refresh tokens rotate.
- An unofficial-only operation must **not** require `X_USER_TOKEN`; it authenticates with cookies. `createRuntime` is called with `allowMissingToken: true` for those paths.
- X docs drift: like/follow endpoints still appear in the OpenAPI spec but are removed from self-serve tiers. Expect runtime 403s.

## Environment

`X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`, `X_USER_TOKEN`, `X_BEARER_TOKEN`, `X_PROFILE`, `XCTL_SPEND_CAP`, `XCTL_HOME`. Config, state and the query-id cache live under `XCTL_HOME` (`%APPDATA%\xctl` on Windows, `~/.config/xctl` elsewhere).

## Context

`docs/PLAN.md` records the decision record, capability matrix, roadmap and risk register. `docs/research/` holds six dated source reports. Check them before re-litigating a platform limitation — the 2026 restriction waves are documented there with primary sources.
