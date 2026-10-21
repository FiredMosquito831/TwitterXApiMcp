import type { OpContext } from '@xctl/core';
import { PRICE } from '@xctl/core';

export interface Me {
  id: string;
  username: string;
  name: string;
}

/**
 * Resolve the authenticated account once per profile and cache it for ten
 * minutes. Many operations need a user id and X charges for each lookup.
 */
export async function me(ctx: OpContext): Promise<Me> {
  const key = `me:${ctx.profile}`;
  const cached = await ctx.state?.cacheGet(key);
  if (cached) {
    try {
      return JSON.parse(cached) as Me;
    } catch {
      /* fall through to a fresh lookup */
    }
  }

  await ctx.limiter.acquire('users');
  const res = await ctx.transport.call<{ data: Me }>({
    method: 'GET',
    path: '/2/users/me',
    bucket: 'users',
    query: { 'user.fields': 'public_metrics' },
    signal: ctx.signal,
  });
  ctx.spend.record(PRICE['owned.read'], 'users/me');
  const payload = res.data.data;
  await ctx.state?.cacheSet(key, JSON.stringify(payload), 10 * 60_000);
  return payload;
}

export function paginationQuery(input: {
  max_results?: number;
  next_token?: string;
}): Record<string, string | number | undefined> {
  return {
    max_results: input.max_results,
    next_token: input.next_token,
  };
}
