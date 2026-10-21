import { BucketLimiter } from './ratelimit.js';
import { SpendMeter } from './cost.js';
import { OfficialTransport } from './transport.js';
import { AuthError } from './errors.js';
import { loadConfig, resolveProfileName } from './config.js';
import { getJson, oauthKey, openSecretStore, setJson } from './credentials.js';
import { appFromEnv, refreshTokens, type OAuthTokens } from './oauth.js';
import { openState, type StateStore } from './state.js';
import { paths } from './paths.js';
import type { OpContext } from './types.js';

export interface RuntimeOptions {
  /** Profile name; separate credentials and rate budgets per profile. */
  profile?: string;
  /** Overrides the token from the environment or the credential store. */
  token?: string;
  /** Hard spend cap for this process, in USD. Default 5.00. */
  spendCapUsd?: number;
  baseUrl?: string;
  log?: (message: string, fields?: Record<string, unknown>) => void;
  signal?: AbortSignal;
  /** Allow construction without a token, for dry runs that never hit the network. */
  allowMissingToken?: boolean;
}

export interface ResolvedToken {
  token: string;
  source: 'env' | 'oauth2' | 'override';
  expiresAt?: number;
}

function envToken(): string | undefined {
  return process.env['X_USER_TOKEN'] ?? process.env['X_BEARER_TOKEN'] ?? process.env['XCTL_TOKEN'];
}

/** Refresh a stored token when it is close to expiry, persisting the rotation. */
export async function loadStoredToken(profile: string): Promise<ResolvedToken | null> {
  const store = await openSecretStore();
  const tokens = await getJson<OAuthTokens>(store, oauthKey(profile));
  if (!tokens) return null;

  if (tokens.expiresAt - Date.now() > 60_000) {
    return { token: tokens.accessToken, source: 'oauth2', expiresAt: tokens.expiresAt };
  }

  if (!tokens.refreshToken) {
    throw new AuthError(
      `The OAuth token for profile "${profile}" expired and no refresh token was issued.`,
      'Re-run `x auth login --profile ' + profile + '` and make sure the offline.access scope is granted.',
    );
  }

  const refreshed = await refreshTokens(
    appFromEnv({
      ...(tokens.clientId ? { clientId: tokens.clientId } : {}),
      ...(tokens.clientSecret ? { clientSecret: tokens.clientSecret } : {}),
    }),
    tokens.refreshToken,
  );
  const merged: OAuthTokens = {
    ...refreshed,
    ...(tokens.clientId ? { clientId: tokens.clientId } : {}),
    ...(tokens.clientSecret ? { clientSecret: tokens.clientSecret } : {}),
  };
  await setJson(store, oauthKey(profile), merged);
  return { token: merged.accessToken, source: 'oauth2', expiresAt: merged.expiresAt };
}

export async function resolveToken(profile: string, override?: string): Promise<ResolvedToken> {
  if (override) return { token: override, source: 'override' };
  const fromEnv = envToken();
  if (fromEnv) return { token: fromEnv, source: 'env' };
  const stored = await loadStoredToken(profile);
  if (stored) return stored;
  throw new AuthError(
    'No X credential found.',
    'Run `x auth login` to authorize with OAuth 2.0 PKCE, import cookies for the unofficial transport, ' +
      'or set X_USER_TOKEN / X_BEARER_TOKEN.',
  );
}

/**
 * Build the runtime context shared by the CLI and the MCP server.
 *
 * Async because it may refresh an OAuth token and open persistent state.
 */
export async function createRuntime(opts: RuntimeOptions = {}): Promise<OpContext> {
  const config = await loadConfig();
  const profile = resolveProfileName(config, opts.profile);

  let token: string | undefined;
  if (opts.token) {
    token = opts.token;
  } else {
    const fromEnv = envToken();
    if (fromEnv) {
      token = fromEnv;
    } else {
      try {
        token = (await loadStoredToken(profile))?.token;
      } catch (err) {
        if (!opts.allowMissingToken) throw err;
      }
    }
  }

  if (!token && !opts.allowMissingToken) {
    throw new AuthError(
      'No X credential found.',
      'Run `x auth login`, or set X_USER_TOKEN (OAuth 2.0 user token) or X_BEARER_TOKEN (app-only, read-only).',
    );
  }

  const cap = opts.spendCapUsd ?? Number(process.env['XCTL_SPEND_CAP'] ?? 5);
  if (!Number.isFinite(cap) || cap < 0) {
    throw new AuthError(`Invalid spend cap: ${String(cap)}`);
  }

  const state: StateStore = await openState(paths.state());
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const spentThisMonth = await state.spendTotal(profile, monthStart.getTime());

  const log =
    opts.log ??
    ((message: string, fields?: Record<string, unknown>) => {
      const suffix = fields ? ` ${JSON.stringify(fields)}` : '';
      process.stderr.write(`[xctl] ${message}${suffix}\n`);
    });

  const limiter = new BucketLimiter({ profile, state });

  const spend = new SpendMeter({
    capUsd: cap,
    initialTotal: spentThisMonth,
    onCharge: (amount, label, total) => {
      log(`charged $${amount.toFixed(4)} for ${label} (monthly total $${total.toFixed(4)})`);
      void state.recordSpend(profile, amount, label);
    },
  });

  return {
    profile,
    transport: new OfficialTransport({
      getToken: async () => token ?? '',
      onRateLimit: (bucket, headers) => limiter.observe(bucket, headers),
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
    }),
    limiter,
    spend,
    signal: opts.signal ?? new AbortController().signal,
    log,
    hasToken: Boolean(token),
    state,
  };
}
