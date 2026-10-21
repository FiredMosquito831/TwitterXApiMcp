import { accessSync, constants, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN = 'xctl';
export const MARKETPLACE = 'xctl-marketplace';
export const DEFAULT_SOURCE = 'FiredMosquito831/TwitterXApiMcp';
export const SCOPES = ['global', 'project'] as const;

export type Scope = (typeof SCOPES)[number];
export type StepStatus = 'ok' | 'skipped' | 'error' | 'warning';

export interface Step {
  target: string;
  action: string;
  status: StepStatus;
  detail?: string;
}

export interface Ctx {
  home: string;
  projectDir: string;
  source: string;
  which: (command: string) => string | null;
  run: (command: string[], options?: { cwd?: string }) => { code: number; out: string };
}

export interface Capabilities {
  scopes: readonly Scope[];
  needsRestart: boolean;
  notes?: string;
}

export class UnsupportedScope extends Error {}

export function defaultCtx(source = DEFAULT_SOURCE): Ctx {
  return {
    home: defaultHome(),
    projectDir: process.cwd(),
    source,
    which: (command) => which(command),
    run: (command, options) => runCommand(command, options),
  };
}

function defaultHome(): string {
  const override = process.env['XCTL_HOME'];
  if (override) return override;
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] ?? join(process.env['USERPROFILE'] ?? '.', 'AppData', 'Roaming'), 'xctl');
  }
  return process.env['XDG_CONFIG_HOME']
    ? join(process.env['XDG_CONFIG_HOME'], 'xctl')
    : join(process.env['HOME'] ?? '.', '.config', 'xctl');
}

export function which(command: string): string | null {
  const path = process.env['PATH'] ?? '';
  // Some Windows installs (npm global shims, Claude's local bin) are
  // extensionless, so try the bare name before PATHEXT variants.
  const exts =
    process.platform === 'win32'
      ? ['', ...(process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
      : [''];

  for (const dir of path.split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, command + ext);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

export function runCommand(
  command: string[],
  options: { cwd?: string } = {},
): { code: number; out: string } {
  const [name, ...args] = command;
  if (!name) return { code: 2, out: 'empty command' };

  const exe = which(name);
  if (!exe) return { code: 127, out: `${name} is not on PATH` };

  let result = spawnSync(exe, args, {
    encoding: 'utf8',
    timeout: 600_000,
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });

  // Node cannot execute .cmd/.bat without a shell on Windows.
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'EINVAL') {
    const quoted = command.map((part) => `"${part.replace(/"/g, '\\"')}"`).join(' ');
    result = spawnSync(quoted, {
      encoding: 'utf8',
      shell: true,
      timeout: 600_000,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
  }

  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { code: result.status ?? 1, out };
}

export function stepFromResult(target: string, action: string, code: number, out: string): Step {
  if (code === 0 || /already/i.test(out)) {
    return { target, action, status: 'ok', detail: out.slice(-400) };
  }
  return { target, action, status: 'error', detail: out.slice(-400) || `exit ${code}` };
}

export function cleanupStep(target: string, action: string, code: number, out: string): Step {
  if (code === 0) return { target, action, status: 'ok', detail: out.slice(-200) };
  return { target, action, status: 'ok', detail: 'nothing to clean up (not installed)' };
}

/** The canonical SKILL.md, shipped next to the bundled CLI. */
export function skillText(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'skills', PLUGIN, 'SKILL.md'),
    resolve(here, '..', '..', 'skills', PLUGIN, 'SKILL.md'),
    resolve(here, '..', '..', '..', 'plugins', PLUGIN, 'skills', PLUGIN, 'SKILL.md'),
    resolve(process.cwd(), 'plugins', PLUGIN, 'skills', PLUGIN, 'SKILL.md'),
  ];
  for (const candidate of candidates) {
    try {
      const text = readFileSync(candidate, 'utf8');
      if (text.includes('name: xctl')) return text;
    } catch {
      /* try the next location */
    }
  }
  return null;
}

/** Server command used in file-based harness configs. */
export function serverCommand(): string[] {
  return ['npx', '-y', '--package', 'x-mcp-automation', 'xctl-mcp'];
}

export abstract class Harness {
  abstract readonly name: string;
  readonly cli: string | null = null;
  abstract readonly capabilities: Capabilities;

  checkScope(scope: Scope): void {
    if (!this.capabilities.scopes.includes(scope)) {
      const notes = this.capabilities.notes ? ` ${this.capabilities.notes}` : '';
      throw new UnsupportedScope(
        `${this.name} does not support scope "${scope}". Supports: ${this.capabilities.scopes.join(', ')}.${notes}`,
      );
    }
  }

  expand(scope: Scope | 'all'): Scope[] {
    if (scope === 'all') return [...this.capabilities.scopes];
    this.checkScope(scope);
    return [scope];
  }

  cliPresent(ctx: Ctx): boolean {
    return this.cli === null || ctx.which(this.cli) !== null;
  }

  abstract install(ctx: Ctx, scope: Scope): Promise<Step[]> | Step[];
  abstract update(ctx: Ctx, scope: Scope): Promise<Step[]> | Step[];
  abstract uninstall(ctx: Ctx, scope: Scope): Promise<Step[]> | Step[];
  abstract doctor(ctx: Ctx): Promise<Step[]> | Step[];

  // ---- per-harness state: exactly what installation wrote ----

  statePath(ctx: Ctx): string {
    return join(ctx.home, 'state', `${this.name}.json`);
  }

  async recorded(ctx: Ctx, scope: Scope): Promise<Array<Record<string, unknown>>> {
    try {
      const data = JSON.parse(await readFile(this.statePath(ctx), 'utf8')) as Record<
        string,
        { items?: Array<Record<string, unknown>> }
      >;
      return data[this.scopeKey(ctx, scope)]?.items ?? [];
    } catch {
      return [];
    }
  }

  async record(ctx: Ctx, scope: Scope, item: Record<string, unknown>): Promise<void> {
    let data: Record<string, { items: Array<Record<string, unknown>>; updated?: string }> = {};
    try {
      data = JSON.parse(await readFile(this.statePath(ctx), 'utf8')) as typeof data;
    } catch {
      /* new file */
    }
    const key = this.scopeKey(ctx, scope);
    const entry = data[key] ?? { items: [] };
    entry.items = [...entry.items.filter((existing) => JSON.stringify(existing) !== JSON.stringify(item)), item];
    entry.updated = new Date().toISOString();
    data[key] = entry;
    await mkdir(dirname(this.statePath(ctx)), { recursive: true });
    await writeFile(this.statePath(ctx), JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  async forget(ctx: Ctx, scope: Scope): Promise<void> {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(await readFile(this.statePath(ctx), 'utf8')) as Record<string, unknown>;
    } catch {
      return;
    }
    if (data[this.scopeKey(ctx, scope)] !== undefined) {
      delete data[this.scopeKey(ctx, scope)];
      await writeFile(this.statePath(ctx), JSON.stringify(data, null, 2), { mode: 0o600 });
    }
  }

  scopeKey(ctx: Ctx, scope: Scope): string {
    return scope === 'global' ? 'global' : `project:${resolve(ctx.projectDir)}`;
  }
}
