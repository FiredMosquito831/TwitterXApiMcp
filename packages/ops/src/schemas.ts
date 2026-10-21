import * as z from 'zod/v4';
import type { OpContext } from '@xctl/core';
import type { ToolAnnotations } from './types.js';

export const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export const User = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string(),
  description: z.string().optional(),
  location: z.string().optional(),
  url: z.string().optional(),
  created_at: z.string().optional(),
  verified: z.boolean().optional(),
  protected: z.boolean().optional(),
  public_metrics: z
    .object({
      followers_count: z.number().int(),
      following_count: z.number().int(),
      tweet_count: z.number().int(),
      listed_count: z.number().int(),
    })
    .optional(),
});

export const Post = z.object({
  id: z.string(),
  text: z.string(),
  created_at: z.string().optional(),
  author_id: z.string().optional(),
  conversation_id: z.string().optional(),
  lang: z.string().optional(),
  public_metrics: z
    .object({
      retweet_count: z.number().int(),
      reply_count: z.number().int(),
      like_count: z.number().int(),
      quote_count: z.number().int(),
      bookmark_count: z.number().int().optional(),
      impression_count: z.number().int().optional(),
    })
    .optional(),
  non_public_metrics: z
    .object({
      impression_count: z.number().int().optional(),
      url_link_clicks: z.number().int().optional(),
      user_profile_clicks: z.number().int().optional(),
    })
    .optional(),
});

export const DmEvent = z.object({
  id: z.string(),
  text: z.string().optional(),
  event_type: z.string(),
  created_at: z.string().optional(),
  dm_conversation_id: z.string().optional(),
  sender_id: z.string().optional(),
});

export const List = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  private: z.boolean().optional(),
  owner_id: z.string().optional(),
  member_count: z.number().int().optional(),
  follower_count: z.number().int().optional(),
});

export const Pagination = {
  next_token: z.string().nullable(),
  result_count: z.number().int(),
};

export function requireWeb(ctx: OpContext): NonNullable<OpContext['web']> {
  if (!ctx.web) {
    throw new Error(
      'This operation needs the unofficial transport. Enable it with `x config set-unofficial on --i-understand`, ' +
        'then import cookies with `x auth import-cookies --file cookies.json`.',
    );
  }
  return ctx.web;
}
