import {
  DEFAULT_SOURCE,
  SCOPES,
  UnsupportedScope,
  defaultCtx,
  which,
  type Ctx,
  type Scope,
  type Step,
} from './base.js';
import { ClaudeHarness } from './claude.js';
import { CodexHarness } from './codex.js';
import { OpencodeHarness } from './opencode.js';
import { AntigravityHarness } from './antigravity.js';

export const HARNESSES = {
  claude: new ClaudeHarness(),
  codex: new CodexHarness(),
  opencode: new OpencodeHarness(),
  antigravity: new AntigravityHarness(),
} as const;

export type TargetName = keyof typeof HARNESSES;
export const TARGETS = Object.keys(HARNESSES) as TargetName[];

export type Action = 'install' | 'update' | 'uninstall';

export function normalizeScope(value: string): Scope {
  const scope = value.toLowerCase();
  if (scope === 'global' || scope === 'user') return 'global';
  if (scope === 'project' || scope === 'local') return 'project';
  throw new Error(`Unknown scope "${value}". Use global (Claude: user) or project.`);
}

export function resolveTargets(names: string[]): TargetName[] {
  const cleaned = names.map((name) => name.trim()).filter(Boolean);
  if (!cleaned.length || cleaned.includes('all')) return [...TARGETS];
  const unknown = cleaned.filter((name) => !(name in HARNESSES));
  if (unknown.length) {
    throw new Error(`Unknown target(s): ${unknown.join(', ')}. Valid: ${TARGETS.join(', ')}, all`);
  }
  return cleaned as TargetName[];
}

export async function dispatch(
  action: Action,
  targets: string[],
  scope: Scope | 'all',
  ctx: Ctx,
): Promise<Step[]> {
  const names = resolveTargets(targets);
  const explicit = targets.length > 0 && !targets.includes('all');
  const steps: Step[] = [];

  for (const name of names) {
    const harness = HARNESSES[name];
    try {
      let result: Step[];
      if (action === 'uninstall') {
        result = await harness.uninstall(ctx, scope);
      } else {
        if (scope === 'all') throw new Error(`Scope "all" is only valid for uninstall.`);
        result = action === 'install'
          ? await harness.install(ctx, scope)
          : await harness.update(ctx, scope);
      }
      steps.push(...result);
    } catch (error) {
      if (error instanceof UnsupportedScope) {
        if (explicit) throw error;
        steps.push({ target: name, action, status: 'skipped', detail: error.message });
        continue;
      }
      steps.push({ target: name, action, status: 'error', detail: (error as Error).message });
    }
  }
  return steps;
}

export async function doctorHarnesses(ctx: Ctx): Promise<Step[]> {
  const steps: Step[] = [];
  for (const name of TARGETS) {
    try {
      steps.push(...(await HARNESSES[name].doctor(ctx)));
    } catch (error) {
      steps.push({ target: name, action: 'doctor', status: 'error', detail: (error as Error).message });
    }
  }
  return steps;
}

export function printSteps(steps: Step[]): void {
  for (const step of steps) {
    const detail = step.detail ? `  ${step.detail}` : '';
    process.stdout.write(`${step.status.padEnd(8)} ${step.target.padEnd(12)} ${step.action}${detail}\n`);
  }
}

export { DEFAULT_SOURCE, SCOPES, defaultCtx, which, UnsupportedScope };
export type { Ctx, Scope, Step };
