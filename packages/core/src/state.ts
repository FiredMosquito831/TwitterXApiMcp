import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface BucketRecord {
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface QueueItem {
  id: number;
  profile: string;
  op: string;
  payload: string;
  state: string;
  notBefore: number;
  attempts: number;
  result: string | null;
  error: string | null;
}

export interface StateStore {
  readonly kind: 'sqlite' | 'memory';
  getBucket(profile: string, bucket: string): Promise<BucketRecord | null>;
  setBucket(profile: string, bucket: string, value: BucketRecord): Promise<void>;
  recordSpend(profile: string, amount: number, label: string): Promise<void>;
  spendTotal(profile: string, sinceMs: number): Promise<number>;
  cacheGet(key: string): Promise<string | null>;
  cacheSet(key: string, value: string, ttlMs: number): Promise<void>;
  /** Returns true when the key is new (i.e. the action has not been seen recently). */
  claimDedupe(key: string, ttlMs: number): Promise<boolean>;
  queueAdd(profile: string, op: string, payload: unknown, notBefore: number): Promise<number>;
  queueList(profile?: string): Promise<QueueItem[]>;
  queueDue(now: number): Promise<QueueItem[]>;
  queueMark(id: number, state: string, result?: string, error?: string): Promise<void>;
  queueRemove(id: number): Promise<void>;
  close(): Promise<void>;
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rate_buckets (
  profile TEXT NOT NULL, bucket TEXT NOT NULL,
  limit_n INTEGER NOT NULL, remaining INTEGER NOT NULL, reset_at INTEGER NOT NULL,
  PRIMARY KEY (profile, bucket)
) STRICT;
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY, profile TEXT NOT NULL, ts INTEGER NOT NULL,
  amount REAL NOT NULL, label TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS spend_profile_ts ON spend(profile, ts);
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS dedupe (
  key TEXT PRIMARY KEY, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY, profile TEXT NOT NULL, op TEXT NOT NULL, payload TEXT NOT NULL,
  state TEXT NOT NULL, not_before INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, result TEXT, error TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS queue_ready ON queue(state, not_before);
`;

class SqliteState implements StateStore {
  readonly kind = 'sqlite' as const;
  readonly #db: SqliteDb;

  constructor(db: SqliteDb) {
    this.#db = db;
    this.#db.exec(SCHEMA);
  }

  async getBucket(profile: string, bucket: string): Promise<BucketRecord | null> {
    const row = this.#db
      .prepare('SELECT limit_n, remaining, reset_at FROM rate_buckets WHERE profile=? AND bucket=?')
      .get(profile, bucket);
    if (!row) return null;
    return {
      limit: Number(row['limit_n']),
      remaining: Number(row['remaining']),
      resetAt: Number(row['reset_at']),
    };
  }

  async setBucket(profile: string, bucket: string, value: BucketRecord): Promise<void> {
    this.#db
      .prepare(
        `INSERT INTO rate_buckets(profile,bucket,limit_n,remaining,reset_at) VALUES(?,?,?,?,?)
         ON CONFLICT(profile,bucket) DO UPDATE SET limit_n=excluded.limit_n,
           remaining=excluded.remaining, reset_at=excluded.reset_at`,
      )
      .run(profile, bucket, value.limit, value.remaining, value.resetAt);
  }

  async recordSpend(profile: string, amount: number, label: string): Promise<void> {
    this.#db
      .prepare('INSERT INTO spend(profile,ts,amount,label) VALUES(?,?,?,?)')
      .run(profile, Date.now(), amount, label);
  }

  async spendTotal(profile: string, sinceMs: number): Promise<number> {
    const row = this.#db
      .prepare('SELECT COALESCE(SUM(amount),0) AS total FROM spend WHERE profile=? AND ts>=?')
      .get(profile, sinceMs);
    return Number(row?.['total'] ?? 0);
  }

  async cacheGet(key: string): Promise<string | null> {
    const row = this.#db
      .prepare('SELECT value, expires_at FROM cache WHERE key=?')
      .get(key);
    if (!row) return null;
    if (Number(row['expires_at']) < Date.now()) {
      this.#db.prepare('DELETE FROM cache WHERE key=?').run(key);
      return null;
    }
    return String(row['value']);
  }

  async cacheSet(key: string, value: string, ttlMs: number): Promise<void> {
    this.#db
      .prepare(
        `INSERT INTO cache(key,value,expires_at) VALUES(?,?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at`,
      )
      .run(key, value, Date.now() + ttlMs);
  }

  async claimDedupe(key: string, ttlMs: number): Promise<boolean> {
    const cutoff = Date.now() - ttlMs;
    this.#db.prepare('DELETE FROM dedupe WHERE created_at < ?').run(cutoff);
    const res = this.#db
      .prepare('INSERT OR IGNORE INTO dedupe(key,created_at) VALUES(?,?)')
      .run(key, Date.now());
    return Number(res.changes) > 0;
  }

  async queueAdd(profile: string, op: string, payload: unknown, notBefore: number): Promise<number> {
    const res = this.#db
      .prepare('INSERT INTO queue(profile,op,payload,state,not_before,created_at) VALUES(?,?,?,?,?,?)')
      .run(profile, op, JSON.stringify(payload), 'pending', notBefore, Date.now());
    return Number(res.lastInsertRowid);
  }

  async queueList(profile?: string): Promise<QueueItem[]> {
    const rows = profile
      ? this.#db.prepare('SELECT * FROM queue WHERE profile=? ORDER BY not_before').all(profile)
      : this.#db.prepare('SELECT * FROM queue ORDER BY not_before').all();
    return rows.map(toQueueItem);
  }

  async queueDue(now: number): Promise<QueueItem[]> {
    return this.#db
      .prepare("SELECT * FROM queue WHERE state='pending' AND not_before<=? ORDER BY not_before")
      .all(now)
      .map(toQueueItem);
  }

  async queueMark(id: number, state: string, result?: string, error?: string): Promise<void> {
    this.#db
      .prepare('UPDATE queue SET state=?, attempts=attempts+1, result=?, error=? WHERE id=?')
      .run(state, result ?? null, error ?? null, id);
  }

  async queueRemove(id: number): Promise<void> {
    this.#db.prepare('DELETE FROM queue WHERE id=?').run(id);
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}

function toQueueItem(row: Record<string, unknown>): QueueItem {
  return {
    id: Number(row['id']),
    profile: String(row['profile']),
    op: String(row['op']),
    payload: String(row['payload']),
    state: String(row['state']),
    notBefore: Number(row['not_before']),
    attempts: Number(row['attempts']),
    result: row['result'] === null || row['result'] === undefined ? null : String(row['result']),
    error: row['error'] === null || row['error'] === undefined ? null : String(row['error']),
  };
}

class MemoryState implements StateStore {
  readonly kind = 'memory' as const;
  readonly #buckets = new Map<string, BucketRecord>();
  readonly #spend: Array<{ profile: string; ts: number; amount: number; label: string }> = [];
  readonly #cache = new Map<string, { value: string; expiresAt: number }>();
  readonly #dedupe = new Map<string, number>();
  readonly #queue: Array<QueueItem & { created: number }> = [];
  #nextId = 1;

  async getBucket(profile: string, bucket: string) {
    return this.#buckets.get(`${profile}:${bucket}`) ?? null;
  }
  async setBucket(profile: string, bucket: string, value: BucketRecord) {
    this.#buckets.set(`${profile}:${bucket}`, value);
  }
  async recordSpend(profile: string, amount: number, label: string) {
    this.#spend.push({ profile, ts: Date.now(), amount, label });
  }
  async spendTotal(profile: string, sinceMs: number) {
    return this.#spend
      .filter((s) => s.profile === profile && s.ts >= sinceMs)
      .reduce((sum, s) => sum + s.amount, 0);
  }
  async cacheGet(key: string) {
    const hit = this.#cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
      this.#cache.delete(key);
      return null;
    }
    return hit.value;
  }
  async cacheSet(key: string, value: string, ttlMs: number) {
    this.#cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
  async claimDedupe(key: string, ttlMs: number) {
    const seen = this.#dedupe.get(key);
    if (seen && seen > Date.now() - ttlMs) return false;
    this.#dedupe.set(key, Date.now());
    return true;
  }
  async queueAdd(profile: string, op: string, payload: unknown, notBefore: number) {
    const id = this.#nextId++;
    this.#queue.push({
      id,
      profile,
      op,
      payload: JSON.stringify(payload),
      state: 'pending',
      notBefore,
      attempts: 0,
      result: null,
      error: null,
      created: Date.now(),
    });
    return id;
  }
  async queueList(profile?: string) {
    return this.#queue
      .filter((q) => !profile || q.profile === profile)
      .sort((a, b) => a.notBefore - b.notBefore)
      .map(stripCreated);
  }
  async queueDue(now: number) {
    return this.#queue
      .filter((q) => q.state === 'pending' && q.notBefore <= now)
      .sort((a, b) => a.notBefore - b.notBefore)
      .map(stripCreated);
  }
  async queueMark(id: number, state: string, result?: string, error?: string) {
    const item = this.#queue.find((q) => q.id === id);
    if (!item) return;
    item.state = state;
    item.attempts += 1;
    if (result !== undefined) item.result = result;
    if (error !== undefined) item.error = error;
  }
  async queueRemove(id: number) {
    const index = this.#queue.findIndex((q) => q.id === id);
    if (index >= 0) this.#queue.splice(index, 1);
  }
  async close() {}
}

function stripCreated(item: QueueItem & { created: number }): QueueItem {
  return {
    id: item.id,
    profile: item.profile,
    op: item.op,
    payload: item.payload,
    state: item.state,
    notBefore: item.notBefore,
    attempts: item.attempts,
    result: item.result,
    error: item.error,
  };
}

export async function openState(path: string): Promise<StateStore> {
  try {
    await mkdir(dirname(path), { recursive: true });
    // node:sqlite is still marked experimental and emits a warning on import.
    // It would pollute every CLI invocation, so filter just that one warning.
    const original = process.emitWarning;
    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      if (String(warning).includes('SQLite is an experimental feature')) return;
      (original as (...a: unknown[]) => void)(warning, ...args);
    }) as typeof process.emitWarning;
    try {
      const mod = (await import('node:sqlite')) as unknown as {
        DatabaseSync: new (p: string) => SqliteDb;
      };
      return new SqliteState(new mod.DatabaseSync(path));
    } finally {
      process.emitWarning = original;
    }
  } catch {
    process.stderr.write('warning: node:sqlite unavailable; state will not persist beyond this process\n');
    return new MemoryState();
  }
}
