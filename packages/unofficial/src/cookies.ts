import { getJson, cookieKey, openSecretStore, setJson } from '@xctl/core';

export interface CookieSet {
  auth_token: string;
  ct0: string;
  twid?: string;
  kdt?: string;
  guest_id?: string;
  guest_id_marketing?: string;
  guest_id_ads?: string;
  personalization_id?: string;
  [name: string]: string | undefined;
}

interface CookieLike {
  name?: unknown;
  value?: unknown;
}

/**
 * Accepts the formats people actually have:
 *  - Cookie-Editor JSON array [{name,value,…}]
 *  - Playwright storageState {cookies:[…], origins:[…]}
 *  - a raw `Cookie:` header string
 *  - a plain {name: value} object
 */
export function parseCookies(input: string | unknown): CookieSet {
  let raw: unknown = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        raw = trimmed;
      }
    }
  }

  const map: Record<string, string> = {};

  if (typeof raw === 'string') {
    for (const part of raw.split(';')) {
      const index = part.indexOf('=');
      if (index <= 0) continue;
      map[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
  } else if (Array.isArray(raw)) {
    for (const item of raw as CookieLike[]) {
      if (typeof item?.name === 'string' && typeof item?.value === 'string') {
        map[item.name] = item.value;
      }
    }
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const cookies = obj['cookies'];
    if (Array.isArray(cookies)) {
      for (const item of cookies as CookieLike[]) {
        if (typeof item?.name === 'string' && typeof item?.value === 'string') {
          map[item.name] = item.value;
        }
      }
    } else {
      for (const [name, value] of Object.entries(obj)) {
        if (typeof value === 'string') map[name] = value;
      }
    }
  }

  const authToken = map['auth_token'];
  const ct0 = map['ct0'];
  if (!authToken || !ct0) {
    throw new Error(
      'Cookie input is missing auth_token and/or ct0. Export cookies from a logged-in x.com session ' +
        '(Cookie-Editor JSON, or a Playwright storageState file) and try again.',
    );
  }

  const set: CookieSet = { auth_token: authToken, ct0 };
  for (const [name, value] of Object.entries(map)) {
    if (name === 'auth_token' || name === 'ct0') continue;
    set[name] = value;
  }
  return set;
}

/** X stores `twid` as `u%3D<id>`; expose the numeric id when present. */
export function userIdFromCookies(cookies: CookieSet): string | null {
  const twid = cookies.twid;
  if (!twid) return null;
  const decoded = decodeURIComponent(twid);
  const match = /u=(\d+)/.exec(decoded);
  return match?.[1] ?? null;
}

export function cookieHeader(cookies: CookieSet): string {
  return Object.entries(cookies)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export async function saveCookies(profile: string, cookies: CookieSet): Promise<void> {
  const store = await openSecretStore();
  await setJson(store, cookieKey(profile), cookies);
}

export async function loadCookies(profile: string): Promise<CookieSet | null> {
  const store = await openSecretStore();
  const stored = await getJson<CookieSet>(store, cookieKey(profile));
  if (!stored?.auth_token || !stored.ct0) return null;
  return stored;
}
