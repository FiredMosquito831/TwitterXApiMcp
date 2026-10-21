import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  paths,
  XApiError,
  type GraphQLCallOptions,
  type V11CallOptions,
  type WebClient,
} from '@xctl/core';
import { cookieHeader, type CookieSet } from './cookies.js';
import { discoverOperations, type OperationMeta } from './queryids.js';
import { createTransactionGenerator } from './transaction.js';
import { BASE_FEATURES } from './features.js';

const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const QUERY_ID_TTL_MS = 24 * 60 * 60_000;
const TRANSACTION_TTL_MS = 30 * 60_000;

export interface XWebClientOptions {
  cookies: CookieSet;
  profile: string;
  fetchImpl?: typeof fetch;
  log?: LogFn;
  userAgent?: string;
  /** Reuse a cached query-id table even if stale (useful offline). */
  cacheOnly?: boolean;
}

interface QueryIdCache {
  fetchedAt: number;
  ops: Record<string, OperationMeta>;
}

type LogFn = (message: string, fields?: Record<string, unknown>) => void;

/**
 * Client for X's private web API.
 *
 * This is the transport X's automation rules prohibit. It exists because the
 * user explicitly opted in; it is never used by the official operations.
 */
export class XWebClient implements WebClient {
  readonly kind = 'unofficial' as const;
  readonly #cookies: CookieSet;
  readonly #profile: string;
  readonly #fetch: typeof fetch;
  readonly #log: LogFn;
  readonly #userAgent: string;
  readonly #cacheOnly: boolean;

  #homeHtml: string | null = null;
  #materialsHtml: string | null = null;
  #ops: Promise<Record<string, OperationMeta>> | null = null;
  #tx: ReturnType<typeof createTransactionGenerator> | null = null;
  #txCreatedAt = 0;

  constructor(opts: XWebClientOptions) {
    this.#cookies = opts.cookies;
    this.#profile = opts.profile;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#log = opts.log ?? (() => {});
    this.#userAgent = opts.userAgent ?? CHROME_UA;
    this.#cacheOnly = opts.cacheOnly ?? false;
  }

  hasCookies(): boolean {
    return Boolean(this.#cookies.auth_token && this.#cookies.ct0);
  }

  async queryIds(): Promise<Record<string, string>> {
    const ops = await this.#operations();
    return Object.fromEntries(Object.entries(ops).map(([name, meta]) => [name, meta.queryId]));
  }

  async graphql<T>(
    operation: string,
    variables: Record<string, unknown> = {},
    opts: GraphQLCallOptions = {},
  ): Promise<T> {
    const method = opts.method ?? 'POST';
    let attempt = 0;

    for (;;) {
      attempt += 1;
      const ops = await this.#operations(attempt > 1);
      const meta = ops[operation];
      if (!meta) {
        throw new Error(
          `Operation ${operation} not found in the current bundle. The operation may have been renamed; ` +
            'run `x unofficial refresh` to re-scan.',
        );
      }

      const path = `/i/api/graphql/${meta.queryId}/${operation}`;
      const features = { ...BASE_FEATURES, ...(opts.features ?? {}) };
      const payload: Record<string, unknown> = { variables, features };
      if (opts.fieldToggles) payload['fieldToggles'] = opts.fieldToggles;

      let url = `https://x.com${path}`;
      const init: RequestInit = { method, headers: { ...this.#headers() } };
      if (method === 'GET') {
        const params = new URLSearchParams();
        params.set('variables', JSON.stringify(variables));
        params.set('features', JSON.stringify(features));
        if (opts.fieldToggles) params.set('fieldToggles', JSON.stringify(opts.fieldToggles));
        url += `?${params.toString()}`;
      } else {
        init.body = JSON.stringify(payload);
        (init.headers as Record<string, string>)['content-type'] = 'application/json';
      }

      const tid = await this.#transactionId(method, path);
      if (tid) (init.headers as Record<string, string>)['x-client-transaction-id'] = tid;

      const res = await this.#fetch(url, init);
      const text = await res.text();

      if (res.status === 404 && attempt < 3) {
        // Either the transaction id or the query id drifted. Refresh both.
        this.#log('graphql 404; refreshing transaction id and query ids', { operation, attempt });
        this.#tx = null;
        this.#ops = null;
        continue;
      }

      if (!res.ok) {
        throw new XApiError(this.#describe(res.status, text, operation), {
          status: res.status,
          body: text,
          ...(res.headers.get('x-rate-limit-reset')
            ? { rateLimitReset: Number(res.headers.get('x-rate-limit-reset')) }
            : {}),
        });
      }

      const json = JSON.parse(text) as { errors?: Array<{ message?: string; code?: number }> };
      const first = json.errors?.[0];
      if (first) {
        throw new XApiError(first.message ?? `GraphQL error in ${operation}`, {
          status: res.status,
          ...(typeof first.code === 'number' ? { code: first.code } : {}),
          body: json,
        });
      }
      return json as T;
    }
  }

  async v11<T>(path: string, opts: V11CallOptions = {}): Promise<T> {
    const method = opts.method ?? 'POST';
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const base = normalized.startsWith('/1.1/') ? normalized : `/1.1/${normalized}`;
    let url = `https://x.com${base}`;

    const headers: Record<string, string> = { ...this.#headers() };
    const init: RequestInit = { method, headers };

    if (method === 'GET') {
      if (opts.query) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(opts.query)) {
          if (value !== undefined) params.set(key, String(value));
        }
        url += `?${params.toString()}`;
      }
    } else {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.form ?? {})) form.set(key, value);
      headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = form.toString();
    }

    const res = await this.#fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      throw new XApiError(this.#describe(res.status, text, base), {
        status: res.status,
        body: text,
        ...(res.headers.get('x-rate-limit-reset')
          ? { rateLimitReset: Number(res.headers.get('x-rate-limit-reset')) }
          : {}),
      });
    }

    const json = (text ? JSON.parse(text) : {}) as {
      errors?: Array<{ message?: string; code?: number }>;
    };
    const first = json.errors?.[0];
    if (first) {
      // v1.1 frequently reports failures with HTTP 200 and an errors array.
      throw new XApiError(first.message ?? `v1.1 error in ${base}`, {
        status: res.status,
        ...(typeof first.code === 'number' ? { code: first.code } : {}),
        body: json,
      });
    }
    return json as T;
  }

  /** Drop cached bundles and transaction materials. */
  refresh(): void {
    this.#homeHtml = null;
    this.#materialsHtml = null;
    this.#ops = null;
    this.#tx = null;
  }

  #headers(): Record<string, string> {
    return {
      authorization: `Bearer ${BEARER}`,
      'x-csrf-token': this.#cookies.ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      'user-agent': this.#userAgent,
      referer: 'https://x.com/',
      origin: 'https://x.com',
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      cookie: cookieHeader(this.#cookies),
    };
  }

  async #transactionId(method: string, path: string): Promise<string | null> {
    try {
      if (!this.#tx || Date.now() - this.#txCreatedAt > TRANSACTION_TTL_MS) {
        this.#txCreatedAt = Date.now();
        const html = await this.#materialsPage();
        this.#tx = createTransactionGenerator(html, {
          fetchImpl: this.#fetch,
          userAgent: this.#userAgent,
          cookieHeader: cookieHeader(this.#cookies),
        });
      }
      const generator = await this.#tx;
      return generator.generate(method, path);
    } catch (err) {
      this.#log('transaction-id generation failed; continuing without it', {
        error: (err as Error).message,
      });
      return null;
    }
  }

  async #operations(force = false): Promise<Record<string, OperationMeta>> {
    if (!this.#ops || force) {
      this.#ops = this.#loadOrDiscover(force);
    }
    return this.#ops;
  }

  async #loadOrDiscover(force: boolean): Promise<Record<string, OperationMeta>> {
    if (force) {
      this.#homeHtml = null;
      this.#materialsHtml = null;
    }
    if (!force) {
      const cached = await this.#readCache();
      if (cached && Date.now() - cached.fetchedAt < QUERY_ID_TTL_MS && Object.keys(cached.ops).length) {
        return cached.ops;
      }
    }

    if (this.#cacheOnly) {
      const cached = await this.#readCache();
      if (cached) return cached.ops;
    }

    const html = await this.#homePage();
    let ops = await discoverOperations(html, {
      fetchImpl: this.#fetch,
      userAgent: this.#userAgent,
      cookieHeader: cookieHeader(this.#cookies),
    });

    if (!Object.keys(ops).length) {
      // Logged-out home is the x-web build; /i/jf/ still serves responsive-web.
      const fallback = await this.#materialsPage();
      ops = await discoverOperations(fallback, {
        fetchImpl: this.#fetch,
        userAgent: this.#userAgent,
        cookieHeader: cookieHeader(this.#cookies),
      });
    }

    if (!Object.keys(ops).length) {
      const cached = await this.#readCache();
      if (cached) {
        this.#log('no operations discovered; falling back to the cached table');
        return cached.ops;
      }
      throw new Error(
        'Could not discover GraphQL operation ids. X likely changed the bundle layout; ' +
          'try `x unofficial refresh` or update xctl.',
      );
    }

    await this.#writeCache({ fetchedAt: Date.now(), ops });
    return ops;
  }

  async #homePage(): Promise<string> {
    if (this.#homeHtml) return this.#homeHtml;
    const res = await this.#fetch('https://x.com/home', {
      headers: {
        'user-agent': this.#userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'upgrade-insecure-requests': '1',
        cookie: cookieHeader(this.#cookies),
      },
      redirect: 'follow',
    });
    const html = await res.text();
    this.#homeHtml = html;
    return html;
  }

  /** `/i/jf/` still serves the responsive-web runtime that carries the key and frames. */
  async #materialsPage(): Promise<string> {
    if (this.#materialsHtml) return this.#materialsHtml;
    const res = await this.#fetch('https://x.com/i/jf/', {
      headers: {
        'user-agent': this.#userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'upgrade-insecure-requests': '1',
        cookie: cookieHeader(this.#cookies),
      },
      redirect: 'follow',
    });
    const html = await res.text();
    this.#materialsHtml = html;
    return html;
  }

  async #readCache(): Promise<QueryIdCache | null> {
    try {
      const raw = await readFile(paths.queryIds(), 'utf8');
      const parsed = JSON.parse(raw) as QueryIdCache;
      if (!parsed?.ops || typeof parsed.fetchedAt !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async #writeCache(cache: QueryIdCache): Promise<void> {
    try {
      const path = paths.queryIds();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ ...cache, profile: this.#profile }), { mode: 0o600 });
    } catch {
      /* cache is optional */
    }
  }

  #describe(status: number, text: string, operation: string): string {
    let detail = text.slice(0, 300);
    try {
      const json = JSON.parse(text) as { errors?: Array<{ message?: string }> };
      detail = json.errors?.[0]?.message ?? detail;
    } catch {
      /* keep raw */
    }

    if (status === 404 && !text) {
      return (
        `${operation}: empty 404 — this is what X returns when the transaction id or query id is stale. ` +
        'Try `x unofficial refresh`.'
      );
    }
    if (status === 403) {
      return `${operation}: 403 — the session cookie was rejected or the account is restricted.`;
    }
    if (status === 429) {
      return `${operation}: rate limited. Wait for the reset header before retrying.`;
    }
    return `${operation}: HTTP ${status} ${detail}`;
  }
}
