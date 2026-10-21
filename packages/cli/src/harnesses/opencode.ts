import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  PLUGIN,
  serverCommand,
  skillText,
  Harness,
  type Capabilities,
  type Ctx,
  type Scope,
  type Step,
} from './base.js';

interface OpencodeConfig {
  $schema?: string;
  mcp?: Record<string, { type?: string; command?: string[]; enabled?: boolean }>;
  instructions?: string[];
  [key: string]: unknown;
}

async function readConfig(path: string): Promise<OpencodeConfig> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as OpencodeConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { $schema: 'https://opencode.ai/config.json' };
    }
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}

async function writeConfig(path: string, data: OpencodeConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function backup(path: string): Promise<void> {
  try {
    await copyFile(path, `${path}.bak`);
  } catch {
    /* no existing file */
  }
}

async function removeOurEntry(path: string, instruction?: string): Promise<boolean> {
  let data: OpencodeConfig;
  try {
    data = await readConfig(path);
  } catch {
    return false;
  }
  let changed = Boolean(data.mcp?.[PLUGIN]);
  if (data.mcp) delete data.mcp[PLUGIN];
  if (instruction && Array.isArray(data.instructions) && data.instructions.includes(instruction)) {
    data.instructions = data.instructions.filter((entry) => entry !== instruction);
    changed = true;
  }
  if (changed) {
    await backup(path);
    await writeConfig(path, data);
  }
  return changed;
}

/**
 * opencode: JSON config only, no plugin. Global writes
 * ~/.config/opencode/opencode.json plus a skill copy; project writes
 * ./opencode.json. Only the `mcp.xctl` key and the instruction path are
 * touched, and a .bak is left before every write.
 */
export class OpencodeHarness extends Harness {
  readonly name = 'opencode';
  override readonly cli = null;
  readonly capabilities: Capabilities = {
    scopes: ['global', 'project'],
    needsRestart: true,
    notes: 'global = ~/.config/opencode; project = opencode.json in the project folder',
  };

  #globalConfig(ctx: Ctx): string {
    return join(ctx.home, '.config', 'opencode', 'opencode.json');
  }

  #projectConfig(ctx: Ctx): string {
    return join(ctx.projectDir, 'opencode.json');
  }

  #skillDir(ctx: Ctx): string {
    return join(ctx.home, '.config', 'opencode', PLUGIN);
  }

  #instruction(ctx: Ctx): string {
    return join(this.#skillDir(ctx), 'SKILL.md').replace(/\\/g, '/');
  }

  async install(ctx: Ctx, scope: Scope): Promise<Step[]> {
    this.checkScope(scope);
    const path = scope === 'global' ? this.#globalConfig(ctx) : this.#projectConfig(ctx);
    let data: OpencodeConfig;
    try {
      data = await readConfig(path);
    } catch (error) {
      return [{ target: this.name, action: 'config', status: 'error', detail: (error as Error).message }];
    }

    await backup(path);
    data.mcp = data.mcp ?? {};
    data.mcp[PLUGIN] = { type: 'local', command: serverCommand(), enabled: true };

    const steps: Step[] = [];
    if (scope === 'global') {
      const skill = skillText();
      if (skill) {
        await mkdir(this.#skillDir(ctx), { recursive: true });
        await writeFile(join(this.#skillDir(ctx), 'SKILL.md'), skill, 'utf8');
        const instructions = Array.isArray(data.instructions) ? data.instructions : [];
        if (!instructions.includes(this.#instruction(ctx))) instructions.push(this.#instruction(ctx));
        data.instructions = instructions;
        steps.push({ target: this.name, action: 'global skill', status: 'ok', detail: this.#instruction(ctx) });
      } else {
        steps.push({
          target: this.name,
          action: 'global skill',
          status: 'warning',
          detail: 'SKILL.md not found next to the CLI; the MCP server is still configured',
        });
      }
      await writeConfig(path, data);
      steps.push({ target: this.name, action: 'global mcp', status: 'ok', detail: `${path}: mcp.${PLUGIN}` });
      await this.record(ctx, 'global', { kind: 'json-key', path, key: `mcp.${PLUGIN}` });
      if (await removeOurEntry(this.#projectConfig(ctx))) {
        steps.push({ target: this.name, action: 'project cleanup', status: 'ok', detail: 'removed from project config' });
      }
      await this.forget(ctx, 'project');
    } else {
      await writeConfig(path, data);
      steps.push({ target: this.name, action: 'project mcp', status: 'ok', detail: `${path}: mcp.${PLUGIN}` });
      await this.record(ctx, 'project', { kind: 'json-key', path, key: `mcp.${PLUGIN}` });
      if (await removeOurEntry(this.#globalConfig(ctx), this.#instruction(ctx))) {
        steps.push({ target: this.name, action: 'global cleanup', status: 'ok', detail: 'removed global config' });
      }
      await rm(this.#skillDir(ctx), { recursive: true, force: true });
      await this.forget(ctx, 'global');
    }
    return steps;
  }

  async update(ctx: Ctx, scope: Scope): Promise<Step[]> {
    // The config launches `npx`, which resolves the latest package on next start.
    this.checkScope(scope);
    return [
      {
        target: this.name,
        action: 'update',
        status: 'ok',
        detail: 'config uses npx; the latest version is fetched on next start',
      },
    ];
  }

  async uninstall(ctx: Ctx, scope: Scope | 'all'): Promise<Step[]> {
    const steps: Step[] = [];
    for (const current of this.expand(scope)) {
      if (current === 'global') {
        const changed = await removeOurEntry(this.#globalConfig(ctx), this.#instruction(ctx));
        steps.push({
          target: this.name,
          action: 'global uninstall',
          status: 'ok',
          detail: changed ? 'removed' : 'not installed',
        });
        await rm(this.#skillDir(ctx), { recursive: true, force: true });
      } else {
        const changed = await removeOurEntry(this.#projectConfig(ctx));
        steps.push({
          target: this.name,
          action: 'project uninstall',
          status: 'ok',
          detail: changed ? 'removed' : 'not installed',
        });
      }
      await this.forget(ctx, current);
    }
    return steps;
  }

  async doctor(ctx: Ctx): Promise<Step[]> {
    const steps: Step[] = [];
    let present = false;
    for (const [scope, path] of [
      ['global', this.#globalConfig(ctx)],
      ['project', this.#projectConfig(ctx)],
    ] as const) {
      let ok = false;
      try {
        ok = Boolean((await readConfig(path)).mcp?.[PLUGIN]);
      } catch (error) {
        steps.push({ target: this.name, action: scope, status: 'error', detail: (error as Error).message });
        continue;
      }
      if (ok) present = true;
      steps.push({
        target: this.name,
        action: scope,
        status: ok ? 'ok' : 'skipped',
        detail: ok ? path : 'not installed',
      });
    }
    if (!present) steps.push({ target: this.name, action: 'status', status: 'skipped', detail: 'not installed' });
    return steps;
  }
}

/** Exported for tests. */
export { readConfig as readOpencodeConfig, removeOurEntry as removeOpencodeEntry };
