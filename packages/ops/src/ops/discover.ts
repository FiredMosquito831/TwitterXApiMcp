import * as z from 'zod/v4';
import { PRICE } from '@xctl/core';
import { defineOperation } from '../types.js';
import { READ } from '../schemas.js';

const Trend = z.object({
  trend_name: z.string().optional(),
  tweet_count: z.number().int().optional(),
  name: z.string().optional(),
  query: z.string().optional(),
  url: z.string().optional(),
});

const Space = z.object({
  id: z.string(),
  state: z.string().optional(),
  title: z.string().optional(),
  host_ids: z.array(z.string()).optional(),
  participant_count: z.number().int().optional(),
  started_at: z.string().optional(),
});

const Community = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  member_count: z.number().int().optional(),
  created_at: z.string().optional(),
});

export const trendsGet = defineOperation({
  id: 'trends.get',
  summary: 'Read trends by location or personalised trends',
  description:
    'Returns trending topics for a WOEID (1 = worldwide) or the authenticated account\'s personalised trends when ' +
    'personalized=true. Read-only.',
  input: z.object({
    woeid: z.coerce.number().int().positive().default(1),
    personalized: z.boolean().default(false),
    max_results: z.coerce.number().int().min(1).max(50).default(20),
  }),
  output: z.object({ trends: z.array(Trend), source: z.string() }),
  rateClass: 'read',
  annotations: READ,
  cost: () => PRICE['trends'],
  async run(ctx, input) {
    await ctx.limiter.acquire('users');
    const path = input.personalized ? '/2/users/personalized_trends' : `/2/trends/by/woeid/${input.woeid}`;
    const res = await ctx.transport.call<{ data?: unknown }>({
      method: 'GET',
      path,
      bucket: 'users',
      query: { 'trend.fields': 'trend_name,tweet_count', max_results: input.max_results },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['trends'], 'trends');
    const raw = res.data?.data;
    const trends = Array.isArray(raw) ? z.array(Trend).parse(raw) : [];
    return { trends, source: input.personalized ? 'personalized' : `woeid:${input.woeid}` };
  },
});

export const spacesSearch = defineOperation({
  id: 'spaces.search',
  summary: 'Search live or scheduled Spaces',
  description:
    'Searches Spaces by query and state (live, scheduled, ended). Read-only; starting or joining a Space is not ' +
    'available through the official API.',
  input: z.object({
    query: z.string().min(1),
    state: z.enum(['live', 'scheduled', 'ended', 'all']).default('live'),
    max_results: z.coerce.number().int().min(1).max(100).default(20),
  }),
  output: z.object({ spaces: z.array(Space), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: () => PRICE['space.read'],
  async run(ctx, input) {
    await ctx.limiter.acquire('users');
    const res = await ctx.transport.call<{ data?: unknown[]; meta?: { result_count?: number } }>({
      method: 'GET',
      path: '/2/spaces/search',
      bucket: 'users',
      query: {
        query: input.query,
        state: input.state === 'all' ? undefined : input.state,
        max_results: input.max_results,
        'space.fields': 'id,state,title,host_ids,participant_count,started_at',
      },
      signal: ctx.signal,
    });
    const spaces = z.array(Space).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['space.read'] * spaces.length, 'spaces/search');
    return { spaces, result_count: res.data?.meta?.result_count ?? spaces.length };
  },
});

export const spacesGet = defineOperation({
  id: 'spaces.get',
  summary: 'Fetch one Space by id',
  description: 'Returns metadata for a single Space. Read-only.',
  input: z.object({ id: z.string() }),
  output: z.object({ space: Space }),
  rateClass: 'read',
  annotations: READ,
  cost: () => PRICE['space.read'],
  async run(ctx, input) {
    await ctx.limiter.acquire('users');
    const res = await ctx.transport.call<{ data: unknown }>({
      method: 'GET',
      path: `/2/spaces/${encodeURIComponent(input.id)}`,
      bucket: 'users',
      query: { 'space.fields': 'id,state,title,host_ids,participant_count,started_at' },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['space.read'], 'spaces/get');
    return { space: Space.parse(res.data?.data) };
  },
});

export const communitiesSearch = defineOperation({
  id: 'communities.search',
  summary: 'Search Communities by name',
  description:
    'Searches Communities. The official API is read-only for Communities: you can post into one with posts.create ' +
    'using community_id, but you cannot create or join one.',
  input: z.object({
    query: z.string().min(1),
    max_results: z.coerce.number().int().min(1).max(100).default(20),
  }),
  output: z.object({ communities: z.array(Community), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: () => PRICE['community.read'],
  async run(ctx, input) {
    await ctx.limiter.acquire('users');
    const res = await ctx.transport.call<{ data?: unknown[]; meta?: { result_count?: number } }>({
      method: 'GET',
      path: '/2/communities/search',
      bucket: 'users',
      query: {
        query: input.query,
        max_results: input.max_results,
        'community.fields': 'id,name,description,member_count,created_at',
      },
      signal: ctx.signal,
    });
    const communities = z.array(Community).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['community.read'] * communities.length, 'communities/search');
    return { communities, result_count: res.data?.meta?.result_count ?? communities.length };
  },
});

export const communitiesGet = defineOperation({
  id: 'communities.get',
  summary: 'Fetch one Community by id',
  description: 'Returns metadata for a single Community. Read-only.',
  input: z.object({ id: z.string() }),
  output: z.object({ community: Community }),
  rateClass: 'read',
  annotations: READ,
  cost: () => PRICE['community.read'],
  async run(ctx, input) {
    await ctx.limiter.acquire('users');
    const res = await ctx.transport.call<{ data: unknown }>({
      method: 'GET',
      path: `/2/communities/${encodeURIComponent(input.id)}`,
      bucket: 'users',
      query: { 'community.fields': 'id,name,description,member_count,created_at' },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['community.read'], 'communities/get');
    return { community: Community.parse(res.data?.data) };
  },
});

export const newsSearch = defineOperation({
  id: 'news.search',
  summary: 'Search X News stories',
  description: 'Searches news stories surfaced on X. Read-only.',
  input: z.object({
    query: z.string().min(1),
    max_results: z.coerce.number().int().min(1).max(100).default(20),
  }),
  output: z.object({ stories: z.array(z.record(z.string(), z.unknown())), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: () => PRICE['post.read'],
  async run(ctx, input) {
    await ctx.limiter.acquire('search');
    const res = await ctx.transport.call<{ data?: unknown[]; meta?: { result_count?: number } }>({
      method: 'GET',
      path: '/2/news/search',
      bucket: 'search',
      query: { query: input.query, max_results: input.max_results },
      signal: ctx.signal,
    });
    const stories = z.array(z.record(z.string(), z.unknown())).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['post.read'] * stories.length, 'news/search');
    return { stories, result_count: res.data?.meta?.result_count ?? stories.length };
  },
});
