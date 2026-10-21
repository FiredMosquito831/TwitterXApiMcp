import type { RateLimitSnapshot, RateLimiter } from './types.js';
import type { StateStore } from './state.js';

const WINDOW_MS = 15 * 60_000;

interface Bucket {
  limit: number;
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
}

const CONSERVATIVE: Record<string, number> = {
  tweets: 100,
  search: 300,
  users: 300,
  dm: 15,
  media: 500,
  lists: 300,
  bookmarks: 300,
  usage: 50,
};

/**
 * Token buckets keyed by rate-limit bucket name, persisted per profile.
 *
 * X reports `x-rate-limit-limit|remaining|reset` on every response. We seed
 * from those headers after each call rather than trusting our own arithmetic;
 * the local count only bridges the gap between calls.
 */
export class BucketLimiter implements RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #profile: string;
  readonly #state: StateStore | undefined;
  #loaded = false;

  constructor(opts: { sleep?: (ms: number) => Promise<void>; profile?: string; state?: StateStore } = {}) {
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#profile = opts.profile ?? 'default';
    this.#state = opts.state;
  }

  async acquire(bucket: string, cost = 1): Promise<void> {
    await this.#load();
    const now = Date.now();
    const b = this.#buckets.get(bucket) ?? this.#seed(bucket, now);

    if (now >= b.resetAt) {
      b.remaining = b.limit;
      b.resetAt = now + WINDOW_MS;
    }

    if (b.remaining >= cost) {
      b.remaining -= cost;
      void this.#persist(bucket, b);
      return;
    }

    const wait = b.resetAt - now;
    if (wait > 0) await this.#sleep(wait + 250);
    b.remaining = b.limit - cost;
    b.resetAt = Date.now() + WINDOW_MS;
    void this.#persist(bucket, b);
  }

  observe(bucket: string, headers: Headers): void {
    const limit = Number(headers.get('x-rate-limit-limit'));
    const remaining = Number(headers.get('x-rate-limit-remaining'));
    const reset = Number(headers.get('x-rate-limit-reset'));

    if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset)) {
      return;
    }

    const b: Bucket = { limit, remaining, resetAt: reset * 1000 };
    this.#buckets.set(bucket, b);
    void this.#persist(bucket, b);
  }

  snapshot(): Record<string, RateLimitSnapshot> {
    const out: Record<string, RateLimitSnapshot> = {};
    for (const [bucket, b] of this.#buckets) {
      out[bucket] = {
        bucket,
        limit: b.limit,
        remaining: b.remaining,
        reset: Math.floor(b.resetAt / 1000),
      };
    }
    return out;
  }

  async #load(): Promise<void> {
    if (this.#loaded || !this.#state) {
      this.#loaded = true;
      return;
    }
    this.#loaded = true;
    for (const bucket of Object.keys(CONSERVATIVE)) {
      const stored = await this.#state.getBucket(this.#profile, bucket);
      if (stored) this.#buckets.set(bucket, stored);
    }
  }

  async #persist(bucket: string, value: Bucket): Promise<void> {
    await this.#state?.setBucket(this.#profile, bucket, value);
  }

  #seed(bucket: string, now: number): Bucket {
    const limit = CONSERVATIVE[bucket] ?? 50;
    const b: Bucket = { limit, remaining: limit, resetAt: now + WINDOW_MS };
    this.#buckets.set(bucket, b);
    return b;
  }
}
