// Contract check: every version and packaging surface must agree.
// Runs in ordinary CI, so a mismatch fails before a release exists.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(root, path), 'utf8');

const npmPkg = JSON.parse(await read('npm/package.json'));
const version = npmPkg.version;

const pyproject = await read('pip/pyproject.toml');
const pyVersion = /^version = "([^"]+)"/m.exec(pyproject)?.[1];

const plugin = JSON.parse(await read('plugins/xctl/.claude-plugin/plugin.json'));
const marketplace = JSON.parse(await read('.claude-plugin/marketplace.json'));
const mcpJson = JSON.parse(await read('plugins/xctl/.mcp.json'));
const versionTs = await read('packages/core/src/version.ts');
const tsVersion = /VERSION = '([^']+)'/.exec(versionTs)?.[1];

assert.match(version, /^\d+\.\d+\.\d+$/, 'npm version must be semver');
assert.equal(pyVersion, version, 'pip/pyproject.toml version must match npm/package.json');
assert.equal(plugin.version, version, 'plugin.json version must match npm/package.json');
assert.equal(tsVersion, version, 'packages/core/src/version.ts must match npm/package.json');
assert.equal(
  marketplace.metadata.version,
  version,
  'marketplace metadata version must match npm/package.json',
);

// npm package shape
assert.equal(npmPkg.name, 'x-mcp-automation');
assert.ok(npmPkg.bin?.xctl, 'npm package must expose the xctl bin');
assert.ok(npmPkg.bin?.['xctl-mcp'], 'npm package must expose the xctl-mcp bin');
assert.ok(npmPkg.files?.includes('dist/'), 'npm files must include dist/');
assert.ok(Number(npmPkg.engines?.node.replace('>=', '')) >= 24, 'engines.node must be >= 24');
assert.equal(npmPkg.publishConfig?.access, 'public');

// plugin shape
assert.equal(plugin.name, 'xctl');
assert.equal(marketplace.plugins?.[0]?.name, 'xctl');
assert.equal(marketplace.plugins?.[0]?.source, './plugins/xctl');
const server = mcpJson.mcpServers?.xctl;
assert.equal(server?.command, 'node');
assert.ok(
  server?.args?.includes('${CLAUDE_PLUGIN_ROOT}/servers/xctl.mjs'),
  'plugin must run its vendored server',
);

// The tag, when present, is the final authority.
const tag = process.env.TAG ?? process.env.GITHUB_REF_NAME;
if (tag && /^v\d+\.\d+\.\d+$/.test(tag)) {
  assert.equal(tag.slice(1), version, `tag ${tag} does not match package version ${version}`);
}

console.log(`versions ok: ${version} across npm, PyPI, plugin and marketplace`);
