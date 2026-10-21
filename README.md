# xctl

A terminal control plane for **your own** X account: a CLI, a typed SDK layer, and an MCP server generated from one operation registry.

**60 operations** · 49 official-API · 11 unofficial (opt-in) · 51 MCP tools by default

> X's official API lost most account-control features in 2026. `xctl` covers what remains officially, and puts the rest behind a clearly labeled, opt-in unofficial transport that the user must explicitly enable.

---

## Install

**npm** (Node.js ≥ 24):

```bash
npm install -g x-mcp-automation
xctl --help
```

Without a global install:

```bash
npx -y x-mcp-automation --help
```

**PyPI / pipx** (same binary, Node.js ≥ 24 required):

```bash
pipx install x-mcp-automation
xctl --help
```

**Claude Code plugin:**

```bash
npx -y x-mcp-automation install --agent claude
```

or manually:

```
/plugin marketplace add FiredMosquito831/TwitterXApiMcp
/plugin install xctl@xctl-marketplace
```

The plugin ships its own server bundle, so it does not need a global npm install. Its settings (spend cap, profile, config directory) are asked for in Claude Code's plugin settings.

Detailed channels, updating, uninstalling and troubleshooting: [`docs/INSTALL.md`](docs/INSTALL.md).

## What works

| Surface | Official API | `xctl` |
|---|---|---|
| Post, thread, poll, edit, delete | ✅ | `x posts create/thread/edit/delete` |
| Media upload (image/GIF/video, alt text) | ✅ | `x media upload` |
| Home / user / mentions timelines | ✅ | `x posts timeline` |
| Search recent + full archive | ✅ | `x posts search-recent/search-all` |
| Post metrics, own-account analytics | ✅ | `x posts metrics`, `x analytics account` |
| Quote-post reads | ✅ | `x posts quotes` |
| Liked posts, blocked/muted lists | ✅ | `x users liked/blocked/muted` |
| Trends, Spaces (read), Communities (read), News | ✅ | `x trends get`, `x spaces search`, `x communities search`, `x news search` |
| DMs send/read | ✅ | `x dms send/list/conversation` |
| Bookmarks | ✅ | `x bookmarks list/add/remove` |
| Lists CRUD + members | ✅ | `x lists ...` |
| Repost / undo | ✅ | `x posts repost/unrepost` |
| Block, mute | ✅ | `x users block/unblock/mute/unmute` |
| Long-form Articles draft/publish | ✅ | `x articles draft/publish` |
| Usage / credit balance | ✅ | `x usage get` |
| Reply | ⚠️ summoned only | submits; X returns 403 unless allowed |
| Quote post | ❌ Enterprise | `x posts quote` (unofficial) |
| Like / follow | ❌ removed + rule-prohibited when automated | `x likes ...`, `x follows ...` (unofficial, single action, `--confirm`) |
| Profile bio/name/location/url | ❌ no endpoint | `x profile update` (unofficial) |
| Avatar / banner | ❌ no endpoint | `x profile avatar/banner` (unofficial) |
| Pinned post | ❌ no endpoint | `x posts pin/unpin` (unofficial) |

---

## Requirements

- Node.js **≥ 24**
- An X developer app with OAuth 2.0 enabled (for official operations)

## Build from source

```bash
npm install
npm run build
npm test
```

Run the CLI directly:

```bash
node packages/cli/dist/index.js --help
```

Or link the binaries:

```bash
(cd packages/cli && npm link)
(cd packages/mcp && npm link)
x --help
x-mcp --help
```

## Authentication

### OAuth 2.0 PKCE (official operations)

Create an app at <https://console.x.com>, enable OAuth 2.0, and register a redirect URI (default `http://localhost:8080/callback`).

```bash
export X_CLIENT_ID="..."
export X_CLIENT_SECRET="..."      # optional for public clients
x auth login
```

The browser opens, the loopback server exchanges the code immediately (X's codes live 30 seconds), and tokens are stored in the OS keychain. Access tokens last 2 hours and refresh automatically; the refresh token rotates.

Headless or remote:

```bash
x auth login --manual          # prints the URL, stores PKCE state
x auth complete --callback "http://localhost:8080/callback?code=...&state=..."
```

Other auth commands:

```bash
x auth status [--live]
x auth logout [--profile work]
x auth import-cookies --file cookies.json
```

## CLI

```bash
# account and cost
x account status
x usage get --kind all

# posting
x posts create --text "hello from the terminal"
x posts create --text "with media" --media-ids 1234567890
x posts create --text "poll" --poll '{"options":["a","b"],"duration_minutes":1440}'
x posts thread --segments "first" "second" "third"
x posts delete --id 1234567890

# reads
x posts timeline --kind home --max-results 20
x posts search-recent --query "from:jack mcp" --max-results 10
x users get --username jack
x analytics account --max-posts 50

# DMs
x dms send --to-user-id 42 --text "hello"
x dms list --max-results 20
```

Every write supports `--dry-run` where it makes sense (`posts.create`, `posts.thread`, `media.upload`) and prints the USD cost first.

Global flags: `--json`, `--profile <name>`, `--spend-cap <usd>`.

### Scheduling

`xctl` schedules locally; it does not use X's web scheduler.

```bash
x queue add --op posts.create --input '{"text":"later"}' --in 2h
x queue list
x queue run --once          # or without --once to poll every 30s
x queue remove 1
```

## MCP server

```bash
claude mcp add --transport stdio x --scope user -- xctl-mcp
```

Without a global install:

```bash
claude mcp add --transport stdio x --scope user -- npx -y --package x-mcp-automation xctl-mcp
```

Manual config:

```json
{
  "mcpServers": {
    "x": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/Projects2/TwitterXApiMcp/packages/mcp/dist/index.js"],
      "env": { "X_USER_TOKEN": "…", "XCTL_SPEND_CAP": "5" }
    }
  }
}
```

The server exposes one tool per operation plus two meta-tools:

- `operations_search` — find an operation and its input schema without loading every schema.
- `operations_invoke` — run any operation by id with validated input.

Use one entry per profile (`X_PROFILE=work`, `X_PROFILE=personal`).

## The unofficial transport

This uses your logged-in browser session against X's private web endpoints. **X's automation rules prohibit non-API automation and state it may result in permanent suspension.** It is off by default, lives in a separate package, and every operation is prefixed `UNOFFICIAL` in its description.

Enable it deliberately:

```bash
# 1. export cookies from a logged-in x.com session
#    (Cookie-Editor JSON, Playwright storageState, or a Cookie header)
x auth import-cookies --file cookies.json

# 2. acknowledge the risk
x config set-unofficial on --i-understand
```

Then unofficial commands appear, and each requires `--confirm`:

```bash
x likes add --id 1234567890 --confirm
x follows add --username jack --confirm
x profile update --description "new bio" --confirm
x posts pin --id 1234567890 --confirm
```

Design constraints, enforced in code:

- **One target per invocation.** No batch or loop verbs exist.
- Every unofficial op is marked destructive and non-idempotent in MCP.
- The unofficial transport never runs without the config flag *and* stored cookies.
- Rate budgets are conservative; X's own `x-rate-limit-*` headers seed the buckets.
- No anti-detection engineering: it uses a real session, not fingerprint spoofing.

If X changes its bundle layout, `x unofficial refresh` re-scans the operation table; `x unofficial operations` shows what was discovered.

## Safety and cost

- A spend meter refuses operations that would cross `XCTL_SPEND_CAP` (default `$5`), persisted per profile per month.
- Posts containing a URL cost **$0.20** instead of $0.015 and say so before running.
- Writes are never retried automatically — a retried post can duplicate.
- A 30-second dedupe window blocks accidental double submission.
- Reads use the cheaper Owned Reads endpoints where possible.

## Layout

```
packages/core         transport, OAuth, credentials, config, state, rate limiter, spend meter
packages/ops          the operation registry — the single source of truth (49 official ops)
packages/unofficial   cookie session, bundle parser, transaction-id generator (11 ops)
packages/cli          commander front-end over the registry
packages/mcp          MCP v2 server over the registry

npm/                  publishable package (bundled CLI + MCP, bins xctl/xctl-mcp)
pip/                  PyPI launcher (vendors the same bundles)
plugins/xctl/         Claude Code plugin (manifest, vendored server, skill, commands)
.claude-plugin/       marketplace catalogue
.github/workflows/    npm and PyPI trusted-publishing workflows

scripts/              tests, structural checks, package builder
docs/research/        six dated research reports with sources
docs/PLAN.md          decision record, capability matrix, roadmap, risk register
```

## Tests

```bash
npm test
```

Runs, in order:

- `test-core.mjs` — PKCE vector, pricing, spend cap, limiter seeding, SQLite state, cookie parsing, transaction materials
- `test-ops.mjs` — request shapes, dry runs, thread rollback, search params, analytics aggregation
- `verify-registry.mjs` — unique names, annotations, cost functions, unofficial warnings
- `mcp-smoke.mjs` — real stdio handshake and `tools/list`
- `test-mcp.mjs` — `operations_search`, `operations_invoke`, oversized-input rejection

## Environment

| Variable | Purpose |
|---|---|
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | OAuth app credentials |
| `X_REDIRECT_URI` | Override the redirect URI |
| `X_USER_TOKEN` | Skip the store and use a fixed token |
| `X_BEARER_TOKEN` | App-only bearer; public reads only |
| `X_PROFILE` | Profile name for multi-account setups |
| `XCTL_SPEND_CAP` | Hard USD cap per month/profile (default `5`) |
| `XCTL_HOME` | Override config/cache directory |

## Limits worth knowing

- Official replies only work when the author summoned you.
- DM reads are capped at 15 per 15 minutes; use the Activity API for chat-scale polling.
- X Chat (E2E DMs) is not implemented; legacy DM endpoints are.
- Media processing can take minutes for video; `media.upload` waits up to ~60s.
- Articles require a DraftJS `content_state`; the built-in paragraph builder is a convenience and may need adjustment for rich content.
