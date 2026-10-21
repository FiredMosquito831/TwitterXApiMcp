/** Shared shapes for every transport and operation. */

export type RateClass = 'read' | 'search' | 'write' | 'media';

/** Where an operation is allowed to execute. */
export type TransportKind = 'official' | 'gateway' | 'unofficial';

export interface TransportRequest {
  method: 'GET' | 'POST' | 'DELETE' | 'PUT';
  /** Path relative to the API base, e.g. `/2/tweets`. */
  path: string;
  /** Rate-limit bucket name reported by X, e.g. `tweets`. */
  bucket: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
}

export interface TransportResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface Transport {
  readonly kind: TransportKind;
  call<T>(req: TransportRequest): Promise<TransportResponse<T>>;
}

export interface GraphQLCallOptions {
  method?: 'GET' | 'POST';
  features?: Record<string, boolean>;
  fieldToggles?: Record<string, boolean>;
  /** Override the discovered query id (rarely needed). */
  queryId?: string;
}

export interface V11CallOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  /** Form-encoded body for v1.1 write endpoints. */
  form?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
}

/**
 * The unofficial web client. Implemented in `@xctl/unofficial`; defined here so
 * the operation registry does not depend on that package.
 */
export interface WebClient {
  readonly kind: 'unofficial';
  graphql<T>(operation: string, variables?: Record<string, unknown>, opts?: GraphQLCallOptions): Promise<T>;
  v11<T>(path: string, opts?: V11CallOptions): Promise<T>;
  queryIds(): Promise<Record<string, string>>;
  hasCookies(): boolean;
}

/** Everything an operation needs at runtime. */
export interface OpContext {
  readonly profile: string;
  readonly transport: Transport;
  readonly limiter: RateLimiter;
  readonly spend: SpendMeter;
  readonly signal: AbortSignal;
  readonly log: (message: string, fields?: Record<string, unknown>) => void;
  /** False when the runtime was built with allowMissingToken and found none. */
  readonly hasToken: boolean;
  /** Present only when the unofficial adapter is enabled and cookies exist. */
  readonly web?: WebClient;
  readonly state?: import('./state.js').StateStore;
}

export interface RateLimitSnapshot {
  bucket: string;
  limit: number;
  remaining: number;
  /** Unix seconds, as sent by X. */
  reset: number;
}

export interface RateLimiter {
  /** Resolves when the bucket has capacity; throws if the wait exceeds the budget. */
  acquire(bucket: string, cost?: number): Promise<void>;
  /** Seed the bucket from response headers. Never trust local arithmetic across processes. */
  observe(bucket: string, headers: Headers): void;
  snapshot(): Record<string, RateLimitSnapshot>;
}

export interface SpendMeter {
  /** Estimated cost in USD for the operation about to run. */
  estimate(amount: number): number;
  /** Throws if the spend would exceed the configured cap. */
  assertWithinCap(amount: number): void;
  record(amount: number, label: string): void;
  total(): number;
}
