# x-mcp-automation

CLI and MCP server for your own X account. 60 operations: posts, threads, media, DMs, bookmarks, lists, analytics, trends, Spaces/Communities reads, Articles — plus an explicitly opt-in unofficial transport for likes, follows, profile edits and pinned posts.

> Node.js **≥ 24** required.

## Install

```bash
npm install -g x-mcp-automation
```

Or run without installing:

```bash
npx -y x-mcp-automation --help
```

Bins: `xctl`, `xctl-mcp` (and the short aliases `x`, `x-mcp`).

## Sign in

```bash
export X_CLIENT_ID=...        # OAuth 2.0 app from https://console.x.com
xctl auth login
xctl account status
```

## MCP server

```bash
claude mcp add --transport stdio x --scope user -- xctl-mcp
```

Manual config:

```json
{
  "mcpServers": {
    "xctl": {
      "type": "stdio",
      "command": "xctl-mcp",
      "env": { "X_PROFILE": "default", "XCTL_SPEND_CAP": "5" }
    }
  }
}
```

51 tools by default; 62 when the unofficial transport is enabled. `operations_search` and `operations_invoke` cover the long tail without loading every schema.

## Claude Code plugin

```bash
npx -y x-mcp-automation install --agent claude
```

This adds the `xctl-marketplace` and installs the `xctl` plugin. Or manually:

```
/plugin marketplace add FiredMosquito831/TwitterXApiMcp
/plugin install xctl@xctl-marketplace
```

## The unofficial transport

Off by default. It uses your logged-in browser session against X's private endpoints.

```bash
xctl auth import-cookies --file cookies.json
xctl config set-unofficial on --i-understand
xctl likes add --id 123 --confirm
```

X's automation rules prohibit this and may permanently suspend the account. Every unofficial operation is labeled `UNOFFICIAL`, requires `--confirm`, and takes exactly one target per call.

## Cost and safety

- `XCTL_SPEND_CAP` (default `$5`) is enforced per profile per month.
- A post containing a URL costs **$0.20** instead of $0.015.
- Writes are never retried automatically; a 30-second dedupe guard blocks double submits.
- Credentials live in the OS keychain, with a user-scoped file fallback.

## Links

- Repository and full docs: <https://github.com/FiredMosquito831/TwitterXApiMcp>
- License: Apache-2.0. Third-party attribution is in `NOTICE`.
