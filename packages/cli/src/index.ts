#!/usr/bin/env node
import { Command } from 'commander';
import * as z from 'zod/v4';
import { spawnSync } from 'node:child_process';
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import {
  DEFAULT_SCOPES,
  appFromEnv,
  cookieKey,
  createAuthorization,
  createRuntime,
  ensureProfile,
  exchangeCode,
  getJson,
  loadConfig,
  loadStoredToken,
  loginWithServer,
  oauthKey,
  openSecretStore,
  parseCallback,
  paths,
  resolveProfileName,
  setJson,
  updateConfig,
  VERSION,
  XApiError,
  type OAuthApp,
  type OAuthTokens,
  type OpContext,
} from '@xctl/core';
import { registry, type AnyOperation } from '@xctl/ops';
import {
  HARNESSES,
  defaultCtx,
  dispatch,
  doctorHarnesses,
  normalizeScope,
  printSteps,
  resolveTargets,
  which,
} from './harnesses/index.js';

interface PendingAuth {
  profile: string;
  verifier: string;
  state: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  url: string;
  createdAt: number;
}

const GROUP_HELP: Record<string, string> = {
  account: 'Inspect the authenticated account',
  posts: 'Create, read, edit and delete posts',
  users: 'Profiles, follows lists, blocks and mutes',
  media: 'Upload media',
  dms: 'Direct messages',
  bookmarks: 'Bookmarks',
  lists: 'Lists',
  analytics: 'Engagement summaries',
  usage: 'Billing and credit usage',
  articles: 'Long-form Articles',
  trends: 'Trending topics',
  spaces: 'Spaces (read-only)',
  communities: 'Communities (read-only)',
  news: 'X News stories',
  likes: 'Likes (unofficial transport only)',
  follows: 'Follow/unfollow (unofficial transport only)',
  profile: 'Profile editing (unofficial transport only)',
};

/* ------------------------------------------------------------------ flags */

interface JsonProp {
  type?: string;
  enum?: readonly unknown[];
  description?: string;
  items?: { type?: string };
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonProp>;
  required?: readonly string[];
}

function flagsFromSchema(cmd: Command, schema: z.ZodObject<z.ZodRawShape>): void {
  const js = z.toJSONSchema(schema, { io: 'input' }) as JsonSchema;

  for (const [key, prop] of Object.entries(js.properties ?? {})) {
    const flag = key.replace(/_/g, '-');
    const required = js.required?.includes(key) ?? false;
    const desc = prop.description ?? '';

    switch (prop.type) {
      case 'boolean':
        cmd.option(`--${flag}`, desc);
        break;
      case 'array':
        cmd.option(`--${flag} <value...>`, desc);
        break;
      case 'object':
        cmd.option(`--${flag} <json>`, `${desc} (JSON)`);
        break;
      default:
        if (prop.enum?.length) {
          cmd.option(`--${flag} ${required ? '<value>' : '[value]'}`, `${desc} (${prop.enum.join('|')})`);
        } else {
          cmd.option(`--${flag} ${required ? '<value>' : '[value]'}`, desc);
        }
    }
  }
}

function coerce(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value === '') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  // Numbers are handled by z.coerce.number() in the operation schema; coercing
  // here would turn ids like `123` into numbers and break z.string() fields.
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function normalize(opts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value === undefined) continue;
    if (key === 'confirm') continue;
    const snake = key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    out[snake] = coerce(value);
  }
  return out;
}

/* --------------------------------------------------------------- helpers */

function fail(err: unknown): never {
  if (err instanceof XApiError) {
    process.stderr.write(`xctl: ${err.message}\n`);
  } else {
    process.stderr.write(`xctl: ${(err as Error).message}\n`);
  }
  process.exit(1);
}

function isUnofficial(op: AnyOperation): boolean {
  return op.transports.includes('unofficial') && !op.transports.includes('official');
}

async function loadOperations(): Promise<AnyOperation[]> {
  const config = await loadConfig();
  const ops: AnyOperation[] = [...(registry as readonly AnyOperation[])];
  if (config.unofficial.enabled) {
    const mod = await import('@xctl/unofficial');
    ops.push(...(mod.unofficialRegistry as readonly AnyOperation[]));
  }
  return ops;
}

async function contextFor(
  op: AnyOperation,
  globals: { profile?: string; spendCap?: number },
  input: unknown,
  base?: OpContext,
): Promise<OpContext> {
  const dryRun = (input as { dry_run?: boolean }).dry_run === true;
  const unofficialOnly = isUnofficial(op);
  const ctx =
    base ??
    (await createRuntime({
      ...(globals.profile ? { profile: globals.profile } : {}),
      ...(globals.spendCap !== undefined ? { spendCapUsd: globals.spendCap } : {}),
      ...(dryRun || unofficialOnly ? { allowMissingToken: true } : {}),
    }));

  if (unofficialOnly) {
    const config = await loadConfig();
    if (!config.unofficial.enabled) {
      throw new Error('The unofficial transport is disabled. Run `x config set-unofficial on --i-understand`.');
    }
    const mod = await import('@xctl/unofficial');
    const web = await mod.createWebClient(ctx.profile);
    return { ...ctx, web };
  }

  return ctx;
}

/* -------------------------------------------------------------- program */

const program = new Command();

const CLI_NAME = process.env['XCTL_CLI_NAME'] === 'xctl' ? 'xctl' : 'x';
const DEFAULT_MARKETPLACE = process.env['XCTL_MARKETPLACE'] ?? 'FiredMosquito831/TwitterXApiMcp';

program
  .name(CLI_NAME)
  .description('Terminal control plane for your own X account')
  .version(VERSION)
  .option('--json', 'emit compact machine-readable JSON')
  .option('--profile <name>', 'account profile to use')
  .option('--spend-cap <usd>', 'hard spend cap for this invocation', parseFloat)
  .showSuggestionAfterError();

const groups = new Map<string, Command>();

/* ---------------------------------------------------------------- auth */

const auth = program.command('auth').description('Manage OAuth tokens and browser cookies');

auth
  .command('login')
  .description('Authorize with OAuth 2.0 PKCE (opens a browser)')
  .option('--profile <name>', 'profile to store the token under')
  .option('--client-id <id>', 'OAuth client id (defaults to X_CLIENT_ID)')
  .option('--client-secret <secret>', 'OAuth client secret (defaults to X_CLIENT_SECRET)')
  .option('--redirect-uri <uri>', 'redirect URI registered on the app')
  .option('--scopes <list>', 'space or comma separated scopes')
  .option('--manual', 'print the URL and finish later with `x auth complete`')
  .action(async (opts, command: Command) => {
    try {
      const globals = command.optsWithGlobals() as { profile?: string };
      const config = await loadConfig();
      const profile = resolveProfileName(config, globals.profile ?? (opts.profile as string | undefined));
      const app = appFromEnv({
        ...(opts.clientId ? { clientId: opts.clientId as string } : {}),
        ...(opts.clientSecret ? { clientSecret: opts.clientSecret as string } : {}),
        ...(opts.redirectUri ? { redirectUri: opts.redirectUri as string } : {}),
      });
      const scopes = opts.scopes
        ? String(opts.scopes).split(/[\s,]+/).filter(Boolean)
        : DEFAULT_SCOPES;
      const request = createAuthorization(app, scopes);

      if (opts.manual) {
        const pending: PendingAuth = {
          profile,
          verifier: request.verifier,
          state: request.state,
          redirectUri: request.redirectUri,
          clientId: app.clientId,
          ...(app.clientSecret ? { clientSecret: app.clientSecret } : {}),
          scopes,
          url: request.url,
          createdAt: Date.now(),
        };
        await writeFile(paths.pendingAuth(), JSON.stringify(pending, null, 2), { mode: 0o600 });
        process.stdout.write(`${request.url}\n\nAfter authorizing, run:\n  x auth complete --callback "<full callback URL>"\n`);
        return;
      }

      const tokens = await loginWithServer({
        app,
        auth: request,
        onUrl: (url) => process.stderr.write(`Open this URL if the browser did not open:\n${url}\n`),
      });
      await persistTokens(profile, tokens, app);
      process.stdout.write(`Authorized profile "${profile}".\n`);
    } catch (err) {
      fail(err);
    }
  });

auth
  .command('complete')
  .description('Finish a manual login with the callback URL')
  .requiredOption('--callback <url>', 'full callback URL, including code and state')
  .action(async (opts) => {
    try {
      const { paths: authPaths } = await import('@xctl/core');
      let pending: PendingAuth;
      try {
        pending = JSON.parse(await readFile(authPaths.pendingAuth(), 'utf8')) as PendingAuth;
      } catch {
        throw new Error('No pending login. Run `x auth login --manual` first.');
      }
      if (Date.now() - pending.createdAt > 15 * 60_000) {
        throw new Error('Pending login expired; run `x auth login --manual` again.');
      }

      const parsed = parseCallback(String(opts.callback));
      if (parsed.error) throw new Error(`Authorization failed: ${parsed.error}`);
      if (!parsed.code) throw new Error('Callback URL has no code parameter');
      if (parsed.state !== pending.state) throw new Error('State mismatch; aborting');

      const app = appFromEnv({
        clientId: pending.clientId,
        ...(pending.clientSecret ? { clientSecret: pending.clientSecret } : {}),
        redirectUri: pending.redirectUri,
      });
      const tokens = await exchangeCode(
        app,
        {
          url: pending.url,
          verifier: pending.verifier,
          state: pending.state,
          redirectUri: pending.redirectUri,
          clientId: pending.clientId,
          scopes: pending.scopes,
        },
        parsed.code,
      );
      await persistTokens(pending.profile, tokens, app);
      await unlink(paths.pendingAuth()).catch(() => {});
      process.stdout.write(`Authorized profile "${pending.profile}".\n`);
    } catch (err) {
      fail(err);
    }
  });

auth
  .command('status')
  .description('Show credential state for a profile')
  .option('--live', 'also call the API to verify the token')
  .action(async (opts, command: Command) => {
    try {
      const globals = command.optsWithGlobals() as { profile?: string };
      const config = await loadConfig();
      const profile = resolveProfileName(config, globals.profile);
      const store = await openSecretStore();
      const tokens = await getJson<OAuthTokens>(store, oauthKey(profile));
      const cookies = await getJson<Record<string, string>>(store, cookieKey(profile));

      const report = {
        profile,
        secret_store: store.kind,
        oauth2: tokens
          ? {
              present: true,
              expires_at: new Date(tokens.expiresAt).toISOString(),
              expired: tokens.expiresAt <= Date.now(),
              has_refresh: Boolean(tokens.refreshToken),
              scopes: tokens.scope ?? null,
            }
          : { present: false },
        cookies: cookies ? { present: true, has_auth_token: Boolean(cookies['auth_token']), has_ct0: Boolean(cookies['ct0']) } : { present: false },
        unofficial_enabled: config.unofficial.enabled,
        profiles: Object.keys(config.profiles),
      };

      if (opts.live) {
        const live = await loadStoredToken(profile).catch((err: Error) => ({ error: err.message }));
        Object.assign(report, { live });
      }

      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } catch (err) {
      fail(err);
    }
  });

auth
  .command('logout')
  .description('Remove stored credentials for a profile')
  .action(async (opts, command: Command) => {
    try {
      const globals = command.optsWithGlobals() as { profile?: string };
      const config = await loadConfig();
      const profile = resolveProfileName(config, globals.profile);
      const store = await openSecretStore();
      await store.delete(oauthKey(profile));
      await store.delete(cookieKey(profile));
      process.stdout.write(`Removed credentials for "${profile}".\n`);
    } catch (err) {
      fail(err);
    }
  });

auth
  .command('import-cookies')
  .description('Import cookies from Cookie-Editor JSON, storageState, or a Cookie header')
  .requiredOption('--file <path>', 'JSON or text file containing the cookies')
  .action(async (opts, command: Command) => {
    try {
      const globals = command.optsWithGlobals() as { profile?: string };
      const config = await loadConfig();
      const profile = resolveProfileName(config, globals.profile);
      const raw = await readFile(String(opts.file), 'utf8');
      const mod = await import('@xctl/unofficial');
      const cookies = mod.parseCookies(raw);
      await mod.saveCookies(profile, cookies);
      const userId = mod.userIdFromCookies(cookies);
      process.stderr.write(
        'warning: the unofficial transport uses a browser session against private endpoints. X prohibits this and may ' +
          'suspend the account. It stays disabled until you run `x config set-unofficial on --i-understand`.\n',
      );
      process.stdout.write(
        JSON.stringify({ profile, userId, cookies: Object.keys(cookies).length }, null, 2) + '\n',
      );
    } catch (err) {
      fail(err);
    }
  });

async function persistTokens(profile: string, tokens: OAuthTokens, app?: OAuthApp): Promise<void> {
  const store = await openSecretStore();
  const stored: OAuthTokens = {
    ...tokens,
    ...(app ? { clientId: app.clientId } : {}),
    ...(app?.clientSecret ? { clientSecret: app.clientSecret } : {}),
  };
  await setJson(store, oauthKey(profile), stored);
  await ensureProfile(profile, 'oauth2');

  // Best effort: record the handle so `x auth status` can identify the account.
  let identity: { id?: string; username?: string } = {};
  try {
    const res = await fetch('https://api.x.com/2/users/me', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { id?: string; username?: string } };
      identity = json.data ?? {};
    }
  } catch {
    /* identity is cosmetic */
  }

  await updateConfig((config) => {
    const existing = config.profiles[profile] ?? { authType: 'oauth2', createdAt: new Date().toISOString() };
    config.profiles[profile] = {
      ...existing,
      authType: 'oauth2',
      ...(tokens.scope ? { scopes: tokens.scope.split(' ') } : {}),
      ...(identity.id ? { userId: identity.id } : {}),
      ...(identity.username ? { handle: identity.username } : {}),
      updatedAt: new Date().toISOString(),
    };
    config.activeProfile = profile;
  });
}

/* -------------------------------------------------------------- config */

const configCmd = program.command('config').description('View and change local configuration');

configCmd
  .command('show')
  .description('Print the effective configuration')
  .action(async () => {
    const config = await loadConfig();
    process.stdout.write(JSON.stringify(config, null, 2) + '\n');
  });

configCmd
  .command('use-profile <name>')
  .description('Set the default profile')
  .action(async (name: string) => {
    await updateConfig((config) => {
      config.activeProfile = name;
    });
    process.stdout.write(`Active profile: ${name}\n`);
  });

configCmd
  .command('set-unofficial <state>')
  .description('Enable or disable the unofficial transport (on|off)')
  .option('--i-understand', 'acknowledge that X prohibits this and may suspend the account')
  .action(async (state: string, opts: { iUnderstand?: boolean }) => {
    if (state !== 'on' && state !== 'off') fail(new Error('state must be on or off'));
    if (state === 'on' && opts.iUnderstand !== true) {
      fail(
        new Error(
          'Enabling the unofficial transport requires --i-understand. It uses your logged-in browser session against ' +
            'private endpoints; X prohibits this and may permanently suspend the account.',
        ),
      );
    }
    await updateConfig((config) => {
      config.unofficial = {
        enabled: state === 'on',
        ...(state === 'on' ? { acknowledgedAt: new Date().toISOString() } : {}),
      };
    });
    process.stdout.write(`Unofficial transport: ${state}\n`);
  });

/* ------------------------------------------------------- install/doctor */

program
  .command('install [targets...]')
  .description('Install the MCP server into agents: claude, codex, opencode, antigravity, or all')
  .option('--scope <scope>', 'global (Claude: user) or project', 'global')
  .option('--source <owner/repo>', 'marketplace repository', DEFAULT_MARKETPLACE)
  .option('--agent <agent>', 'deprecated: same as a positional target (or none)')
  .option('--dry-run', 'show what would be installed')
  .action(async (targets: string[], opts) => {
    try {
      const names = targets.length
        ? targets
        : opts.agent && String(opts.agent) !== 'none'
          ? [String(opts.agent)]
          : ['claude'];
      const scope = normalizeScope(String(opts.scope));
      const ctx = defaultCtx(String(opts.source));

      if (opts.dryRun) {
        for (const name of resolveTargets(names)) {
          const harness = HARNESSES[name];
          process.stdout.write(
            `would install ${name} at ${scope} scope` +
              (harness.capabilities.scopes.includes(scope) ? '' : ' (unsupported)') +
              '\n',
          );
        }
        process.stdout.write('would run: auth login is separate, then restart the agent\n');
        return;
      }

      const steps = await dispatch('install', names, scope, ctx);
      printSteps(steps);
      if (steps.some((step) => step.status === 'error')) process.exitCode = 1;
      else process.stdout.write(`\nNext: ${CLI_NAME} auth login, then restart the agent.\n`);
    } catch (error) {
      fail(error);
    }
  });

program
  .command('update [targets...]')
  .description('Update the installed plugin or config for one or more agents')
  .option('--scope <scope>', 'global (Claude: user) or project', 'global')
  .option('--source <owner/repo>', 'marketplace repository', DEFAULT_MARKETPLACE)
  .action(async (targets: string[], opts) => {
    try {
      const steps = await dispatch('update', targets, normalizeScope(String(opts.scope)), defaultCtx(String(opts.source)));
      printSteps(steps);
      if (steps.some((step) => step.status === 'error')) process.exitCode = 1;
    } catch (error) {
      fail(error);
    }
  });

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function collectChecks(profile: string): Promise<Check[]> {
  const config = await loadConfig();
  const store = await openSecretStore();
  const tokens = await getJson<OAuthTokens>(store, oauthKey(profile));
  const cookies = await getJson<Record<string, string>>(store, cookieKey(profile));

  let queryCache: { exists: boolean; ageHours: number | null } = { exists: false, ageHours: null };
  try {
    const info = await stat(paths.queryIds());
    queryCache = { exists: true, ageHours: Math.round((Date.now() - info.mtimeMs) / 36_000) / 100 };
  } catch {
    /* not cached */
  }

  const claudePath = which('claude');
  let claudeVersion = 'not found (optional)';
  if (claudePath) {
    const probe = spawnSync(claudePath, ['--version'], { encoding: 'utf8' });
    claudeVersion = probe.error ? 'not found (optional)' : String(probe.stdout).trim();
  }
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const harnessChecks = (await doctorHarnesses(defaultCtx())).map((step) => ({
    name: `${step.target}:${step.action}`.slice(0, 24),
    ok: step.status !== 'error',
    detail: `${step.status}${step.detail ? ` — ${step.detail}` : ''}`,
  }));

  return [
    { name: 'node', ok: nodeMajor >= 24, detail: process.versions.node },
    { name: 'secret_store', ok: true, detail: store.kind },
    {
      name: 'oauth',
      ok: Boolean(tokens),
      detail: tokens
        ? `expires ${new Date(tokens.expiresAt).toISOString()}${tokens.refreshToken ? ', refreshable' : ''}`
        : 'not signed in',
    },
    {
      name: 'cookies',
      ok: Boolean(cookies),
      detail: cookies ? `${Object.keys(cookies).length} cookies` : 'not imported',
    },
    { name: 'unofficial', ok: true, detail: config.unofficial.enabled ? 'enabled' : 'disabled' },
    {
      name: 'query_ids',
      ok: !config.unofficial.enabled || queryCache.exists,
      detail: queryCache.exists ? `cached ${queryCache.ageHours}h ago` : 'not cached',
    },
    {
      name: 'claude_cli',
      ok: true,
      detail: claudeVersion,
    },
    { name: 'config', ok: true, detail: paths.config() },
    { name: 'profile', ok: true, detail: profile },
    ...harnessChecks,
  ];
}

function printChecks(profile: string, checks: Check[], json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify({ profile, checks }, null, 2) + '\n');
    return;
  }
  for (const check of checks) {
    process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(13)} ${check.detail}\n`);
  }
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

program
  .command('doctor')
  .description('Check local setup without contacting X')
  .option('--json', 'machine-readable output')
  .action(async (opts, command: Command) => {
    const globals = command.optsWithGlobals() as { profile?: string };
    const config = await loadConfig();
    const profile = resolveProfileName(config, globals.profile);
    const checks = await collectChecks(profile);
    printChecks(profile, checks, Boolean(opts.json));
  });

/* --------------------------------------------------- setup / uninstall */

async function needsLogin(profile: string): Promise<boolean> {
  if (process.env['X_USER_TOKEN'] || process.env['X_BEARER_TOKEN'] || process.env['XCTL_TOKEN']) {
    return false;
  }
  const store = await openSecretStore();
  const tokens = await getJson<OAuthTokens>(store, oauthKey(profile));
  if (!tokens) return true;
  return tokens.expiresAt <= Date.now() && !tokens.refreshToken;
}

function runLoginSubprocess(profile: string): number {
  const entry = process.argv[1];
  if (!entry) return 1;
  const result = spawnSync(process.execPath, [entry, 'auth', 'login', '--profile', profile], {
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

program
  .command('setup')
  .description('Sign in, install the MCP server into agents, then check the setup')
  .option('--agent <agent>', 'claude (default), all, a comma list, or none', 'claude')
  .option('--scope <scope>', 'global (Claude: user) or project', 'global')
  .option('--source <owner/repo>', 'marketplace repository', DEFAULT_MARKETPLACE)
  .option('--marketplace <owner/repo>', 'deprecated alias for --source')
  .option('--skip-auth', 'do not start the OAuth login')
  .option('--dry-run', 'print what would happen')
  .action(async (opts, command: Command) => {
    const globals = command.optsWithGlobals() as { profile?: string };
    const config = await loadConfig();
    const profile = resolveProfileName(config, globals.profile);
    const agent = String(opts.agent);
    const names = agent === 'none' ? [] : agent.split(',').map((name) => name.trim()).filter(Boolean);
    const scope = normalizeScope(String(opts.scope));
    const source = String(opts.source ?? opts.marketplace ?? DEFAULT_MARKETPLACE);
    const ctx = defaultCtx(source);

    if (opts.dryRun) {
      process.stdout.write(`profile: ${profile}\n`);
      if (!opts.skipAuth) process.stdout.write('would sign in if no token is stored\n');
      for (const name of resolveTargets(names)) {
        process.stdout.write(`would install ${name} at ${scope} scope\n`);
      }
      process.stdout.write('would run: doctor\n');
      return;
    }

    if (!opts.skipAuth && (await needsLogin(profile))) {
      process.stderr.write('Signing in to X (a browser window will open)...\n');
      const code = runLoginSubprocess(profile);
      if (code !== 0) {
        process.stderr.write('warning: sign-in did not complete. Run `xctl auth login` when ready.\n');
      }
    }

    if (names.length) {
      const steps = await dispatch('install', names, scope, ctx);
      printSteps(steps);
    }

    const checks = await collectChecks(profile);
    printChecks(profile, checks, false);
  });

program
  .command('uninstall [targets...]')
  .description('Remove the MCP server from agents, and optionally stored credentials')
  .option('--agent <agent>', 'deprecated: same as a positional target')
  .option('--scope <scope>', 'all, global or project', 'all')
  .option('--source <owner/repo>', 'marketplace repository', DEFAULT_MARKETPLACE)
  .option('--purge', 'also delete stored OAuth tokens and cookies for the active profile')
  .option('--dry-run', 'print what would happen')
  .action(async (targets: string[], opts, command: Command) => {
    const globals = command.optsWithGlobals() as { profile?: string };
    const config = await loadConfig();
    const profile = resolveProfileName(config, globals.profile);
    const names = targets.length ? targets : opts.agent ? [String(opts.agent)] : ['all'];
    const scopeRaw = String(opts.scope).toLowerCase();
    const scope = scopeRaw === 'all' ? 'all' : normalizeScope(scopeRaw);
    const ctx = defaultCtx(String(opts.source));

    if (opts.dryRun) {
      for (const name of resolveTargets(names)) {
        process.stdout.write(`would uninstall ${name} at ${scope} scope\n`);
      }
      if (opts.purge) process.stdout.write(`would delete credentials for profile "${profile}"\n`);
    } else {
      const steps = await dispatch('uninstall', names, scope, ctx);
      printSteps(steps);
      if (steps.some((step) => step.status === 'error')) process.exitCode = 1;

      if (opts.purge) {
        const store = await openSecretStore();
        await store.delete(oauthKey(profile));
        await store.delete(cookieKey(profile));
        process.stdout.write(`Deleted stored tokens and cookies for "${profile}".\n`);
      }
    }

    process.stdout.write(
      '\nTo remove the command itself:\n' +
        '  npm uninstall -g x-mcp-automation\n' +
        '  pipx uninstall x-mcp-automation\n' +
        `Local config and state remain in: ${paths.home()}\n`,
    );
  });

/* ------------------------------------------------------------ unofficial */

const unofficial = program.command('unofficial').description('Unofficial transport diagnostics');

unofficial
  .command('refresh')
  .description('Re-scan the X bundles for GraphQL operation ids')
  .action(async (_opts, command: Command) => {
    try {
      const globals = command.optsWithGlobals() as { profile?: string };
      const config = await loadConfig();
      const profile = resolveProfileName(config, globals.profile);
      const mod = await import('@xctl/unofficial');
      const client = await mod.createWebClient(profile);
      client.refresh();
      const ids = await client.queryIds();
      process.stdout.write(JSON.stringify({ operations: Object.keys(ids).length }, null, 2) + '\n');
    } catch (err) {
      fail(err);
    }
  });

unofficial
  .command('operations')
  .description('List discovered GraphQL operations')
  .action(async (_opts, command: Command) => {
    try {
      const globals = command.optsWithGlobals() as { profile?: string };
      const config = await loadConfig();
      const mod = await import('@xctl/unofficial');
      const client = await mod.createWebClient(resolveProfileName(config, globals.profile));
      const ids = await client.queryIds();
      for (const [name, id] of Object.entries(ids).sort()) process.stdout.write(`${name}  ${id}\n`);
    } catch (err) {
      fail(err);
    }
  });

/* --------------------------------------------------------------- queue */

const queue = program.command('queue').description('Schedule operations locally');

queue
  .command('add')
  .description('Queue an operation for later')
  .requiredOption('--op <id>', 'operation id, e.g. posts.create')
  .option('--input <json>', 'operation input as JSON', '{}')
  .option('--at <iso>', 'ISO-8601 time to run')
  .option('--in <duration>', 'delay like 10m, 2h, 30s')
  .action(async (opts, command: Command) => {
    try {
      const globals = command.optsWithGlobals() as { profile?: string };
      const ops = await loadOperations();
      const op = ops.find((candidate) => candidate.id === opts.op);
      if (!op) fail(new Error(`Unknown operation: ${opts.op}. Run \`x ops\` for the list.`));
      const input = JSON.parse(String(opts.input)) as unknown;
      const parsed = op.input.safeParse(input);
      if (!parsed.success) fail(new Error(z.prettifyError(parsed.error)));

      const config = await loadConfig();
      const profile = resolveProfileName(config, globals.profile);
      // Scheduling only touches local state, so it must not require a token.
      const ctx = await createRuntime({ profile, allowMissingToken: true });
      const when = parseWhen(opts.at as string | undefined, opts.in as string | undefined);
      const id = await ctx.state?.queueAdd(profile, op.id, parsed.data, when);
      process.stdout.write(JSON.stringify({ queued: id, at: new Date(when).toISOString() }) + '\n');
    } catch (err) {
      fail(err);
    }
  });

queue
  .command('list')
  .description('List queued operations')
  .action(async (_opts, command: Command) => {
    const globals = command.optsWithGlobals() as { profile?: string };
    const config = await loadConfig();
    const ctx = await createRuntime({ profile: resolveProfileName(config, globals.profile), allowMissingToken: true });
    const items = (await ctx.state?.queueList()) ?? [];
    process.stdout.write(JSON.stringify(items, null, 2) + '\n');
  });

queue
  .command('remove <id>')
  .description('Remove a queued operation')
  .action(async (id: string, _opts, command: Command) => {
    const globals = command.optsWithGlobals() as { profile?: string };
    const config = await loadConfig();
    const ctx = await createRuntime({ profile: resolveProfileName(config, globals.profile), allowMissingToken: true });
    await ctx.state?.queueRemove(Number(id));
    process.stdout.write(`Removed ${id}\n`);
  });

queue
  .command('run')
  .description('Run due queued operations (foreground worker)')
  .option('--once', 'process due items once and exit')
  .option('--interval <seconds>', 'poll interval', '30')
  .action(async (opts, command: Command) => {
    const globals = command.optsWithGlobals() as { profile?: string };
    const config = await loadConfig();
    const profile = resolveProfileName(config, globals.profile);
    const ops = await loadOperations();
    const interval = Math.max(5, Number(opts.interval)) * 1000;

    // One runtime for the whole worker; rebuild it if a token expires mid-run.
    let ctx = await createRuntime({ profile, allowMissingToken: true });

    for (;;) {
      const due = (await ctx.state?.queueDue(Date.now())) ?? [];
      for (const item of due) {
        const op = ops.find((candidate) => candidate.id === item.op);
        if (!op) {
          await ctx.state?.queueMark(item.id, 'dead', undefined, `unknown operation ${item.op}`);
          continue;
        }
        try {
          const input = JSON.parse(item.payload) as unknown;
          const parsed = op.input.safeParse(input);
          if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
          const runCtx = await contextFor(op, { profile }, parsed.data, ctx);
          const result = await op.run(runCtx, parsed.data);
          await ctx.state?.queueMark(item.id, 'done', JSON.stringify(result));
          process.stdout.write(`ran ${item.op} (#${item.id})\n`);
        } catch (err) {
          if (err instanceof XApiError && err.status === 401) {
            ctx = await createRuntime({ profile, allowMissingToken: true });
          }
          await ctx.state?.queueMark(item.id, 'failed', undefined, (err as Error).message);
          process.stderr.write(`failed ${item.op} (#${item.id}): ${(err as Error).message}\n`);
        }
      }
      if (opts.once) break;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  });

function parseWhen(at?: string, delay?: string): number {
  if (at) {
    const parsed = Date.parse(at);
    if (Number.isNaN(parsed)) throw new Error(`Invalid --at value: ${at}`);
    return parsed;
  }
  if (delay) {
    const match = /^(\d+)\s*(s|m|h|d)$/.exec(delay.trim());
    if (!match) throw new Error('--in must look like 30s, 10m, 2h or 1d');
    const amount = Number(match[1]);
    const unit = match[2];
    const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return Date.now() + amount * factor;
  }
  return Date.now();
}

/* ---------------------------------------------------------- generated ops */

const operations = await loadOperations();

for (const op of operations) {
  const [groupName, verb] = op.id.split('.');
  if (!groupName || !verb) continue;

  let group = groups.get(groupName);
  if (!group) {
    group = program.command(groupName).description(GROUP_HELP[groupName] ?? '');
    groups.set(groupName, group);
  }

  const cmd = group
    .command(verb.replace(/_/g, '-'))
    .description(op.summary)
    .configureHelp({ showGlobalOptions: true });

  flagsFromSchema(cmd, op.input);
  if (isUnofficial(op)) cmd.option('--confirm', 'acknowledge the account-suspension risk for this action');

  cmd.action(async (...args: unknown[]) => {
    const opts = (args[0] ?? {}) as Record<string, unknown>;
    const command = args[1] as Command;
    const globals = command.optsWithGlobals() as { json?: boolean; profile?: string; spendCap?: number };

    const input = normalize(opts);
    const parsed = op.input.safeParse(input);
    if (!parsed.success) {
      process.stderr.write(`Invalid input for ${op.id}:\n${z.prettifyError(parsed.error)}\n`);
      process.exitCode = 2;
      return;
    }

    if (isUnofficial(op)) {
      if ((opts['confirm'] ?? command.opts().confirm) !== true && !process.argv.includes('--confirm')) {
        process.stderr.write(
          'Refusing to run an unofficial operation without --confirm.\n' +
            'X prohibits automation through private endpoints and may suspend the account.\n',
        );
        process.exitCode = 2;
        return;
      }
    }

    try {
      const ctx = await contextFor(op, globals, parsed.data);
      const result = await op.run(ctx, parsed.data);
      process.stdout.write(
        globals.json ? JSON.stringify(result) + '\n' : JSON.stringify(result, null, 2) + '\n',
      );
    } catch (err) {
      fail(err);
    }
  });
}

program
  .command('ops')
  .description('List every operation this build exposes')
  .option('--json', 'machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const rows = (await loadOperations()).map((op) => ({
      id: op.id,
      mcp: op.mcpName,
      summary: op.summary,
      rate_class: op.rateClass,
      transports: op.transports,
      destructive: op.annotations.destructiveHint,
      write: !op.annotations.readOnlyHint,
    }));
    if (opts.json) {
      process.stdout.write(JSON.stringify(rows) + '\n');
      return;
    }
    const width = Math.max(...rows.map((r) => r.id.length));
    for (const r of rows) {
      process.stdout.write(`${r.id.padEnd(width)}  ${r.write ? 'W' : 'R'}  ${r.summary}\n`);
    }
  });

await program.parseAsync(process.argv);
