import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  MARKETPLACE,
  PLUGIN,
  cleanupStep,
  serverCommand,
  stepFromResult,
  Harness,
  type Capabilities,
  type Ctx,
  type Scope,
  type Step,
} from './base.js';

const NEEDLE = `${PLUGIN}@${MARKETPLACE}`;
const TABLE = `mcp_servers.${PLUGIN}`;

async function removeTomlTable(path: string, table: string): Promise<number> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return 0;
  }
  const header = /^\s*\[\[?([^\]]+)\]\]?\s*$/;
  const keep: string[] = [];
  let removed = 0;
  let skipping = false;
  for (const line of text.split(/\r?\n/)) {
    const match = header.exec(line);
    if (match) {
      const name = (match[1] ?? '').trim();
      if (name === table || name.startsWith(`${table}.`)) {
        skipping = true;
        if (name === table) removed += 1;
        continue;
      }
      skipping = false;
    }
    if (!skipping) keep.push(line);
  }
  if (removed) await writeFile(path, keep.join('\n'), 'utf8');
  return removed;
}

async function hasTomlTable(path: string, table: string): Promise<boolean> {
  try {
    const text = await readFile(path, 'utf8');
    return new RegExp(`^\\s*\\[${table.replace(/\./g, '\\.')}\\]`, 'm').test(text);
  } catch {
    return false;
  }
}

async function writeTomlTable(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await removeTomlTable(path, TABLE);
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch {
    /* new file */
  }
  if (text && !text.endsWith('\n')) text += '\n';
  const [command, ...args] = serverCommand();
  const block =
    `\n[${TABLE}]\n` +
    `command = ${JSON.stringify(command)}\n` +
    `args = [${args.map((arg) => JSON.stringify(arg)).join(', ')}]\n`;
  await writeFile(path, text + block, 'utf8');
}

/**
 * Codex: global = plugin + marketplace in ~/.codex; project = MCP server only,
 * written to .codex/config.toml. Codex has no project plugins.
 * The project folder must be marked trusted in Codex for its config to load;
 * that is deliberately not automated.
 */
export class CodexHarness extends Harness {
  readonly name = 'codex';
  override readonly cli = 'codex';
  readonly capabilities: Capabilities = {
    scopes: ['global', 'project'],
    needsRestart: false,
    notes:
      'global = plugin + marketplace in ~/.codex; project = MCP server in .codex/config.toml (mark the folder as trusted in Codex)',
  };

  #projectConfig(ctx: Ctx): string {
    return join(ctx.projectDir, '.codex', 'config.toml');
  }

  #homeConfig(ctx: Ctx): string {
    return join(ctx.home, '.codex', 'config.toml');
  }

  async install(ctx: Ctx, scope: Scope): Promise<Step[]> {
    this.checkScope(scope);
    const steps: Step[] = [];

    if (scope === 'project') {
      if (this.cliPresent(ctx)) {
        let result = ctx.run(['codex', 'plugin', 'remove', NEEDLE]);
        steps.push(cleanupStep(this.name, 'global plugin removed', result.code, result.out));
        result = ctx.run(['codex', 'plugin', 'marketplace', 'remove', MARKETPLACE]);
        steps.push(cleanupStep(this.name, 'global marketplace removed', result.code, result.out));
      }
      await this.forget(ctx, 'global');
      if (await removeTomlTable(this.#homeConfig(ctx), TABLE)) {
        steps.push({ target: this.name, action: 'global block removed', status: 'ok', detail: 'project only' });
      }
      await writeTomlTable(this.#projectConfig(ctx));
      await this.record(ctx, 'project', { kind: 'toml-table', path: this.#projectConfig(ctx), table: TABLE });
      steps.push({
        target: this.name,
        action: `project mcp (${scope})`,
        status: 'ok',
        detail: `${this.#projectConfig(ctx)} (mark the folder as trusted in Codex)`,
      });
      return steps;
    }

    if (!this.cliPresent(ctx)) {
      return [{ target: this.name, action: 'install', status: 'skipped', detail: 'codex is not on PATH' }];
    }

    let result = ctx.run(['codex', 'plugin', 'marketplace', 'add', ctx.source]);
    steps.push(stepFromResult(this.name, 'marketplace add (global)', result.code, result.out));
    if (result.code === 0 || /already/i.test(result.out)) {
      await this.record(ctx, 'global', { kind: 'marketplace', name: MARKETPLACE });
    }

    result = ctx.run(['codex', 'plugin', 'add', NEEDLE]);
    steps.push(stepFromResult(this.name, 'plugin add (global)', result.code, result.out));
    if (result.code === 0 || /already/i.test(result.out)) {
      await this.record(ctx, 'global', { kind: 'plugin', name: NEEDLE });
    }

    if (await removeTomlTable(this.#homeConfig(ctx), TABLE)) {
      steps.push({ target: this.name, action: 'manual block removed', status: 'ok', detail: 'the plugin provides it now' });
    }
    if (await removeTomlTable(this.#projectConfig(ctx), TABLE)) {
      steps.push({ target: this.name, action: 'project block removed', status: 'ok', detail: 'global only' });
    }
    await this.forget(ctx, 'project');
    return steps;
  }

  async update(ctx: Ctx, scope: Scope): Promise<Step[]> {
    this.checkScope(scope);
    if (scope === 'project') {
      return [
        {
          target: this.name,
          action: 'update',
          status: 'skipped',
          detail: 'project config uses npx; it picks up the latest package automatically',
        },
      ];
    }
    if (!this.cliPresent(ctx)) {
      return [{ target: this.name, action: 'update', status: 'skipped', detail: 'codex is not on PATH' }];
    }
    const steps: Step[] = [];
    let result = ctx.run(['codex', 'plugin', 'marketplace', 'upgrade', MARKETPLACE]);
    steps.push(stepFromResult(this.name, 'marketplace upgrade', result.code, result.out));
    result = ctx.run(['codex', 'plugin', 'add', NEEDLE]);
    steps.push(stepFromResult(this.name, 'plugin refresh', result.code, result.out));
    return steps;
  }

  async uninstall(ctx: Ctx, scope: Scope | 'all'): Promise<Step[]> {
    const steps: Step[] = [];
    for (const current of this.expand(scope)) {
      if (current === 'project') {
        if (await removeTomlTable(this.#projectConfig(ctx), TABLE)) {
          steps.push({ target: this.name, action: 'project uninstall', status: 'ok', detail: this.#projectConfig(ctx) });
        } else {
          steps.push({ target: this.name, action: 'project uninstall', status: 'skipped', detail: 'not installed' });
        }
        await this.forget(ctx, 'project');
        continue;
      }
      if (this.cliPresent(ctx)) {
        let result = ctx.run(['codex', 'plugin', 'remove', NEEDLE]);
        steps.push(cleanupStep(this.name, 'plugin remove (global)', result.code, result.out));
        result = ctx.run(['codex', 'plugin', 'marketplace', 'remove', MARKETPLACE]);
        steps.push(cleanupStep(this.name, 'marketplace remove (global)', result.code, result.out));
      } else {
        steps.push({ target: this.name, action: 'global uninstall', status: 'skipped', detail: 'codex is not on PATH' });
      }
      await removeTomlTable(this.#homeConfig(ctx), TABLE);
      await this.forget(ctx, 'global');
    }
    return steps;
  }

  async doctor(ctx: Ctx): Promise<Step[]> {
    const steps: Step[] = [];
    let globalOk = false;
    if (this.cliPresent(ctx)) {
      const result = ctx.run(['codex', 'plugin', 'list']);
      globalOk = result.out.includes(NEEDLE);
      steps.push({
        target: this.name,
        action: 'global',
        status: globalOk ? 'ok' : 'skipped',
        detail: globalOk ? 'installed (plugin)' : 'not installed globally',
      });
    } else {
      steps.push({ target: this.name, action: 'global', status: 'skipped', detail: 'codex is not on PATH' });
    }

    const projectOk = await hasTomlTable(this.#projectConfig(ctx), TABLE);
    steps.push({
      target: this.name,
      action: 'project',
      status: projectOk ? 'ok' : 'skipped',
      detail: projectOk ? this.#projectConfig(ctx) : 'no project config here',
    });

    if (!globalOk && !projectOk) {
      steps.push({ target: this.name, action: 'status', status: 'skipped', detail: 'not installed' });
    }
    return steps;
  }
}
