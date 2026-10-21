import {
  MARKETPLACE,
  PLUGIN,
  cleanupStep,
  stepFromResult,
  Harness,
  type Capabilities,
  type Ctx,
  type Scope,
  type Step,
} from './base.js';

const NEEDLE = `${PLUGIN}@${MARKETPLACE}`;
const MCP_NAME = `plugin:${PLUGIN}:${PLUGIN}`;

function claudeScope(scope: Scope): 'user' | 'project' {
  return scope === 'global' ? 'user' : 'project';
}

function listedScope(text: string, needle: string): Scope | null {
  const index = text.indexOf(needle);
  if (index < 0) return null;
  const match = /Scope:\s*(\w+)/.exec(text.slice(index, index + 300));
  if (!match) return null;
  const scope = (match[1] ?? '').toLowerCase();
  return scope === 'user' ? 'global' : scope === 'project' ? 'project' : null;
}

/**
 * Claude Code: marketplace + plugin, at user scope (global) or project scope.
 *
 * Notes carried over from a live-tested setup:
 * - `claude plugin list` only shows plugins visible from the current folder, so
 *   the check runs from the folder that matches the scope.
 * - Installing both scopes would run two servers, so changing scope removes the
 *   other one.
 * - The marketplace is shared by every folder; never remove it during uninstall.
 */
export class ClaudeHarness extends Harness {
  readonly name = 'claude';
  override readonly cli = 'claude';
  readonly capabilities: Capabilities = {
    scopes: ['global', 'project'],
    needsRestart: true,
    notes: 'global = Claude user scope; project = .claude/settings.json in the project folder',
  };

  #cwd(ctx: Ctx, scope: Scope): string | undefined {
    return scope === 'project' ? ctx.projectDir : undefined;
  }

  install(ctx: Ctx, scope: Scope): Step[] {
    this.checkScope(scope);
    if (!this.cliPresent(ctx)) {
      return [{ target: this.name, action: 'install', status: 'skipped', detail: 'claude is not on PATH' }];
    }

    const s = claudeScope(scope);
    const cwd = this.#cwd(ctx, scope);
    const steps: Step[] = [];

    let result = ctx.run(['claude', 'plugin', 'marketplace', 'add', ctx.source, '--scope', s], { ...(cwd ? { cwd } : {}) });
    steps.push(stepFromResult(this.name, `marketplace add (${scope})`, result.code, result.out));
    if (result.code === 0 || /already/i.test(result.out)) {
      void this.record(ctx, scope, { kind: 'marketplace', scope: s });
    }

    result = ctx.run(['claude', 'plugin', 'install', NEEDLE, '--scope', s, '-y'], { ...(cwd ? { cwd } : {}) });
    steps.push(stepFromResult(this.name, `plugin install (${scope})`, result.code, result.out));
    if (result.code === 0 || /already/i.test(result.out)) {
      void this.record(ctx, scope, { kind: 'plugin', scope: s });
    }

    // A manually added server would duplicate the plugin's server.
    ctx.run(['claude', 'mcp', 'remove', PLUGIN, '--scope', 'user']);
    ctx.run(['claude', 'mcp', 'remove', PLUGIN, '--scope', 'project'], { cwd: ctx.projectDir });

    // Only one scope at a time: two servers would answer the same tools.
    const other: Scope = scope === 'global' ? 'project' : 'global';
    const otherCwd = this.#cwd(ctx, other);
    result = ctx.run(
      ['claude', 'plugin', 'uninstall', NEEDLE, '--scope', claudeScope(other), '-y'],
      { ...(otherCwd ? { cwd: otherCwd } : {}) },
    );
    steps.push(cleanupStep(this.name, `scope ${other} cleaned`, result.code, result.out));
    void this.forget(ctx, other);

    steps.push({
      target: this.name,
      action: 'restart',
      status: 'ok',
      detail: 'restart Claude Code in the project folder (if project scope) to load the plugin',
    });
    return steps;
  }

  update(ctx: Ctx, scope: Scope): Step[] {
    this.checkScope(scope);
    if (!this.cliPresent(ctx)) {
      return [{ target: this.name, action: 'update', status: 'skipped', detail: 'claude is not on PATH' }];
    }
    const cwd = this.#cwd(ctx, scope);
    const steps: Step[] = [];
    let result = ctx.run(['claude', 'plugin', 'marketplace', 'update', MARKETPLACE]);
    steps.push(stepFromResult(this.name, 'marketplace update', result.code, result.out));
    result = ctx.run(['claude', 'plugin', 'update', NEEDLE, '--scope', claudeScope(scope), '-y'], {
      ...(cwd ? { cwd } : {}),
    });
    steps.push(stepFromResult(this.name, `plugin update (${scope})`, result.code, result.out));
    steps.push({ target: this.name, action: 'restart', status: 'ok', detail: 'restart Claude Code' });
    return steps;
  }

  uninstall(ctx: Ctx, scope: Scope | 'all'): Step[] {
    if (!this.cliPresent(ctx)) {
      return [{ target: this.name, action: 'uninstall', status: 'skipped', detail: 'claude is not on PATH' }];
    }
    const steps: Step[] = [];
    for (const current of this.expand(scope)) {
      const cwd = this.#cwd(ctx, current);
      const result = ctx.run(
        ['claude', 'plugin', 'uninstall', NEEDLE, '--scope', claudeScope(current), '-y'],
        { ...(cwd ? { cwd } : {}) },
      );
      steps.push(cleanupStep(this.name, `plugin uninstall (${current})`, result.code, result.out));
      void this.forget(ctx, current);
    }
    // Intentionally do not remove the marketplace: it is shared by every folder.
    return steps;
  }

  doctor(ctx: Ctx): Step[] {
    if (!this.cliPresent(ctx)) {
      return [{ target: this.name, action: 'status', status: 'skipped', detail: 'claude is not on PATH' }];
    }
    const steps: Step[] = [];
    const present: Scope[] = [];
    for (const scope of this.capabilities.scopes) {
      const cwd = this.#cwd(ctx, scope);
      const result = ctx.run(['claude', 'plugin', 'list'], { ...(cwd ? { cwd } : {}) });
      const found = listedScope(result.out, NEEDLE) === scope;
      if (found) present.push(scope);
      steps.push({
        target: this.name,
        action: `plugin (${scope})`,
        status: found ? 'ok' : 'skipped',
        detail: found ? 'installed' : `not installed at ${scope} scope`,
      });
    }

    const mcp = ctx.run(['claude', 'mcp', 'list'], { cwd: ctx.projectDir });
    const connected = mcp.out.includes(MCP_NAME) && /connected/i.test(mcp.out);
    if (present.length) {
      steps.push({
        target: this.name,
        action: 'mcp server',
        status: connected ? 'ok' : 'warning',
        detail: connected ? 'connected' : 'plugin installed, server not connected: restart Claude Code',
      });
    } else {
      steps.push({
        target: this.name,
        action: 'status',
        status: 'skipped',
        detail: 'not installed globally or in this project',
      });
    }
    return steps;
  }
}
