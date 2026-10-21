// Copy the version from npm/package.json into packages/core/src/version.ts so
// the CLI and MCP server report the same version as the published package.
// Runs before tsc, because the bundles compile the constant.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'npm', 'package.json'), 'utf8'));

if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  console.error(`Invalid version in npm/package.json: ${pkg.version}`);
  process.exit(1);
}

const target = join(root, 'packages', 'core', 'src', 'version.ts');
await writeFile(
  target,
  `/**
 * The application version.
 *
 * This file is generated: \`scripts/sync-version.mjs\` rewrites it from
 * npm/package.json at the start of \`npm run package:build\`. Do not edit it by
 * hand; bump npm/package.json instead.
 */
export const VERSION = '${pkg.version}';
`,
);

console.log(`synced version ${pkg.version} into packages/core/src/version.ts`);
