import * as z from 'zod/v4';
import { defineOperation } from '../types.js';
import { READ } from '../schemas.js';

export const usageGet = defineOperation({
  id: 'usage.get',
  summary: 'Show API usage and credit balance',
  description:
    'Returns X API usage for the developer project. kind=tweets reports daily post consumption, kind=credits reports ' +
    'remaining credits. Free to call. Check before bulk reads or a posting run.',
  input: z.object({
    kind: z.enum(['tweets', 'credits', 'all']).default('all'),
  }),
  output: z.object({
    tweets: z.record(z.string(), z.unknown()).nullable(),
    credits: z.record(z.string(), z.unknown()).nullable(),
  }),
  rateClass: 'read',
  annotations: READ,
  cost: () => 0,
  async run(ctx, input) {
    const out: {
      tweets: Record<string, unknown> | null;
      credits: Record<string, unknown> | null;
    } = { tweets: null, credits: null };

    if (input.kind === 'tweets' || input.kind === 'all') {
      try {
        const res = await ctx.transport.call<{ data?: Record<string, unknown> }>({
          method: 'GET',
          path: '/2/usage/tweets',
          bucket: 'usage',
          signal: ctx.signal,
        });
        out.tweets = res.data?.data ?? (res.data as Record<string, unknown>);
      } catch (err) {
        ctx.log('usage/tweets unavailable', { error: (err as Error).message });
      }
    }

    if (input.kind === 'credits' || input.kind === 'all') {
      try {
        const res = await ctx.transport.call<{ data?: Record<string, unknown> }>({
          method: 'GET',
          path: '/2/usage/credits',
          bucket: 'usage',
          signal: ctx.signal,
        });
        out.credits = res.data?.data ?? (res.data as Record<string, unknown>);
      } catch (err) {
        ctx.log('usage/credits unavailable', { error: (err as Error).message });
      }
    }

    return out;
  },
});
