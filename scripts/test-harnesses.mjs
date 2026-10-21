// Harness adapters: scopes, targets, and what each one writes.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HARNESSES,
  normalizeScope,
  resolveTargets,
  UnsupportedScope,
} from '../packages/cli/dist/harnesses/index.js';

function ctxFor(home, projectDir, { run, which } = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      home,
      projectDir,
      source: 'FiredMosquito831/TwitterXApiMcp',
      which: which ?? (() => null),
      run:
        run ??
        ((command) => {
          calls.push(command);
          return { code: 0, out: '' };
        }),
    },
  };
}

// --- scope and target resolution -----------------------------------------
assert.equal(normalizeScope('user'), 'global');
assert.equal(normalizeScope('local'), 'project');
assert.equal(normalizeScope('GLOBAL'), 'global');
assert.throws(() => normalizeScope('machine'), /Unknown scope/);

assert.deepEqual(resolveTargets([]), ['claude', 'codex', 'opencode', 'antigravity']);
assert.deepEqual(resolveTargets(['all']), ['claude', 'codex', 'opencode', 'antigravity']);
assert.deepEqual(resolveTargets(['claude', 'codex']), ['claude', 'codex']);
assert.throws(() => resolveTargets(['cursor']), /Unknown target/);

// --- opencode: JSON config, skill copy, scope switching -------------------
{
  const home = await mkdtemp(join(tmpdir(), 'xctl-home-'));
  const project = await mkdtemp(join(tmpdir(), 'xctl-proj-'));
  const { ctx } = ctxFor(home, project);
  const opencode = HARNESSES.opencode;

  await opencode.install(ctx, 'global');
  const globalConfig = JSON.parse(
    await readFile(join(home, '.config', 'opencode', 'opencode.json'), 'utf8'),
  );
  assert.deepEqual(globalConfig.mcp.xctl.command, ['npx', '-y', '--package', 'x-mcp-automation', 'xctl-mcp']);
  assert.equal(globalConfig.mcp.xctl.enabled, true);
  const skillFiles = await readdir(join(home, '.config', 'opencode', 'xctl'));
  assert.ok(skillFiles.includes('SKILL.md'), 'global install copies the skill');

  await opencode.install(ctx, 'project');
  const projectConfig = JSON.parse(await readFile(join(project, 'opencode.json'), 'utf8'));
  assert.ok(projectConfig.mcp.xctl, 'project config has the server');
  const globalAfter = JSON.parse(
    await readFile(join(home, '.config', 'opencode', 'opencode.json'), 'utf8'),
  );
  assert.equal(globalAfter.mcp?.xctl, undefined, 'switching scope removes the other one');

  await opencode.uninstall(ctx, 'all');
  const projectAfter = JSON.parse(await readFile(join(project, 'opencode.json'), 'utf8'));
  assert.equal(projectAfter.mcp?.xctl, undefined);
}

// --- codex: project scope writes a TOML table -----------------------------
{
  const home = await mkdtemp(join(tmpdir(), 'xctl-home-'));
  const project = await mkdtemp(join(tmpdir(), 'xctl-proj-'));
  const { ctx } = ctxFor(home, project);
  const codex = HARNESSES.codex;

  await codex.install(ctx, 'project');
  const toml = await readFile(join(project, '.codex', 'config.toml'), 'utf8');
  assert.match(toml, /\[mcp_servers\.xctl\]/);
  assert.match(toml, /command = "npx"/);
  assert.match(toml, /x-mcp-automation/);

  await codex.install(ctx, 'project'); // idempotent: no duplicate table
  const twice = await readFile(join(project, '.codex', 'config.toml'), 'utf8');
  assert.equal((twice.match(/\[mcp_servers\.xctl\]/g) ?? []).length, 1);

  await codex.uninstall(ctx, 'project');
  const after = await readFile(join(project, '.codex', 'config.toml'), 'utf8').catch(() => '');
  assert.doesNotMatch(after, /\[mcp_servers\.xctl\]/);
}

// --- claude: scope mapping and single-scope cleanup -----------------------
{
  const home = await mkdtemp(join(tmpdir(), 'xctl-home-'));
  const project = await mkdtemp(join(tmpdir(), 'xctl-proj-'));
  const { ctx, calls } = ctxFor(home, project, { which: () => '/fake/claude' });
  const claude = HARNESSES.claude;

  await claude.install(ctx, 'global');
  assert.ok(calls.some((c) => c.join(' ').includes('plugin marketplace add') && c.includes('user')));
  assert.ok(calls.some((c) => c.join(' ').includes('plugin install') && c.includes('user')));
  assert.ok(
    calls.some((c) => c.join(' ').includes('plugin uninstall') && c.includes('project')),
    'the other scope is cleaned so only one server runs',
  );

  calls.length = 0;
  await claude.install(ctx, 'project');
  assert.ok(calls.some((c) => c.join(' ').includes('plugin install') && c.includes('project')));

  calls.length = 0;
  await claude.uninstall(ctx, 'all');
  const joined = calls.map((c) => c.join(' ')).join('\n');
  assert.doesNotMatch(joined, /marketplace remove/, 'the shared marketplace is never removed');
}

// --- antigravity rejects project scope ------------------------------------
{
  const home = await mkdtemp(join(tmpdir(), 'xctl-home-'));
  const project = await mkdtemp(join(tmpdir(), 'xctl-proj-'));
  const { ctx } = ctxFor(home, project);
  await assert.rejects(() => HARNESSES.antigravity.install(ctx, 'project'), UnsupportedScope);
}

console.log('harness tests ok');
