import * as z from 'zod/v4';
import { PRICE } from '@xctl/core';
import { defineOperation } from '../types.js';
import { Pagination, READ, User, WRITE } from '../schemas.js';
import { me } from '../helpers.js';

const USER_FIELDS = 'public_metrics,description,created_at,location,url,verified,protected';

export const usersGet = defineOperation({
  id: 'users.get',
  summary: 'Look up a user by handle or id',
  description:
    'Returns one profile with public metrics. Pass username (without @) or user_id. Use before any operation that needs a user id.',
  input: z
    .object({
      username: z.string().min(1).optional(),
      user_id: z.string().min(1).optional(),
    })
    .refine((v) => Boolean(v.username || v.user_id), { message: 'Provide username or user_id' }),
  output: z.object({ user: User }),
  rateClass: 'read',
  annotations: READ,
  cost: () => PRICE['user.read'],
  async run(ctx, input) {
    await ctx.limiter.acquire('users');
    const path = input.username
      ? `/2/users/by/username/${encodeURIComponent(input.username.replace(/^@/, ''))}`
      : `/2/users/${encodeURIComponent(input.user_id ?? '')}`;
    const res = await ctx.transport.call<{ data: unknown }>({
      method: 'GET',
      path,
      bucket: 'users',
      query: { 'user.fields': USER_FIELDS },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['user.read'], 'users/get');
    return { user: User.parse(res.data) };
  },
});

export const usersFollowers = defineOperation({
  id: 'users.followers',
  summary: 'List followers of a user',
  description: 'Returns followers with profile fields, paginated by next_token. Use max_results to control cost.',
  input: z.object({
    user_id: z.string().optional(),
    username: z.string().optional(),
    max_results: z.coerce.number().int().min(1).max(1000).default(100),
    next_token: z.string().optional(),
  }),
  output: z.object({ users: z.array(User), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['follower.read'] * input.max_results,
  async run(ctx, input) {
    const userId = await resolveUserId(ctx, input);
    await ctx.limiter.acquire('users');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: `/2/users/${encodeURIComponent(userId)}/followers`,
      bucket: 'users',
      query: {
        max_results: input.max_results,
        'user.fields': USER_FIELDS,
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const users = z.array(User).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['follower.read'] * users.length, 'users/followers');
    return {
      users,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? users.length,
    };
  },
});

export const usersFollowing = defineOperation({
  id: 'users.following',
  summary: 'List accounts a user follows',
  description: 'Returns followed accounts with profile fields, paginated by next_token.',
  input: z.object({
    user_id: z.string().optional(),
    username: z.string().optional(),
    max_results: z.coerce.number().int().min(1).max(1000).default(100),
    next_token: z.string().optional(),
  }),
  output: z.object({ users: z.array(User), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['follower.read'] * input.max_results,
  async run(ctx, input) {
    const userId = await resolveUserId(ctx, input);
    await ctx.limiter.acquire('users');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: `/2/users/${encodeURIComponent(userId)}/following`,
      bucket: 'users',
      query: {
        max_results: input.max_results,
        'user.fields': USER_FIELDS,
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const users = z.array(User).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['follower.read'] * users.length, 'users/following');
    return {
      users,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? users.length,
    };
  },
});

export const usersLiked = defineOperation({
  id: 'users.liked',
  summary: 'List posts liked by a user',
  description:
    'Returns posts liked by a user. For the authenticated account this uses the cheaper Owned Reads rate. Paginated by next_token.',
  input: z.object({
    user_id: z.string().optional(),
    max_results: z.coerce.number().int().min(5).max(100).default(20),
    next_token: z.string().optional(),
  }),
  output: z.object({ posts: z.array(z.unknown()), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['owned.read'] * input.max_results,
  async run(ctx, input) {
    const userId = input.user_id ?? (await me(ctx)).id;
    await ctx.limiter.acquire('tweets');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: `/2/users/${encodeURIComponent(userId)}/liked_tweets`,
      bucket: 'tweets',
      query: {
        max_results: input.max_results,
        'tweet.fields': 'created_at,public_metrics,author_id',
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const posts = res.data?.data ?? [];
    ctx.spend.record(PRICE['owned.read'] * posts.length, 'users/liked');
    return {
      posts,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? posts.length,
    };
  },
});

export const usersBlocked = defineOperation({
  id: 'users.blocked',
  summary: 'List blocked accounts',
  description: 'Returns accounts blocked by the authenticated account, paginated by next_token.',
  input: z.object({
    max_results: z.coerce.number().int().min(1).max(1000).default(100),
    next_token: z.string().optional(),
  }),
  output: z.object({ users: z.array(User), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['interaction.read'] * input.max_results,
  async run(ctx, input) {
    const self = await me(ctx);
    await ctx.limiter.acquire('users');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: `/2/users/${encodeURIComponent(self.id)}/blocking`,
      bucket: 'users',
      query: {
        max_results: input.max_results,
        'user.fields': USER_FIELDS,
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const users = z.array(User).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['interaction.read'] * users.length, 'users/blocked');
    return {
      users,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? users.length,
    };
  },
});

export const usersMuted = defineOperation({
  id: 'users.muted',
  summary: 'List muted accounts',
  description: 'Returns accounts muted by the authenticated account, paginated by next_token.',
  input: z.object({
    max_results: z.coerce.number().int().min(1).max(1000).default(100),
    next_token: z.string().optional(),
  }),
  output: z.object({ users: z.array(User), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['interaction.read'] * input.max_results,
  async run(ctx, input) {
    const self = await me(ctx);
    await ctx.limiter.acquire('users');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: `/2/users/${encodeURIComponent(self.id)}/muting`,
      bucket: 'users',
      query: {
        max_results: input.max_results,
        'user.fields': USER_FIELDS,
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const users = z.array(User).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['interaction.read'] * users.length, 'users/muted');
    return {
      users,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? users.length,
    };
  },
});

export const usersBlock = defineOperation({
  id: 'users.block',
  summary: 'Block a user',
  description: 'Blocks a user from the authenticated account. Destructive; confirm the target first.',
  input: z.object({ user_id: z.string() }),
  output: z.object({ blocking: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['user.interaction'],
  async run(ctx, input) {
    const self = await me(ctx);
    await ctx.limiter.acquire('users');
    await ctx.transport.call({
      method: 'POST',
      path: `/2/users/${encodeURIComponent(self.id)}/blocking`,
      bucket: 'users',
      body: { target_user_id: input.user_id },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['user.interaction'], 'users/block');
    return { blocking: true };
  },
});

export const usersUnblock = defineOperation({
  id: 'users.unblock',
  summary: 'Unblock a user',
  description: 'Removes a block from a user. Idempotent on the X side, so it is safe to repeat.',
  input: z.object({ user_id: z.string() }),
  output: z.object({ blocking: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['interaction.delete'],
  async run(ctx, input) {
    const self = await me(ctx);
    await ctx.limiter.acquire('users');
    await ctx.transport.call({
      method: 'DELETE',
      path: `/2/users/${encodeURIComponent(self.id)}/blocking/${encodeURIComponent(input.user_id)}`,
      bucket: 'users',
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['interaction.delete'], 'users/unblock');
    return { blocking: false };
  },
});

export const usersMute = defineOperation({
  id: 'users.mute',
  summary: 'Mute a user',
  description: 'Mutes a user. Destructive to your timeline view; confirm the target first.',
  input: z.object({ user_id: z.string() }),
  output: z.object({ muting: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['user.interaction'],
  async run(ctx, input) {
    const self = await me(ctx);
    await ctx.limiter.acquire('users');
    await ctx.transport.call({
      method: 'POST',
      path: `/2/users/${encodeURIComponent(self.id)}/muting`,
      bucket: 'users',
      body: { target_user_id: input.user_id },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['user.interaction'], 'users/mute');
    return { muting: true };
  },
});

export const usersUnmute = defineOperation({
  id: 'users.unmute',
  summary: 'Unmute a user',
  description: 'Removes a mute from a user. Idempotent on the X side, so it is safe to repeat.',
  input: z.object({ user_id: z.string() }),
  output: z.object({ muting: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['mute.delete'],
  async run(ctx, input) {
    const self = await me(ctx);
    await ctx.limiter.acquire('users');
    await ctx.transport.call({
      method: 'DELETE',
      path: `/2/users/${encodeURIComponent(self.id)}/muting/${encodeURIComponent(input.user_id)}`,
      bucket: 'users',
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['mute.delete'], 'users/unmute');
    return { muting: false };
  },
});

async function resolveUserId(
  ctx: Parameters<typeof me>[0],
  input: { user_id?: string | undefined; username?: string | undefined },
): Promise<string> {
  if (input.user_id) return input.user_id;
  if (input.username) {
    await ctx.limiter.acquire('users');
    const res = await ctx.transport.call<{ data: { id: string } }>({
      method: 'GET',
      path: `/2/users/by/username/${encodeURIComponent(input.username.replace(/^@/, ''))}`,
      bucket: 'users',
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['user.read'], 'users/by/username');
    return res.data.data.id;
  }
  return (await me(ctx)).id;
}

export { Pagination };
