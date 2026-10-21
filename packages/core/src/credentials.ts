import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from './paths.js';

export interface SecretStore {
  readonly kind: 'keyring' | 'file';
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const SERVICE = 'xctl';

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(value: string): void;
  deletePassword(): boolean;
}

interface KeyringModule {
  Entry: new (service: string, account: string, opts?: unknown) => KeyringEntry;
}

async function keyringModule(): Promise<KeyringModule | null> {
  try {
    const mod = (await import('@napi-rs/keyring')) as unknown as KeyringModule;
    return typeof mod.Entry === 'function' ? mod : null;
  } catch {
    return null;
  }
}

export function keyringStore(mod: KeyringModule): SecretStore {
  const entry = (key: string) => new mod.Entry(SERVICE, key, { linux: { store: 'secret-service' } });
  return {
    kind: 'keyring',
    async get(key) {
      try {
        return entry(key).getPassword();
      } catch {
        return null;
      }
    },
    async set(key, value) {
      entry(key).setPassword(value);
    },
    async delete(key) {
      try {
        entry(key).deletePassword();
      } catch {
        /* already gone */
      }
    },
  };
}

export function fileStore(dir = paths.credentials()): SecretStore {
  const path = (key: string) => join(dir, `${key.replace(/[^\w.-]/g, '_')}.json`);

  return {
    kind: 'file',
    async get(key) {
      try {
        const raw = await readFile(path(key), 'utf8');
        return (JSON.parse(raw) as { secret?: string }).secret ?? null;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path(key);
      await writeFile(file, JSON.stringify({ secret: value }), { mode: 0o600 });
      await chmod(file, 0o600).catch(() => {
        /* Windows has no mode bits; the file stays user-scoped */
      });
    },
    async delete(key) {
      await unlink(path(key)).catch(() => {
        /* already gone */
      });
    },
  };
}

/**
 * Prefer the OS keychain. Fall back to a 0600 file with a loud warning —
 * on Windows that is not ACL isolation, it is merely user-scoped storage.
 */
export async function openSecretStore(): Promise<SecretStore> {
  const mod = await keyringModule();
  if (mod) {
    try {
      const store = keyringStore(mod);
      const probe = `__probe_${process.pid}`;
      await store.set(probe, '1');
      const value = await store.get(probe);
      await store.delete(probe);
      if (value === '1') return store;
    } catch {
      /* fall through */
    }
  }

  process.stderr.write(
    'warning: OS keychain unavailable; credentials will be stored in user-scoped files under ' +
      `${paths.credentials()}\n`,
  );
  return fileStore();
}

export async function getJson<T>(store: SecretStore, key: string): Promise<T | null> {
  const raw = await store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJson(store: SecretStore, key: string, value: unknown): Promise<void> {
  await store.set(key, JSON.stringify(value));
}

export function oauthKey(profile: string): string {
  return `profile:${profile}:oauth2`;
}

export function cookieKey(profile: string): string {
  return `profile:${profile}:cookies`;
}
