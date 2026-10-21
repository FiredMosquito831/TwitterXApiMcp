import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths, ensureHome } from './paths.js';
import { ConfigError } from './errors.js';

export type AuthType = 'oauth2' | 'bearer' | 'cookies' | 'env';

export interface ProfileConfig {
  handle?: string;
  userId?: string;
  authType: AuthType;
  scopes?: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface UnofficialConfig {
  enabled: boolean;
  acknowledgedAt?: string;
}

export interface Config {
  version: 1;
  activeProfile: string;
  unofficial: UnofficialConfig;
  profiles: Record<string, ProfileConfig>;
}

export function defaultConfig(): Config {
  return {
    version: 1,
    activeProfile: 'default',
    unofficial: { enabled: false },
    profiles: {},
  };
}

export async function loadConfig(): Promise<Config> {
  await ensureHome();
  let raw: string;
  try {
    raw = await readFile(paths.config(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig();
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`Config file is not valid JSON: ${paths.config()}`);
  }

  return normalize(parsed);
}

function normalize(value: unknown): Config {
  const base = defaultConfig();
  if (!value || typeof value !== 'object') return base;
  const input = value as Partial<Config>;

  const profiles: Record<string, ProfileConfig> = {};
  for (const [name, profile] of Object.entries(input.profiles ?? {})) {
    if (!profile || typeof profile !== 'object') continue;
    const p = profile as Partial<ProfileConfig>;
    profiles[name] = {
      authType: p.authType ?? 'oauth2',
      createdAt: p.createdAt ?? new Date().toISOString(),
      ...(p.handle !== undefined ? { handle: p.handle } : {}),
      ...(p.userId !== undefined ? { userId: p.userId } : {}),
      ...(p.scopes !== undefined ? { scopes: p.scopes } : {}),
      ...(p.updatedAt !== undefined ? { updatedAt: p.updatedAt } : {}),
    };
  }

  return {
    version: 1,
    activeProfile: input.activeProfile ?? base.activeProfile,
    unofficial: {
      enabled: input.unofficial?.enabled === true,
      ...(input.unofficial?.acknowledgedAt !== undefined
        ? { acknowledgedAt: input.unofficial.acknowledgedAt }
        : {}),
    },
    profiles,
  };
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureHome();
  const path = paths.config();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, path);
}

export async function updateConfig(mutate: (config: Config) => void): Promise<Config> {
  const config = await loadConfig();
  mutate(config);
  await saveConfig(config);
  return config;
}

export function resolveProfileName(config: Config, override?: string): string {
  return override ?? process.env['X_PROFILE'] ?? config.activeProfile ?? 'default';
}

export async function ensureProfile(name: string, authType: AuthType): Promise<ProfileConfig> {
  const config = await loadConfig();
  const existing = config.profiles[name];
  if (existing) return existing;

  const profile: ProfileConfig = { authType, createdAt: new Date().toISOString() };
  config.profiles[name] = profile;
  await saveConfig(config);
  return profile;
}
