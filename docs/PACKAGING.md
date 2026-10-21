# Packaging and releases

Three distribution channels share one build:

| Channel | Name | Entry points |
|---|---|---|
| npm | `x-mcp-automation` | bins `xctl`, `xctl-mcp`, `x`, `x-mcp` |
| PyPI | `x-mcp-automation` | console scripts `xctl`, `xctl-mcp` |
| Claude Code plugin | `xctl` in `xctl-marketplace` | MCP server `servers/xctl.mjs` |

`npm/package.json` is the **single version source**. `scripts/build-npm.mjs` writes that version into `.claude-plugin/marketplace.json`, `plugins/xctl/.claude-plugin/plugin.json` and `pip/pyproject.toml`.

## Layout

```
npm/                       publishable package
  package.json             name, version, bins, optional keyring
  bin/                     four tiny launchers (set XCTL_CLI_NAME)
  dist/                    esbuild bundles (gitignored, built)
pip/                       PyPI launcher
  pyproject.toml           hatchling; version synced
  src/xctl/launcher.py     finds Node 24+, runs the vendored bundle
  src/xctl/vendor/         cli.mjs + mcp.mjs (gitignored, built)
plugins/xctl/              Claude Code plugin
  .claude-plugin/plugin.json
  .mcp.json                ${CLAUDE_PLUGIN_ROOT}/servers/xctl.mjs
  servers/xctl.mjs         vendored MCP bundle (committed)
  skills/xctl/SKILL.md
  commands/*.md
.claude-plugin/marketplace.json
```

Why the plugin server is committed but `npm/dist` is not: Claude Code installs a plugin from a git ref, so the server must exist in the repository. npm and PyPI build their artifacts in CI, so their copies are ignored.

## Build

```bash
npm run package:build     # tsc -b, esbuild bundles, sync versions
npm run package:pack      # build + `npm pack` inside npm/
```

The bundler externalizes only `@napi-rs/keyring` (native, optional). Everything else — zod, commander, the MCP SDK, linkedom, the workspace packages — is bundled, so users install one package.

## Release

1. Bump `version` in `npm/package.json`.
2. Run `npm run package:build` and commit the regenerated
   `plugins/xctl/servers/xctl.mjs` plus the three manifest versions.
3. Push to `main`.

The workflows publish only if that exact version is absent:

- `.github/workflows/npm.yml` — builds at the repo root, publishes from `npm/` with trusted publishing (OIDC).
- `.github/workflows/pypi.yml` — builds the wheel after `package:build`, publishes with PyPI trusted publishing (OIDC).

One-time registry setup is documented at the top of each workflow file.

## Verification before tagging

```bash
npm run package:pack
# install the tarball in a clean directory and run both bins
# then build and install the wheel:
python -m build pip
pip install --force-reinstall pip/dist/x_mcp_automation-0.1.0-py3-none-any.whl
xctl ops | wc -l        # 49
xctl-mcp                # MCP handshake over stdio
```

The plugin can be checked without publishing:

```bash
xctl install --dry-run
node plugins/xctl/servers/xctl.mjs   # speaks MCP on stdio
```

## Installer

`xctl install --agent claude` runs:

```
claude plugin marketplace add FiredMosquito831/TwitterXApiMcp
claude plugin install xctl@xctl-marketplace --scope user
```

`--marketplace owner/repo` overrides the source. For other agents the command prints an `mcpServers` snippet using `npx -y --package x-mcp-automation xctl-mcp`.
