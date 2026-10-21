export interface OperationMeta {
  queryId: string;
  operationName: string;
  operationType?: string;
}

const QUERY_ID_REGEX =
  /queryId:\s*[`'"]([A-Za-z0-9_-]{8,})[`'"][\s\S]{0,200}?operationName:\s*[`'"]([A-Za-z0-9_]+)[`'"](?:[\s\S]{0,120}?operationType:\s*[`'"]([a-zA-Z]+)[`'"])?/g;

const PARAMS_REGEX =
  /params:\s*\{\s*id:\s*[`'"]([A-Za-z0-9_-]{8,})[`'"][\s\S]{0,300}?name:\s*[`'"]([A-Za-z0-9_]+)[`'"]/g;

export function scriptUrlsFrom(html: string): string[] {
  const urls = new Set<string>();
  const regex = /https:\/\/abs\.twimg\.com\/[^"'\\\s]+?\.js/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) urls.add(match[0]);
  return [...urls];
}

/** Responsive-web chunks carry the operation table; x-web chunks often do not. */
export function prioritize(urls: string[]): string[] {
  return [...urls].sort((a, b) => {
    const score = (url: string) => (url.includes('/responsive-web/') ? 0 : 1);
    return score(a) - score(b);
  });
}

export function parseOperations(script: string, into: Map<string, OperationMeta>): void {
  QUERY_ID_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = QUERY_ID_REGEX.exec(script)) !== null) {
    const [, queryId, operationName, operationType] = match;
    if (!queryId || !operationName) continue;
    if (!into.has(operationName)) {
      into.set(operationName, {
        queryId,
        operationName,
        ...(operationType ? { operationType } : {}),
      });
    }
  }

  PARAMS_REGEX.lastIndex = 0;
  while ((match = PARAMS_REGEX.exec(script)) !== null) {
    const [, queryId, operationName] = match;
    if (!queryId || !operationName) continue;
    if (!into.has(operationName)) into.set(operationName, { queryId, operationName });
  }
}

export interface DiscoverOptions {
  fetchImpl?: typeof fetch;
  maxScripts?: number;
  concurrency?: number;
  userAgent?: string;
  cookieHeader?: string;
}

/**
 * Fetch script bundles and extract `operationName -> queryId`.
 * Query ids rotate every 2-6 weeks, so this runs at runtime rather than
 * shipping a table that silently rots.
 */
export async function discoverOperations(
  html: string,
  opts: DiscoverOptions = {},
): Promise<Record<string, OperationMeta>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxScripts = opts.maxScripts ?? 60;
  const concurrency = opts.concurrency ?? 6;
  const urls = prioritize(scriptUrlsFrom(html)).slice(0, maxScripts);

  const found = new Map<string, OperationMeta>();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < urls.length) {
      const url = urls[cursor++];
      if (!url) continue;
      try {
        const res = await fetchImpl(url, {
          headers: {
            'user-agent': opts.userAgent ?? 'Mozilla/5.0',
            accept: '*/*',
            ...(opts.cookieHeader ? { cookie: opts.cookieHeader } : {}),
          },
        });
        if (!res.ok) continue;
        parseOperations(await res.text(), found);
      } catch {
        /* one bad chunk must not abort discovery */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return Object.fromEntries(found);
}
