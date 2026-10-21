# Contributing

## Setup

```bash
npm install
npm run build
npm test
```

Node.js 24 or newer. There is no linter or test framework beyond the scripts in `scripts/`; extend those rather than adding a framework without a reason.

## Architecture rules

- `packages/ops` is the single source of truth. An operation added there appears in the CLI, the MCP server and `x ops` with no other edits.
- `run()` in an operation must not import commander, the MCP SDK, or a transport implementation.
- Write operations are destructive and non-idempotent; reads are read-only.
- No bulk or engagement-farming verbs. One target per invocation is a product constraint.
- Agent-specific installation logic belongs in `packages/cli/src/harnesses/<agent>.ts`, isolated from the other adapters.

## Before opening a pull request

```bash
npm test
node scripts/verify-versions.mjs
```

`npm test` includes the version contract, the registry checks, the npm tarball and a clean-venv wheel smoke test in CI.

## Releases

`npm/package.json` is the only version source. Bump it, run `npm run package:build`, commit the regenerated plugin server and synced manifests, then push. See [docs/PACKAGING.md](docs/PACKAGING.md).

Never retag a release, and never publish the same version twice.
