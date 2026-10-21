import * as z from 'zod/v4';
import { PRICE } from '@xctl/core';
import { defineOperation } from '../types.js';
import { READ } from '../schemas.js';
import { me } from '../helpers.js';

export const accountStatus = defineOperation({
  id: 'account.status',
  summary: 'Show the authenticated account, spend and rate limits',
  description:
    'Returns the profile of the account the current token belongs to, plus this month\'s recorded spend and the ' +
    'current rate-limit buckets. Use this first to confirm which account is active. Read-only.',
  input: z.object({}),
  output: z.object({
    user: z.object({
      id: z.string(),
      username: z.string(),
      name: z.string(),
      description: z.string().optional(),
    }),
    profile: z.string(),
    spend_usd: z.number(),
    limiter: z.record(z.string(), z.unknown()),
  }),
  rateClass: 'read',
  annotations: READ,
  cost: () => PRICE['owned.read'],
  async run(ctx) {
    const user = await me(ctx);
    return {
      user: { id: user.id, username: user.username, name: user.name },
      profile: ctx.profile,
      spend_usd: ctx.spend.total(),
      limiter: ctx.limiter.snapshot() as unknown as Record<string, unknown>,
    };
  },
});
