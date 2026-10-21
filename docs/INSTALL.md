# Install

**Site:** <https://x-mcp-automation.danubelabs.net/>

`xctl` ships through three channels. Pick one; they install the same application.

| Channel | Command | Requires |
|---|---|---|
| npm | `npm install -g x-mcp-automation` | Node.js 24+ |
| PyPI / pipx | `pipx install x-mcp-automation` | Python 3.9+ **and** Node.js 24+ |
| Claude Code plugin | `npx -y x-mcp-automation install --agent claude` | Node.js 24+, Claude Code |

The Python package is a launcher; the application is Node.js. `pipx` users still need Node on PATH (or `XCTL_NODE` pointing at it).

## One command that does everything

After installing the package, one command covers the rest:

```bash
xctl setup
```

It will, in order:

1. Sign you in with OAuth 2.0 PKCE if no token is stored (opens a browser).
2. Add the `xctl-marketplace` and install the `xctl` Claude Code plugin at user scope.
3. Run `xctl doctor` and print what is missing.

Useful flags: `--skip-auth`, `--agent none` (npm/MCP only, no plugin), `--scope project`, `--dry-run`.

With `npx`, without a global install:

```bash
npx -y x-mcp-automation setup
```

The plugin ships its own server bundle, so this path needs no global npm package afterwards. Uninstall with:

```bash
xctl uninstall            # removes the plugin and marketplace
xctl uninstall --purge    # also deletes stored tokens and cookies for the profile
```

## npm

```bash
npm install -g x-mcp-automation
xctl setup
xctl --help
```

Without installing:

```bash
npx -y x-mcp-automation --help
npx -y --package x-mcp-automation xctl-mcp    # MCP server over stdio
```

Bins: `x-mcp-automation`, `xctl`, `xctl-mcp`, and the aliases `x`, `x-mcp`. The installer prints a one-line notice after a global install; it never changes your config on its own.

## PyPI / pipx

```bash
pipx install x-mcp-automation
xctl --help

# or inside a virtualenv
python -m venv .venv
. .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install x-mcp-automation
```

Uninstall: `pipx uninstall x-mcp-automation`.

If Node is not on PATH, point at it explicitly:

```bash
export XCTL_NODE=/usr/local/bin/node     # Windows: set XCTL_NODE=C:\Program Files\nodejs\node.exe
```

## Claude Code plugin

One command:

```bash
npx -y x-mcp-automation install --agent claude
```

It runs:

```
claude plugin marketplace add FiredMosquito831/TwitterXApiMcp
claude plugin install xctl@xctl-marketplace --scope user
```

Use `--scope project` to install only in the current repository, or `--dry-run` to print the commands first. Override the source with `--marketplace owner/repo`.

Manual equivalent inside Claude Code:

```
/plugin marketplace add FiredMosquito831/TwitterXApiMcp
/plugin install xctl@xctl-marketplace
```

The plugin ships its own server bundle (`plugins/xctl/servers/xctl.mjs`), so it does **not** require a global npm install. On first use, set the spend cap, profile and optional config directory in the plugin settings.

## Scopes and other agents

`xctl install` takes one or more targets and a scope. `global` is the default; `project` writes into the current folder.

| Target | global | project |
|---|---|---|
| `claude` | marketplace + plugin at Claude's **user** scope | marketplace + plugin at project scope (`.claude/settings.json`) |
| `codex` | plugin + marketplace in `~/.codex` | `[mcp_servers.xctl]` in `.codex/config.toml` (mark the folder trusted in Codex) |
| `opencode` | `~/.config/opencode/opencode.json` + skill + instructions | `opencode.json` in the folder |
| `antigravity` | `agy mcp add` + `agy plugin install` | not supported (explicit error) |

```bash
xctl install all                 # every agent found on PATH
xctl install all --scope project
xctl install codex opencode
xctl install claude --scope project
xctl update all
xctl uninstall all --scope all
xctl uninstall claude --scope project
```

Notes:

- Claude and Codex keep one scope active at a time. Installing a scope removes the other, so two servers do not answer the same tools.
- Claude's marketplace is shared by every folder, so `uninstall` never removes it.
- opencode edits only the `mcp.xctl` key and the instruction path, validates JSON before writing, and leaves a `.bak`.
- Antigravity has no project scope; asking for one is a hard error.
- `xctl setup --agent all` signs in once, installs every detected agent, then runs doctor.
- Per-install records live in `~/.xctl/state/<agent>.json` (or `%APPDATA%\xctl\state`), so uninstall removes only what installation wrote.

## Other MCP clients

Any client that accepts a stdio server can run `xctl-mcp`. JSON shape:

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

Without a global install, use:

```json
{
  "mcpServers": {
    "xctl": {
      "command": "npx",
      "args": ["-y", "--package", "x-mcp-automation", "xctl-mcp"]
    }
  }
}
```

For Claude Code specifically:

```bash
claude mcp add --transport stdio x --scope user -- xctl-mcp
```

## First run

```bash
xctl auth login          # OAuth 2.0 PKCE; opens a browser
xctl account status      # confirms the account, spend and rate limits
xctl doctor              # checks Node, keychain, token, cookies, plugin
```

OAuth needs an app from <https://console.x.com> with OAuth 2.0 enabled and a redirect URI registered (default `http://localhost:8080/callback`):

```bash
export X_CLIENT_ID=...
export X_CLIENT_SECRET=...      # optional for public clients
xctl auth login
```

## Updating

| Channel | Update |
|---|---|
| npm | `npm update -g x-mcp-automation` |
| pipx | `pipx upgrade x-mcp-automation` |
| plugin | `/plugin update xctl@xctl-marketplace` |

## Uninstalling

```bash
# npm
npm uninstall -g x-mcp-automation

# pipx
pipx uninstall x-mcp-automation

# plugin
/plugin uninstall xctl@xctl-marketplace

# credentials and local state (optional)
xctl auth logout
rm -rf ~/.config/xctl          # Windows: %APPDATA%\xctl
```

## Troubleshooting

- **`Node.js 24+ is required`** — install Node from <https://nodejs.org/>. The Python launcher checks this before starting.
- **`claude` not found during install** — install Claude Code, or add the server manually with `claude mcp add`.
- **`No X credential found`** — run `xctl auth login`, or set `X_USER_TOKEN`.
- **`OS keychain unavailable`** — credentials fall back to a user-scoped file under the config directory; this is expected in containers.
- **MCP client times out on first run with `npx`** — npm is resolving the package. Install globally, or use the plugin's vendored server.
- **`empty 404` from an unofficial call** — X rotated its bundle. Run `xctl unofficial refresh`.
