# Changelog

All notable changes to this project. Versions follow semver; npm and PyPI releases are immutable.

## 0.2.2 — 2026-10-21

- Package, plugin and PyPI homepages now point at <https://x-mcp-automation.danubelabs.net/>.
- Documentation links on the site use correct file URLs.
- No functional changes.

## 0.2.1 — 2026-10-21

- `--agent none` now installs no agent instead of falling back to Claude.
- `uninstall --agent none` reports that there is nothing to remove.

## 0.2.0 — 2026-10-21

- Multi-agent installation with scopes: `xctl install [targets...] --scope global|project`.
- Isolated adapters for Claude Code, Codex, opencode and Google Antigravity.
- Per-agent state under `~/.xctl/state`, so uninstall removes only what installation wrote.
- `xctl update [targets...]` and per-agent `doctor` checks.
- The npm package ships `SKILL.md` for opencode global installs.

## 0.1.2 — 2026-10-21

- `xctl setup` (sign in, install agents, run doctor) and `xctl uninstall [--purge]`.
- Added an `x-mcp-automation` bin so `npx x-mcp-automation` resolves.
- `postinstall` prints a one-line hint and never changes configuration.

## 0.1.1 — 2026-10-21

- The CLI and MCP server report the published version instead of a hardcoded one.
- Local `npm publish` no longer fails on provenance outside CI.
- Publishing refuses to ship when a bundle is missing.

## 0.1.0 — 2026-10-21

- First release: 49 official operations and 11 opt-in unofficial operations.
- OAuth 2.0 PKCE, keychain credentials, SQLite state, rate buckets, spend caps.
- CLI, MCP server, Claude Code plugin, npm package and PyPI launcher.
