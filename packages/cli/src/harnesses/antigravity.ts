import { access, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function repoRoot(): string | null {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(current, '.claude-plugin', 'marketplace.json'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Google Antigravity (`agy`): global only. Adds the MCP server and installs the
 * plugin folder. There is no project scope; asking for one is a hard error.
 */
export class AntigravityHarness extends Harness {
  readonly name = 'antigravity';
  override readonly cli = 'agy';
  readonly capabilities: Capabilities = {
    scopes: ['global'],
    needsRestart: false,
    notes: 'agy has no project scope; installation is always global',
  };

  async #pluginDir(ctx: Ctx): Promise<string | null> {
    const local = repoRoot();
    if (local) return join(local, 'plugins', PLUGIN);

    const clone = join(ctx.home, 'repo');
    if (await exists(clone)) {
      ctx.run(['git', '-C', clone, 'pull', '--ff-only']);
    } else {
      await mkdir(dirname(clone), { recursive: true });
      const result = ctx.run(['git', 'clone', `https://github.com/${ctx.source}.git`, clone]);
      if (result.code !== 0) return null;
    }
    return join(clone, 'plugins', PLUGIN);
  }

  async install(ctx: Ctx, scope: Scope): Promise<Step[]> {
    this.checkScope(scope);
    if (!this.cliPresent(ctx)) {
      return [{ target: this.name, action: 'install', status: 'skipped', detail: 'agy is not on PATH' }];
    }

    const steps: Step[] = [];
    const command = serverCommand();
    const result = ctx.run(['agy', 'mcp', 'add', PLUGIN, '--', ...command]);
    steps.push(stepFromResult(this.name, 'mcp add', result.code, result.out));
    if (result.code === 0 || /already/i.test(result.out)) {
      await this.record(ctx, 'global', { kind: 'agy-mcp', name: PLUGIN });
    }

    const pluginDir = await this.#pluginDir(ctx);
    if (!pluginDir) {
      steps.push({ target: this.name, action: 'plugin install', status: 'error', detail: 'could not obtain the plugin folder' });
      return steps;
    }

    const installed = ctx.run(['agy', 'plugin', 'install', pluginDir]);
    steps.push(stepFromResult(this.name, 'plugin install', installed.code, installed.out));
    if (installed.code === 0 || /already/i.test(installed.out)) {
      await this.record(ctx, 'global', { kind: 'agy-plugin', name: PLUGIN });
    }
    return steps;
  }

  update(ctx: Ctx, scope: Scope): Promise<Step[]> | Step[] {
    return this.install(ctx, scope);
  }

  uninstall(ctx: Ctx, scope: Scope | 'all'): Step[] {
    this.expand(scope);
    if (!this.cliPresent(ctx)) {
      return [{ target: this.name, action: 'uninstall', status: 'skipped', detail: 'agy is not on PATH' }];
    }
    const steps: Step[] = [];
    let result = ctx.run(['agy', 'mcp', 'remove', PLUGIN]);
    steps.push(cleanupStep(this.name, 'mcp remove', result.code, result.out));
    result = ctx.run(['agy', 'plugin', 'uninstall', PLUGIN]);
    steps.push(cleanupStep(this.name, 'plugin uninstall', result.code, result.out));
    void this.forget(ctx, 'global');
    return steps;
  }

  doctor(ctx: Ctx): Step[] {
    if (!this.cliPresent(ctx)) {
      return [{ target: this.name, action: 'status', status: 'skipped', detail: 'agy is not on PATH' }];
    }
    const result = ctx.run(['agy', 'mcp', 'list']);
    const ok = result.out.includes(PLUGIN);
    return [
      {
        target: this.name,
        action: 'global',
        status: ok ? 'ok' : 'skipped',
        detail: ok ? "installed (listed by 'agy mcp list')" : "not found in 'agy mcp list'",
      },
    ];
  }
}
