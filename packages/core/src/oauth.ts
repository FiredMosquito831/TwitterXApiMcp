import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { AuthError } from './errors.js';

export interface OAuthApp {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
  scope?: string;
  tokenType: string;
  /** Stored so refresh works without X_CLIENT_ID in the environment. */
  clientId?: string;
  clientSecret?: string;
}

export interface AuthorizationRequest {
  url: string;
  verifier: string;
  state: string;
  redirectUri: string;
  clientId: string;
  scopes: string[];
}

export const DEFAULT_SCOPES = [
  'tweet.read',
  'tweet.write',
  'tweet.moderate.write',
  'users.read',
  'follows.read',
  'follows.write',
  'like.read',
  'like.write',
  'block.read',
  'block.write',
  'mute.read',
  'mute.write',
  'bookmark.read',
  'bookmark.write',
  'list.read',
  'list.write',
  'dm.read',
  'dm.write',
  'media.write',
  'space.read',
  'offline.access',
];

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function codeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function appFromEnv(overrides: Partial<OAuthApp> = {}): OAuthApp {
  const clientId = overrides.clientId ?? process.env['X_CLIENT_ID'];
  if (!clientId) {
    throw new AuthError(
      'Missing OAuth client id.',
      'Set X_CLIENT_ID (and optionally X_CLIENT_SECRET), or pass --client-id. Create an app at https://console.x.com with OAuth 2.0 enabled.',
    );
  }
  const clientSecret = overrides.clientSecret ?? process.env['X_CLIENT_SECRET'];
  return {
    clientId,
    redirectUri: overrides.redirectUri ?? process.env['X_REDIRECT_URI'] ?? 'http://localhost:8080/callback',
    ...(clientSecret ? { clientSecret } : {}),
  };
}

export function createAuthorization(app: OAuthApp, scopes = DEFAULT_SCOPES): AuthorizationRequest {
  const verifier = base64url(randomBytes(48));
  const state = base64url(randomBytes(16));

  const url = new URL('https://x.com/i/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('redirect_uri', app.redirectUri);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');

  return {
    url: url.toString(),
    verifier,
    state,
    redirectUri: app.redirectUri,
    clientId: app.clientId,
    scopes,
  };
}

export function parseCallback(callbackUrl: string): { code?: string; state?: string; error?: string } {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new AuthError('Callback must be a full URL, e.g. http://localhost:8080/callback?code=…&state=…');
  }
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  return {
    ...(code ? { code } : {}),
    ...(state ? { state } : {}),
    ...(error ? { error } : {}),
  };
}

function formBody(values: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return body;
}

async function tokenRequest(app: OAuthApp, body: URLSearchParams): Promise<OAuthTokens> {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json',
  };
  if (app.clientSecret) {
    headers['authorization'] =
      'Basic ' + Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64');
  }

  const res = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers,
    body,
  });

  const text = await res.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* keep empty */
  }

  if (!res.ok) {
    const detail =
      (payload['error_description'] as string | undefined) ??
      (payload['error'] as string | undefined) ??
      text.slice(0, 200);
    throw new AuthError(`Token request failed (HTTP ${res.status}): ${detail}`);
  }

  const accessToken = payload['access_token'];
  if (typeof accessToken !== 'string') {
    throw new AuthError('Token response did not include access_token');
  }

  const expiresIn = Number(payload['expires_in'] ?? 7200);
  const refreshToken = payload['refresh_token'];
  const scope = payload['scope'];

  return {
    accessToken,
    ...(typeof refreshToken === 'string' ? { refreshToken } : {}),
    expiresAt: Date.now() + expiresIn * 1000,
    ...(typeof scope === 'string' ? { scope } : {}),
    tokenType: String(payload['token_type'] ?? 'bearer'),
  };
}

export async function exchangeCode(
  app: OAuthApp,
  auth: AuthorizationRequest,
  code: string,
): Promise<OAuthTokens> {
  return tokenRequest(
    app,
    formBody({
      grant_type: 'authorization_code',
      code,
      redirect_uri: auth.redirectUri,
      code_verifier: auth.verifier,
      client_id: app.clientId,
    }),
  );
}

export async function refreshTokens(app: OAuthApp, refreshToken: string): Promise<OAuthTokens> {
  return tokenRequest(
    app,
    formBody({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: app.clientId,
    }),
  );
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    /* the URL is printed anyway */
  }
}

export interface LoginServerOptions {
  app: OAuthApp;
  auth: AuthorizationRequest;
  timeoutMs?: number;
  onUrl?: (url: string) => void;
  openBrowser?: boolean;
}

/**
 * Run the loopback redirect flow. The authorization code lives 30 seconds, so
 * the exchange happens inside the callback handler, before responding.
 */
export async function loginWithServer(opts: LoginServerOptions): Promise<OAuthTokens> {
  const { app, auth } = opts;
  const redirect = new URL(auth.redirectUri);
  if (redirect.hostname !== 'localhost' && redirect.hostname !== '127.0.0.1') {
    throw new AuthError('The bundled login server only supports a localhost redirect URI.');
  }

  const port = Number(redirect.port || 80);
  const path = redirect.pathname || '/callback';
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  let settle: (tokens: OAuthTokens) => void = () => {};
  let fail: (err: Error) => void = () => {};
  const result = new Promise<OAuthTokens>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (url.pathname !== path) {
      res.writeHead(404).end('not found');
      return;
    }

    const parsed = parseCallback(url.toString());
    if (parsed.error) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end(`Authorization failed: ${parsed.error}`);
      fail(new AuthError(`Authorization failed: ${parsed.error}`));
      return;
    }
    if (parsed.state !== auth.state) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('state mismatch');
      fail(new AuthError('OAuth state mismatch; aborting.'));
      return;
    }
    if (!parsed.code) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('missing code');
      fail(new AuthError('Callback had no authorization code.'));
      return;
    }

    exchangeCode(app, auth, parsed.code).then(
      (tokens) => {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<h1>xctl authorized</h1><p>You can close this tab and return to the terminal.</p>');
        settle(tokens);
      },
      (err: Error) => {
        res.writeHead(500, { 'content-type': 'text/plain' }).end(err.message);
        fail(err);
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  const timer = setTimeout(() => {
    fail(new AuthError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the callback.`));
  }, timeoutMs);
  timer.unref();

  opts.onUrl?.(auth.url);
  if (opts.openBrowser !== false) openBrowser(auth.url);

  try {
    return await result;
  } finally {
    clearTimeout(timer);
    server.close();
  }
}
