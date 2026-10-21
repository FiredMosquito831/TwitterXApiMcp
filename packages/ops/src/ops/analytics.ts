import * as z from 'zod/v4';
import { PRICE } from '@xctl/core';
import { defineOperation } from '../types.js';
import { Post, READ } from '../schemas.js';
import { me } from '../helpers.js';

export const analyticsAccount = defineOperation({
  id: 'analytics.account',
  summary: 'Summarise recent posts and engagement',
  description:
    'Reads up to max_posts recent posts from the authenticated account and computes totals plus a simple engagement ' +
    'rate ((likes + reposts + replies) / impressions when available). Read-only; cost scales with max_posts.',
  input: z.object({
    max_posts: z.coerce.number().int().min(10).max(100).default(50),
    include_private: z.boolean().default(true).describe('Include impressions and link clicks for your own posts'),
  }),
  output: z.object({
    posts: z.array(Post),
    totals: z.object({
      posts: z.number().int(),
      likes: z.number().int(),
      reposts: z.number().int(),
      replies: z.number().int(),
      quotes: z.number().int(),
      impressions: z.number().int().nullable(),
    }),
    engagement_rate: z.number().nullable(),
    cost_usd: z.number(),
  }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['owned.read'] * input.max_posts,
  async run(ctx, input) {
    const userId = (await me(ctx)).id;
    await ctx.limiter.acquire('tweets');
    const fields = input.include_private
      ? 'created_at,public_metrics,non_public_metrics,conversation_id'
      : 'created_at,public_metrics,conversation_id';
    const res = await ctx.transport.call<{ data?: unknown[] }>({
      method: 'GET',
      path: `/2/users/${encodeURIComponent(userId)}/tweets`,
      bucket: 'tweets',
      query: { max_results: input.max_posts, 'tweet.fields': fields },
      signal: ctx.signal,
    });

    const posts = z.array(Post).parse(res.data?.data ?? []);
    const totals = {
      posts: posts.length,
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
      impressions: null as number | null,
    };

    let impressions = 0;
    let sawImpressions = false;
    for (const post of posts) {
      totals.likes += post.public_metrics?.like_count ?? 0;
      totals.reposts += post.public_metrics?.retweet_count ?? 0;
      totals.replies += post.public_metrics?.reply_count ?? 0;
      totals.quotes += post.public_metrics?.quote_count ?? 0;
      const imp = post.non_public_metrics?.impression_count ?? post.public_metrics?.impression_count;
      if (typeof imp === 'number') {
        impressions += imp;
        sawImpressions = true;
      }
    }

    if (sawImpressions) totals.impressions = impressions;
    const interactions = totals.likes + totals.reposts + totals.replies;
    const engagement_rate = sawImpressions && impressions > 0 ? interactions / impressions : null;

    const cost = PRICE['owned.read'] * posts.length;
    ctx.spend.record(cost, 'analytics/account');
    return { posts, totals, engagement_rate, cost_usd: cost };
  },
});
