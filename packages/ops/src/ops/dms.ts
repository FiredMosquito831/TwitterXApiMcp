import * as z from 'zod/v4';
import { PRICE } from '@xctl/core';
import { defineOperation } from '../types.js';
import { DmEvent, READ, WRITE } from '../schemas.js';

export const dmsSend = defineOperation({
  id: 'dms.send',
  summary: 'Send a direct message',
  description:
    'Sends one DM to a user id or an existing conversation id. Passing a user id may create a new conversation. ' +
    'Unsolicited bulk DMs violate X policy. Send one message per explicit user request.',
  input: z
    .object({
      to_user_id: z.string().optional().describe('Recipient user id; starts or reuses a 1:1 conversation'),
      conversation_id: z.string().optional().describe('Existing DM conversation id'),
      text: z.string().min(1).max(10_000),
      media_id: z.string().optional(),
    })
    .refine((v) => Boolean(v.to_user_id || v.conversation_id), { message: 'Provide to_user_id or conversation_id' }),
  output: z.object({ event_id: z.string().nullable(), delivered: z.boolean(), cost_usd: z.number() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['dm.create'],
  async run(ctx, input) {
    ctx.spend.assertWithinCap(PRICE['dm.create']);
    const body: Record<string, unknown> = { text: input.text };
    if (input.media_id) body['attachments'] = [{ media_id: input.media_id }];

    const path = input.conversation_id
      ? `/2/dm_conversations/${encodeURIComponent(input.conversation_id)}/messages`
      : `/2/dm_conversations/with/${encodeURIComponent(input.to_user_id ?? '')}/messages`;

    await ctx.limiter.acquire('dm');
    const res = await ctx.transport.call<{ data?: { dm_event_id?: string; id?: string } }>({
      method: 'POST',
      path,
      bucket: 'dm',
      body,
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['dm.create'], 'dm/send');
    return {
      event_id: res.data?.data?.dm_event_id ?? res.data?.data?.id ?? null,
      delivered: true,
      cost_usd: PRICE['dm.create'],
    };
  },
});

export const dmsList = defineOperation({
  id: 'dms.list',
  summary: 'List recent DM events',
  description:
    'Returns DM events for the authenticated account, newest first, paginated by next_token. X caps DM reads at ' +
    '15 per 15 minutes: poll at most once a minute, or use the Activity API webhook instead.',
  input: z.object({
    max_results: z.coerce.number().int().min(1).max(100).default(20),
    next_token: z.string().optional(),
    event_types: z
      .array(z.enum(['MessageCreate', 'ParticipantsJoin', 'ParticipantsLeave']))
      .optional(),
  }),
  output: z.object({
    events: z.array(DmEvent),
    next_token: z.string().nullable(),
    result_count: z.number().int(),
  }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['dm.read'] * input.max_results,
  async run(ctx, input) {
    await ctx.limiter.acquire('dm');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: '/2/dm_events',
      bucket: 'dm',
      query: {
        max_results: input.max_results,
        'dm_event.fields': 'id,text,event_type,created_at,dm_conversation_id,sender_id',
        ...(input.event_types?.length ? { event_types: input.event_types.join(',') } : {}),
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const events = z.array(DmEvent).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['dm.read'] * events.length, 'dm/list');
    return {
      events,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? events.length,
    };
  },
});

export const dmsConversation = defineOperation({
  id: 'dms.conversation',
  summary: 'Read one DM conversation',
  description: 'Returns messages in a specific conversation, paginated by next_token.',
  input: z.object({
    conversation_id: z.string(),
    max_results: z.coerce.number().int().min(1).max(100).default(20),
    next_token: z.string().optional(),
  }),
  output: z.object({
    events: z.array(DmEvent),
    next_token: z.string().nullable(),
    result_count: z.number().int(),
  }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['dm.read'] * input.max_results,
  async run(ctx, input) {
    await ctx.limiter.acquire('dm');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: `/2/dm_conversations/${encodeURIComponent(input.conversation_id)}/dm_events`,
      bucket: 'dm',
      query: {
        max_results: input.max_results,
        'dm_event.fields': 'id,text,event_type,created_at,dm_conversation_id,sender_id',
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const events = z.array(DmEvent).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['dm.read'] * events.length, 'dm/conversation');
    return {
      events,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? events.length,
    };
  },
});
