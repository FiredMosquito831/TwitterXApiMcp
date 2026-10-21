import * as z from 'zod/v4';
import { PRICE } from '@xctl/core';
import { defineOperation } from '../types.js';
import { List, READ, User, WRITE } from '../schemas.js';
import { me } from '../helpers.js';

export const listsOwned = defineOperation({
  id: 'lists.owned',
  summary: 'List lists owned by a user',
  description: 'Returns lists owned by the authenticated account (or another user), paginated by next_token.',
  input: z.object({
    user_id: z.string().optional(),
    max_results: z.coerce.number().int().min(1).max(100).default(25),
    next_token: z.string().optional(),
  }),
  output: z.object({ lists: z.array(List), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['list.read'] * input.max_results,
  async run(ctx, input) {
    const userId = input.user_id ?? (await me(ctx)).id;
    await ctx.limiter.acquire('lists');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: `/2/users/${encodeURIComponent(userId)}/owned_lists`,
      bucket: 'lists',
      query: {
        max_results: input.max_results,
        'list.fields': 'id,name,description,private,owner_id,member_count,follower_count',
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const lists = z.array(List).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['list.read'] * lists.length, 'lists/owned');
    return {
      lists,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? lists.length,
    };
  },
});

export const listsCreate = defineOperation({
  id: 'lists.create',
  summary: 'Create a list',
  description: 'Creates a list owned by the authenticated account.',
  input: z.object({
    name: z.string().min(1).max(25),
    description: z.string().max(100).optional(),
    private: z.boolean().default(false),
  }),
  output: z.object({ list: List }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['list.create'],
  async run(ctx, input) {
    ctx.spend.assertWithinCap(PRICE['list.create']);
    await ctx.limiter.acquire('lists');
    const res = await ctx.transport.call<{ data: unknown }>({
      method: 'POST',
      path: '/2/lists',
      bucket: 'lists',
      body: {
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        private: input.private,
      },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['list.create'], 'lists/create');
    return { list: List.parse(res.data) };
  },
});

export const listsUpdate = defineOperation({
  id: 'lists.update',
  summary: 'Update a list',
  description: 'Updates name, description or privacy of a list you own.',
  input: z.object({
    id: z.string(),
    name: z.string().min(1).max(25).optional(),
    description: z.string().max(100).optional(),
    private: z.boolean().optional(),
  }),
  output: z.object({ updated: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['list.manage'],
  async run(ctx, input) {
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body['name'] = input.name;
    if (input.description !== undefined) body['description'] = input.description;
    if (input.private !== undefined) body['private'] = input.private;

    await ctx.limiter.acquire('lists');
    await ctx.transport.call({
      method: 'PUT',
      path: `/2/lists/${encodeURIComponent(input.id)}`,
      bucket: 'lists',
      body,
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['list.manage'], 'lists/update');
    return { updated: true };
  },
});

export const listsDelete = defineOperation({
  id: 'lists.delete',
  summary: 'Delete a list',
  description: 'Deletes a list you own. Destructive and not reversible.',
  input: z.object({ id: z.string() }),
  output: z.object({ deleted: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['list.manage'],
  async run(ctx, input) {
    await ctx.limiter.acquire('lists');
    const res = await ctx.transport.call<{ data?: { deleted?: boolean } }>({
      method: 'DELETE',
      path: `/2/lists/${encodeURIComponent(input.id)}`,
      bucket: 'lists',
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['list.manage'], 'lists/delete');
    return { deleted: res.data?.data?.deleted ?? res.status === 200 };
  },
});

export const listsMembers = defineOperation({
  id: 'lists.members',
  summary: 'List members of a list',
  description: 'Returns members of a list, paginated by next_token.',
  input: z.object({
    id: z.string(),
    max_results: z.coerce.number().int().min(1).max(100).default(100),
    next_token: z.string().optional(),
  }),
  output: z.object({ users: z.array(User), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['follower.read'] * input.max_results,
  async run(ctx, input) {
    await ctx.limiter.acquire('lists');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: `/2/lists/${encodeURIComponent(input.id)}/members`,
      bucket: 'lists',
      query: {
        max_results: input.max_results,
        'user.fields': 'public_metrics,description,created_at',
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const users = z.array(User).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['follower.read'] * users.length, 'lists/members');
    return {
      users,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? users.length,
    };
  },
});

export const listsAddMember = defineOperation({
  id: 'lists.add_member',
  summary: 'Add a user to a list',
  description: 'Adds one user to a list you own. Bulk list manipulation violates X policy; one call per member.',
  input: z.object({ list_id: z.string(), user_id: z.string() }),
  output: z.object({ added: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['list.manage'],
  async run(ctx, input) {
    await ctx.limiter.acquire('lists');
    await ctx.transport.call({
      method: 'POST',
      path: `/2/lists/${encodeURIComponent(input.list_id)}/members`,
      bucket: 'lists',
      body: { user_id: input.user_id },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['list.manage'], 'lists/add_member');
    return { added: true };
  },
});

export const listsRemoveMember = defineOperation({
  id: 'lists.remove_member',
  summary: 'Remove a user from a list',
  description: 'Removes one user from a list you own, leaving the list itself intact.',
  input: z.object({ list_id: z.string(), user_id: z.string() }),
  output: z.object({ removed: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['list.manage'],
  async run(ctx, input) {
    await ctx.limiter.acquire('lists');
    await ctx.transport.call({
      method: 'DELETE',
      path: `/2/lists/${encodeURIComponent(input.list_id)}/members/${encodeURIComponent(input.user_id)}`,
      bucket: 'lists',
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['list.manage'], 'lists/remove_member');
    return { removed: true };
  },
});
