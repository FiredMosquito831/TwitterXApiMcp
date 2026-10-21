// Runs before `npm publish`: refuse to ship a package whose bundles are missing.
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const file of ['dist/cli.mjs', 'dist/mcp.mjs']) {
  try {
    await access(join(root, file));
  } catch {
    console.error(
      `Refusing to publish: ${file} is missing. Run \`npm run package:build\` at the repository root first.`,
    );
    process.exit(1);
  }
}
