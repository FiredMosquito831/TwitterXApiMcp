# Packaging and releases

Three distribution channels share one build:

| Channel | Name | Entry points |
|---|---|---|
| npm | `x-mcp-automation` | bins `xctl`, `xctl-mcp`, `x`, `x-mcp` |
| PyPI | `x-mcp-automation` | console scripts `xctl`, `xctl-mcp` |
| Claude Code plugin | `xctl` in `xctl-marketplace` | MCP server `servers/xctl.mjs` |

`npm/package.json` is the **single version source**. `scripts/build-npm.mjs` writes that version into `.claude-plugin/marketplace.json`, `plugins/xctl/.claude-plugin/plugin.json` and `pip/pyproject.toml`. `scripts/verify-versions.mjs` fails CI if any of them disagree, or if a release tag does not match.

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
.github/workflows/
  ci.yml                   tests, version contract, tarball and wheel smoke tests
  npm.yml                  npm publish (release or version bump)
  pypi.yml                 wheel build + opt-in publish
```

Why the plugin server is committed but `npm/dist` is not: Claude Code installs a plugin from a git ref, so the server must exist in the repository. npm and PyPI build their artifacts in CI, so their copies are ignored.

The npm package has a `postinstall` **notice only**: it prints "run `xctl setup`" and never edits configuration or opens a browser. Installation side effects belong to the explicit `xctl setup` / `xctl uninstall` commands.

## Build locally

```bash
npm run package:build     # tsc -b, esbuild bundles, sync versions
npm run package:pack      # build + `npm pack` inside npm/
```

The bundler externalizes only `@napi-rs/keyring` (native, optional). Everything else — zod, commander, the MCP SDK, linkedom, the workspace packages — is bundled, so users install one package.

## How publishing is triggered

**npm** (`npm.yml`):

1. A GitHub **release is published** — the tag must equal `npm/package.json`.
2. **`npm/package.json` is pushed to `main`** with a version that is not on npm yet.
3. A manual `workflow_dispatch` with an existing tag.

The workflow is idempotent: if that exact version already exists on npm, it does nothing. Until the trusted publisher is configured it prints a warning and stays green; after configuration the next release or version bump publishes for real.

**PyPI** (`pypi.yml`):

- Builds the wheel on every release and every relevant push, and attaches it to the GitHub release.
- Publishes only when the repository variable `PUBLISH_PYPI` is `true`. PyPI has no safe "warn and stay green" path, so this is explicit:

```bash
gh variable set PUBLISH_PYPI --body true
```

## One-time registry setup

### npm

npmjs.com → package `x-mcp-automation` → Settings → Trusted Publisher → GitHub Actions:

| Field | Value |
|---|---|
| Organization or user | `FiredMosquito831` |
| Repository | `TwitterXApiMcp` |
| Workflow filename | `npm.yml` |
| Environment | **leave empty** |

npm needs 11.5.1+ for trusted publishing; the workflow installs the latest npm first.

### PyPI

pypi.org → project `x-mcp-automation` → Publishing → Add a trusted publisher → GitHub:

| Field | Value |
|---|---|
| Owner | `FiredMosquito831` |
| Repository | `TwitterXApiMcp` |
| Workflow filename | `pypi.yml` |
| Environment | **leave empty** |

If the project does not exist yet, add a **pending publisher** with the same values; the first upload creates it. Do not add an environment name to the workflow: the environment is part of the claim PyPI matches.

## Release flow

1. Bump `version` in `npm/package.json`.
2. Run `npm run package:build` and commit the regenerated `plugins/xctl/servers/xctl.mjs` plus the synced manifests.
3. Push to `main` — npm publishes if the version is new.
4. Optionally create a GitHub release `vX.Y.Z` on that commit. Publishing the release also triggers npm (tag guard) and builds/attaches the wheel.
5. Verify, do not trust the badge:

```bash
npm view x-mcp-automation version
curl -s https://pypi.org/pypi/x-mcp-automation/json | python -c "import sys,json;print(json.load(sys.stdin)['info']['version'])"
gh api repos/FiredMosquito831/TwitterXApiMcp/releases/latest --jq '.tag_name, (.assets[].name)'
```

Versions are immutable on both registries. A bad release gets a new version; never retag.

## What CI checks before a release

`ci.yml` runs on every push and pull request:

- all five test phases (`npm test`), including the version contract;
- `npm pack --dry-run` and the presence of both bundles;
- wheel build, install into a clean venv, `xctl ops` returns 49, and `xctl-mcp` completes an MCP initialize handshake;
- the plugin's vendored server exists.

## Site (GitHub Pages)

`site/` is a dependency-free static page published by `.github/workflows/pages.yml`:

- Push changes under `site/` to `main`, or run the workflow manually.
- Pages source must be **GitHub Actions** (Settings → Pages).
- Custom domain: `x-mcp-automation.danubelabs.net`. `site/CNAME` records it; the Pages settings must match.
- DNS lives at Cloudflare: a **DNS-only** CNAME `x-mcp-automation` → `firedmosquito831.github.io` (the same pattern as the other `*.danubelabs.net` GitHub Pages sites).
- HTTPS is provisioned by GitHub after DNS resolves; enable “Enforce HTTPS” once the certificate is issued.

SEO assets included: canonical URL, Open Graph and Twitter cards, a generated 1200×630 `og.png` (`python scripts/make-og.py`), JSON-LD `SoftwareApplication`, `robots.txt`, `sitemap.xml`, `llms.txt`, semantic headings and a 404 page.

## Manual fallback

```bash
# npm
cd npm
npm pack --dry-run
npm publish --access public        # add --otp=<code> if prompted
# Provenance is attached by CI (`npm publish --provenance`), not locally:
# npm cannot generate provenance outside a supported OIDC provider.

# PyPI (wheel only; no sdist by design)
python -m build --wheel pip
pip install --force-reinstall pip/dist/*.whl
```

Re-run a publish for an existing tag:

```bash
gh workflow run npm.yml  -f tag=v0.1.0
gh workflow run pypi.yml -f tag=v0.1.0
```
