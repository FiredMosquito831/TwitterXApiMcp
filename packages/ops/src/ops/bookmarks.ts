import * as z from 'zod/v4';
import { PRICE } from '@xctl/core';
import { defineOperation } from '../types.js';
import { Post, READ, WRITE } from '../schemas.js';
import { me } from '../helpers.js';

export const bookmarksList = defineOperation({
  id: 'bookmarks.list',
  summary: 'List bookmarked posts',
  description: 'Returns the authenticated account\'s bookmarks, newest first, paginated by next_token.',
  input: z.object({
    max_results: z.coerce.number().int().min(1).max(100).default(20),
    next_token: z.string().optional(),
  }),
  output: z.object({
    posts: z.array(Post),
    next_token: z.string().nullable(),
    result_count: z.number().int(),
  }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['owned.read'] * input.max_results,
  async run(ctx, input) {
    const userId = (await me(ctx)).id;
    await ctx.limiter.acquire('bookmarks');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: `/2/users/${encodeURIComponent(userId)}/bookmarks`,
      bucket: 'bookmarks',
      query: {
        max_results: input.max_results,
        'tweet.fields': 'created_at,public_metrics,conversation_id,author_id',
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const posts = z.array(Post).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['owned.read'] * posts.length, 'bookmarks/list');
    return {
      posts,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? posts.length,
    };
  },
});

export const bookmarksAdd = defineOperation({
  id: 'bookmarks.add',
  summary: 'Bookmark a post',
  description: 'Adds a post to the authenticated account\'s bookmarks. Idempotent on X side.',
  input: z.object({ id: z.string() }),
  output: z.object({ bookmarked: z.boolean() }),
  rateClass: 'write',
  annotations: { ...WRITE, idempotentHint: true },
  cost: () => PRICE['bookmark'],
  async run(ctx, input) {
    const userId = (await me(ctx)).id;
    await ctx.limiter.acquire('bookmarks');
    await ctx.transport.call({
      method: 'POST',
      path: `/2/users/${encodeURIComponent(userId)}/bookmarks`,
      bucket: 'bookmarks',
      body: { tweet_id: input.id },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['bookmark'], 'bookmarks/add');
    return { bookmarked: true };
  },
});

export const bookmarksRemove = defineOperation({
  id: 'bookmarks.remove',
  summary: 'Remove a bookmark',
  description: 'Removes a post from bookmarks. Idempotent on X side.',
  input: z.object({ id: z.string() }),
  output: z.object({ bookmarked: z.boolean() }),
  rateClass: 'write',
  annotations: { ...WRITE, idempotentHint: true },
  cost: () => PRICE['bookmark'],
  async run(ctx, input) {
    const userId = (await me(ctx)).id;
    await ctx.limiter.acquire('bookmarks');
    await ctx.transport.call({
      method: 'DELETE',
      path: `/2/users/${encodeURIComponent(userId)}/bookmarks/${encodeURIComponent(input.id)}`,
      bucket: 'bookmarks',
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['bookmark'], 'bookmarks/remove');
    return { bookmarked: false };
  },
});
