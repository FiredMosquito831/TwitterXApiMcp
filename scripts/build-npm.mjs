// Build the publishable npm package and the vendored plugin server.
// Bundles the workspace packages so users install one package, not five.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = 'xctl';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmDir = join(root, 'npm');
const pluginDir = join(root, 'plugins', 'xctl');

async function bundle(entry, outfile) {
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [join(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    // Native, optional, and only loaded when present; never bundle it.
    external: ['@napi-rs/keyring'],
    legalComments: 'none',
    logLevel: 'warning',
  });
}

const pkg = JSON.parse(await readFile(join(npmDir, 'package.json'), 'utf8'));
const version = pkg.version;

await bundle('packages/cli/src/index.ts', join(npmDir, 'dist', 'cli.mjs'));
await bundle('packages/mcp/src/index.ts', join(npmDir, 'dist', 'mcp.mjs'));

// Ship the licence with the package.
await copyFile(join(root, 'LICENSE'), join(npmDir, 'LICENSE'));
await copyFile(join(root, 'NOTICE'), join(npmDir, 'NOTICE'));

// The plugin ships the same server bundle so it works without a global install.
await mkdir(join(pluginDir, 'servers'), { recursive: true });
await copyFile(join(npmDir, 'dist', 'mcp.mjs'), join(pluginDir, 'servers', 'xctl.mjs'));

// Ship the canonical skill with the npm package so opencode/global installs can
// copy it; it lives next to the bundled CLI.
const skillSource = join(pluginDir, 'skills', PLUGIN, 'SKILL.md');
const skillTarget = join(npmDir, 'skills', PLUGIN, 'SKILL.md');
await mkdir(dirname(skillTarget), { recursive: true });
await copyFile(skillSource, skillTarget);

// PyPI launcher package: vendor the same bundles and sync its version.
const pipDir = join(root, 'pip');
const vendorDir = join(pipDir, 'src', 'xctl', 'vendor');
await mkdir(vendorDir, { recursive: true });
await copyFile(join(npmDir, 'dist', 'cli.mjs'), join(vendorDir, 'cli.mjs'));
await copyFile(join(npmDir, 'dist', 'mcp.mjs'), join(vendorDir, 'mcp.mjs'));
await copyFile(join(root, 'LICENSE'), join(pipDir, 'LICENSE'));
await copyFile(join(root, 'NOTICE'), join(pipDir, 'NOTICE'));

const pyprojectPath = join(pipDir, 'pyproject.toml');
const pyproject = await readFile(pyprojectPath, 'utf8');
await writeFile(
  pyprojectPath,
  pyproject.replace(/^version = "[^"]+"$/m, `version = "${version}"`),
);

// Keep the three manifests on the same version.
const marketplacePath = join(root, '.claude-plugin', 'marketplace.json');
const marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
marketplace.metadata.version = version;
await writeFile(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n');

const pluginPath = join(pluginDir, '.claude-plugin', 'plugin.json');
const plugin = JSON.parse(await readFile(pluginPath, 'utf8'));
plugin.version = version;
await writeFile(pluginPath, JSON.stringify(plugin, null, 2) + '\n');

console.log(`built ${pkg.name}@${version}`);
console.log('  npm/dist/cli.mjs');
console.log('  npm/dist/mcp.mjs');
console.log('  plugins/xctl/servers/xctl.mjs');
