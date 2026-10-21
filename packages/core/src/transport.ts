import type { Transport, TransportRequest, TransportResponse } from './types.js';

export class XApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly body: unknown;
  readonly rateLimitReset?: number;

  constructor(
    message: string,
    init: { status: number; code?: number | undefined; body?: unknown; rateLimitReset?: number | undefined },
  ) {
    super(message);
    this.name = 'XApiError';
    this.status = init.status;
    if (init.code !== undefined) this.code = init.code;
    this.body = init.body;
    if (init.rateLimitReset !== undefined) this.rateLimitReset = init.rateLimitReset;
  }
}

export interface OfficialTransportOptions {
  /** Returns a user access token or app-only bearer. */
  getToken: () => Promise<string>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** Called with every response so the limiter can seed itself from X's headers. */
  onRateLimit?: (bucket: string, headers: Headers) => void;
}

/**
 * Talks to the official X API v2.
 *
 * Deliberately dumb: no retries, no hidden caching. Retry policy belongs to the
 * queue, because a retried write can duplicate a post.
 */
export class OfficialTransport implements Transport {
  readonly kind = 'official' as const;
  readonly #getToken: () => Promise<string>;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #userAgent: string;
  readonly #onRateLimit: OfficialTransportOptions['onRateLimit'];

  constructor(opts: OfficialTransportOptions) {
    this.#getToken = opts.getToken;
    this.#baseUrl = opts.baseUrl ?? 'https://api.x.com';
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    this.#userAgent = opts.userAgent ?? 'xctl/0.0.0 (+https://github.com/)';
    this.#onRateLimit = opts.onRateLimit;
  }

  async call<T>(req: TransportRequest): Promise<TransportResponse<T>> {
    const token = await this.#getToken();
    const url = new URL(this.#baseUrl + req.path);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      'user-agent': this.#userAgent,
      accept: 'application/json',
    };
    const isForm = req.body instanceof FormData;
    const isParams = req.body instanceof URLSearchParams;
    if (req.body !== undefined && !isForm && !isParams) headers['content-type'] = 'application/json';

    const res = await this.#fetch(url, {
      method: req.method,
      headers,
      ...(req.body === undefined
        ? {}
        : {
            body:
              isForm || isParams
                ? (req.body as string | FormData | URLSearchParams)
                : JSON.stringify(req.body),
          }),
      ...(req.signal ? { signal: req.signal } : {}),
    });

    const text = await res.text();
    this.#onRateLimit?.(req.bucket, res.headers);
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!res.ok) {
      throw this.#toError(res.status, body, res.headers, req);
    }

    return { status: res.status, data: body as T, headers: res.headers };
  }

  #toError(status: number, body: unknown, headers: Headers, req: TransportRequest): XApiError {
    const payload = body as { title?: string; detail?: string; errors?: Array<{ message?: string; code?: number }> } | undefined;
    const first = payload?.errors?.[0];
    const resetHeader = headers.get('x-rate-limit-reset');
    const reset = resetHeader ? Number(resetHeader) : undefined;

    const detail = payload?.detail ?? first?.message ?? payload?.title ?? `HTTP ${status}`;

    if (status === 429) {
      const when = reset ? new Date(reset * 1000).toISOString() : 'unknown';
      return new XApiError(
        `Rate limited on ${req.bucket} until ${when}. Wait for the reset; do not retry in a loop.`,
        { status, code: first?.code, body, ...(reset !== undefined ? { rateLimitReset: reset } : {}) },
      );
    }

    if (status === 403) {
      return new XApiError(
        `${detail}. On self-serve plans, likes, follows and quote-posts are unavailable (removed April 2026), ` +
          `replies require the author to have summoned you, and profile edits have no official endpoint.`,
        { status, code: first?.code, body, ...(reset !== undefined ? { rateLimitReset: reset } : {}) },
      );
    }

    return new XApiError(detail, {
      status,
      code: first?.code,
      body,
      ...(reset !== undefined ? { rateLimitReset: reset } : {}),
    });
  }
}
