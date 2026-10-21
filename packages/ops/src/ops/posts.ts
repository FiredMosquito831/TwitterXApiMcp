import * as z from 'zod/v4';
import { createHash } from 'node:crypto';
import { postCreatePrice, PRICE } from '@xctl/core';
import { defineOperation } from '../types.js';
import { Post, READ, WRITE } from '../schemas.js';
import { me } from '../helpers.js';

const TWEET_FIELDS = 'created_at,public_metrics,conversation_id,lang,author_id';

function dedupeKey(...parts: Array<string | undefined>): string {
  return createHash('sha256').update(parts.filter(Boolean).join('|')).digest('hex');
}

async function claimOnce(
  ctx: Parameters<typeof me>[0],
  key: string,
): Promise<void> {
  const fresh = await ctx.state?.claimDedupe(key, 30_000);
  if (fresh === false) {
    throw new Error(
      'An identical post was attempted within the last 30 seconds. If the first attempt failed, wait and retry; ' +
        'if it succeeded, this prevents a duplicate.',
    );
  }
}

export const postsCreate = defineOperation({
  id: 'posts.create',
  summary: 'Publish a post, reply, poll or media post',
  description:
    'Creates a post as the authenticated account. NOT idempotent: never retry on timeout — the post may already exist. ' +
    'Show the exact text to the user before calling. A post containing a URL costs $0.20 instead of $0.015. ' +
    'Replies are only accepted when the original author summoned this account. Quote posts require Enterprise and ' +
    'are available through the unofficial transport only.',
  input: z.object({
    text: z.string().min(1).max(25_000).describe('Post body. 280 chars unless the account is Premium.'),
    reply_to: z.string().optional().describe('Post id to reply to. Subject to the summoned-reply rule.'),
    media_ids: z.array(z.string()).max(4).optional().describe('Media ids from media.upload'),
    poll: z
      .object({
        options: z.array(z.string().min(1).max(25)).min(2).max(4),
        duration_minutes: z.number().int().min(5).max(10_080).default(1440),
      })
      .optional(),
    dry_run: z.boolean().default(false).describe('Estimate cost and show the request without posting'),
  }),
  output: z.object({
    id: z.string().nullable(),
    text: z.string(),
    cost_usd: z.number(),
    dry_run: z.boolean(),
  }),
  rateClass: 'write',
  annotations: WRITE,
  cost: (input) => postCreatePrice(input.text, Boolean(input.reply_to)),
  async run(ctx, input) {
    const price = postCreatePrice(input.text, Boolean(input.reply_to));
    ctx.spend.assertWithinCap(price);

    if (/https?:\/\/\S+/i.test(input.text)) {
      ctx.log('post contains a URL: billed at $0.20, not $0.015');
    }

    if (input.dry_run) {
      return { id: null, text: input.text, cost_usd: price, dry_run: true };
    }

    const body: Record<string, unknown> = { text: input.text };
    if (input.reply_to) body['reply'] = { in_reply_to_tweet_id: input.reply_to };
    if (input.media_ids?.length) body['media'] = { media_ids: input.media_ids };
    if (input.poll) {
      body['poll'] = {
        options: input.poll.options,
        duration_minutes: input.poll.duration_minutes,
      };
    }

    await claimOnce(ctx, dedupeKey('create', input.text, input.reply_to));
    await ctx.limiter.acquire('tweets');
    const res = await ctx.transport.call<{ data?: { id?: string; text?: string } }>({
      method: 'POST',
      path: '/2/tweets',
      bucket: 'tweets',
      body,
      signal: ctx.signal,
    });
    ctx.spend.record(price, 'tweets/create');

    const id = res.data?.data?.id;
    if (!id) throw new Error('Post was accepted but no id was returned; check the account timeline before retrying.');
    return { id, text: res.data?.data?.text ?? input.text, cost_usd: price, dry_run: false };
  },
});

export const postsThread = defineOperation({
  id: 'posts.thread',
  summary: 'Publish a thread as a reply chain',
  description:
    'Creates an ordered thread: each segment replies to the previous one. By default, if a segment fails the already ' +
    'published segments are deleted (best effort) so a half-thread is not left behind. NOT idempotent; confirm the ' +
    'full text with the user first. Each segment is billed as a separate post.',
  input: z.object({
    segments: z.array(z.string().min(1).max(25_000)).min(2).max(25),
    rollback_on_failure: z.boolean().default(true),
    dry_run: z.boolean().default(false),
  }),
  output: z.object({
    ids: z.array(z.string()),
    thread_url: z.string().nullable(),
    cost_usd: z.number(),
    dry_run: z.boolean(),
  }),
  rateClass: 'write',
  annotations: WRITE,
  cost: (input) => input.segments.reduce((sum, text) => sum + postCreatePrice(text), 0),
  async run(ctx, input) {
    const total = input.segments.reduce((sum, text) => sum + postCreatePrice(text), 0);
    ctx.spend.assertWithinCap(total);

    if (input.dry_run) {
      return { ids: [], thread_url: null, cost_usd: total, dry_run: true };
    }

    const created: string[] = [];
    let parent: string | undefined;

    try {
      for (const [index, text] of input.segments.entries()) {
        const price = postCreatePrice(text);
        const body: Record<string, unknown> = { text };
        if (parent) body['reply'] = { in_reply_to_tweet_id: parent };

        await claimOnce(ctx, dedupeKey('thread', text, parent, String(index)));
        await ctx.limiter.acquire('tweets');
        const res = await ctx.transport.call<{ data?: { id?: string } }>({
          method: 'POST',
          path: '/2/tweets',
          bucket: 'tweets',
          body,
          signal: ctx.signal,
        });
        const id = res.data?.data?.id;
        if (!id) throw new Error(`Segment ${index + 1} was accepted without an id.`);

        created.push(id);
        parent = id;
        ctx.spend.record(price, `tweets/thread[${index + 1}]`);
      }
    } catch (err) {
      if (input.rollback_on_failure && created.length) {
        ctx.log(`thread failed; deleting ${created.length} published segment(s)`);
        for (const id of created) {
          try {
            await ctx.limiter.acquire('tweets');
            await ctx.transport.call({
              method: 'DELETE',
              path: `/2/tweets/${encodeURIComponent(id)}`,
              bucket: 'tweets',
              signal: ctx.signal,
            });
            ctx.spend.record(PRICE['post.delete'], 'tweets/delete(rollback)');
          } catch (rollbackErr) {
            ctx.log(`rollback failed for ${id}`, { error: (rollbackErr as Error).message });
          }
        }
      }
      throw err;
    }

    const first = created[0];
    return {
      ids: created,
      thread_url: first ? `https://x.com/i/status/${first}` : null,
      cost_usd: total,
      dry_run: false,
    };
  },
});

export const postsGet = defineOperation({
  id: 'posts.get',
  summary: 'Fetch one post by id',
  description: 'Returns a single post with public metrics. Read-only and cheap; prefer this over search when you have an id.',
  input: z.object({ id: z.string().describe('Post id (numeric) or a full x.com status URL') }),
  output: z.object({ post: Post }),
  rateClass: 'read',
  annotations: READ,
  cost: () => PRICE['post.read'],
  async run(ctx, { id }) {
    const postId = extractId(id);
    await ctx.limiter.acquire('tweets');
    const res = await ctx.transport.call<{ data: unknown }>({
      method: 'GET',
      path: `/2/tweets/${encodeURIComponent(postId)}`,
      bucket: 'tweets',
      query: { 'tweet.fields': TWEET_FIELDS.replace('author_id', 'author_id,non_public_metrics') },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['post.read'], 'tweets/get');
    return { post: Post.parse(res.data) };
  },
});

export const postsDelete = defineOperation({
  id: 'posts.delete',
  summary: 'Delete a post',
  description: 'Deletes a post owned by the authenticated account. Destructive and not idempotent; confirm the id first.',
  input: z.object({ id: z.string() }),
  output: z.object({ deleted: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['post.delete'],
  async run(ctx, { id }) {
    await ctx.limiter.acquire('tweets');
    const res = await ctx.transport.call<{ data?: { deleted?: boolean } }>({
      method: 'DELETE',
      path: `/2/tweets/${encodeURIComponent(extractId(id))}`,
      bucket: 'tweets',
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['post.delete'], 'tweets/delete');
    return { deleted: res.data?.data?.deleted ?? res.status === 200 };
  },
});

export const postsEdit = defineOperation({
  id: 'posts.edit',
  summary: 'Edit an existing post',
  description:
    'Creates an edited version of a post you own. X keeps the edit history. Not idempotent; each edit is billed as a new post.',
  input: z.object({
    id: z.string().describe('Post id to edit'),
    text: z.string().min(1).max(25_000),
  }),
  output: z.object({ id: z.string(), text: z.string() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: (input) => postCreatePrice(input.text),
  async run(ctx, input) {
    const price = postCreatePrice(input.text);
    ctx.spend.assertWithinCap(price);
    await ctx.limiter.acquire('tweets');
    const res = await ctx.transport.call<{ data?: { id?: string; text?: string } }>({
      method: 'POST',
      path: '/2/tweets',
      bucket: 'tweets',
      body: { text: input.text, edit_options: { previous_post_id: extractId(input.id) } },
      signal: ctx.signal,
    });
    ctx.spend.record(price, 'tweets/edit');
    const id = res.data?.data?.id;
    if (!id) throw new Error('Edit was accepted but no id was returned.');
    return { id, text: res.data?.data?.text ?? input.text };
  },
});

export const postsSearchRecent = defineOperation({
  id: 'posts.search_recent',
  summary: 'Search recent posts (last 7 days)',
  description:
    'Searches X posts from the last 7 days. Supports operators like from:, -is:retweet, has:media. Returns at most ' +
    'max_results posts plus next_token; pass next_token to page. Token-expensive: narrow the query.',
  input: z.object({
    query: z.string().min(1).describe('X search query'),
    max_results: z.coerce.number().int().min(10).max(100).default(10),
    next_token: z.string().optional(),
  }),
  output: z.object({ posts: z.array(Post), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'search',
  annotations: READ,
  cost: (input) => PRICE['post.read'] * input.max_results,
  async run(ctx, input) {
    return search(ctx, '/2/tweets/search/recent', input);
  },
});

export const postsSearchAll = defineOperation({
  id: 'posts.search_all',
  summary: 'Search the full archive (2006 onwards)',
  description:
    'Searches every public post since 2006. Supports the same operators as recent search plus start_time/end_time. ' +
    'More expensive per call; page with next_token.',
  input: z.object({
    query: z.string().min(1),
    max_results: z.coerce.number().int().min(10).max(500).default(10),
    next_token: z.string().optional(),
    start_time: z.string().optional().describe('ISO-8601, e.g. 2026-01-01T00:00:00Z'),
    end_time: z.string().optional(),
  }),
  output: z.object({ posts: z.array(Post), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'search',
  annotations: READ,
  cost: (input) => PRICE['post.read'] * input.max_results,
  async run(ctx, input) {
    return search(ctx, '/2/tweets/search/all', input);
  },
});

async function search(
  ctx: Parameters<typeof me>[0],
  path: string,
  input: {
    query: string;
    max_results: number;
    next_token?: string | undefined;
    start_time?: string | undefined;
    end_time?: string | undefined;
  },
) {
  await ctx.limiter.acquire('search');
  const res = await ctx.transport.call<{
    data?: unknown[];
    meta?: { next_token?: string; result_count?: number };
  }>({
    method: 'GET',
    path,
    bucket: 'search',
    query: {
      query: input.query,
      max_results: input.max_results,
      'tweet.fields': TWEET_FIELDS,
      ...(input.next_token ? { next_token: input.next_token } : {}),
      ...(input.start_time ? { start_time: input.start_time } : {}),
      ...(input.end_time ? { end_time: input.end_time } : {}),
    },
    signal: ctx.signal,
  });
  const posts = z.array(Post).parse(res.data?.data ?? []);
  ctx.spend.record(PRICE['post.read'] * posts.length, 'search');
  return {
    posts,
    next_token: res.data?.meta?.next_token ?? null,
    result_count: res.data?.meta?.result_count ?? posts.length,
  };
}

export const postsTimeline = defineOperation({
  id: 'posts.timeline',
  summary: 'Read a user timeline, mentions or the home timeline',
  description:
    'Reads posts from a timeline. kind=user needs a user id (defaults to the authenticated account), kind=mentions ' +
    'reads accounts that mentioned you, kind=home reads the reverse-chronological home timeline. Paginate with next_token.',
  input: z.object({
    kind: z.enum(['user', 'mentions', 'home']).default('user'),
    user_id: z.string().optional(),
    max_results: z.coerce.number().int().min(5).max(100).default(10),
    next_token: z.string().optional(),
  }),
  output: z.object({ posts: z.array(Post), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['owned.read'] * input.max_results,
  async run(ctx, input) {
    const userId = input.user_id ?? (await me(ctx)).id;
    const path =
      input.kind === 'mentions'
        ? `/2/users/${encodeURIComponent(userId)}/mentions`
        : input.kind === 'home'
          ? `/2/users/${encodeURIComponent(userId)}/timelines/reverse_chronological`
          : `/2/users/${encodeURIComponent(userId)}/tweets`;

    await ctx.limiter.acquire('tweets');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path,
      bucket: 'tweets',
      query: {
        max_results: input.max_results,
        'tweet.fields': TWEET_FIELDS,
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const posts = z.array(Post).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['owned.read'] * posts.length, 'timeline');
    return {
      posts,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? posts.length,
    };
  },
});

export const postsMetrics = defineOperation({
  id: 'posts.metrics',
  summary: 'Fetch metrics for up to 100 posts',
  description:
    'Returns public metrics for a set of post ids. Set include_private=true for impressions and link clicks on posts ' +
    'you own (requires user-context auth). Read-only.',
  input: z.object({
    ids: z.array(z.string()).min(1).max(100),
    include_private: z.boolean().default(false),
  }),
  output: z.object({ posts: z.array(Post) }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['post.read'] * input.ids.length,
  async run(ctx, input) {
    await ctx.limiter.acquire('tweets');
    const fields = input.include_private ? `${TWEET_FIELDS},non_public_metrics` : TWEET_FIELDS;
    const res = await ctx.transport.call<{ data?: unknown[] }>({
      method: 'GET',
      path: '/2/tweets',
      bucket: 'tweets',
      query: { ids: input.ids.map(extractId).join(','), 'tweet.fields': fields },
      signal: ctx.signal,
    });
    const posts = z.array(Post).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['post.read'] * posts.length, 'tweets/metrics');
    return { posts };
  },
});

export const postsHideReply = defineOperation({
  id: 'posts.hide_reply',
  summary: 'Hide or unhide a reply',
  description: 'Hides or unhides a reply on a post you own. Destructive to the conversation view; confirm first.',
  input: z.object({
    id: z.string().describe('Reply post id'),
    hidden: z.boolean().default(true),
  }),
  output: z.object({ hidden: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['content.manage'],
  async run(ctx, input) {
    await ctx.limiter.acquire('tweets');
    const res = await ctx.transport.call<{ data?: { hidden?: boolean } }>({
      method: 'PUT',
      path: `/2/tweets/${encodeURIComponent(extractId(input.id))}/hidden`,
      bucket: 'tweets',
      body: { hidden: input.hidden },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['content.manage'], 'tweets/hidden');
    return { hidden: res.data?.data?.hidden ?? input.hidden };
  },
});

export const postsQuotes = defineOperation({
  id: 'posts.quotes',
  summary: 'List quote posts of a post',
  description:
    'Returns posts that quote the given post, paginated by next_token. Read-only. Note that creating a quote post is ' +
    'Enterprise-only on the official API.',
  input: z.object({
    id: z.string(),
    max_results: z.coerce.number().int().min(10).max(100).default(20),
    next_token: z.string().optional(),
  }),
  output: z.object({ posts: z.array(Post), next_token: z.string().nullable(), result_count: z.number().int() }),
  rateClass: 'read',
  annotations: READ,
  cost: (input) => PRICE['post.read'] * input.max_results,
  async run(ctx, input) {
    await ctx.limiter.acquire('tweets');
    const res = await ctx.transport.call<{
      data?: unknown[];
      meta?: { next_token?: string; result_count?: number };
    }>({
      method: 'GET',
      path: `/2/tweets/${encodeURIComponent(extractId(input.id))}/quote_tweets`,
      bucket: 'tweets',
      query: {
        max_results: input.max_results,
        'tweet.fields': TWEET_FIELDS,
        ...(input.next_token ? { next_token: input.next_token } : {}),
      },
      signal: ctx.signal,
    });
    const posts = z.array(Post).parse(res.data?.data ?? []);
    ctx.spend.record(PRICE['post.read'] * posts.length, 'tweets/quotes');
    return {
      posts,
      next_token: res.data?.meta?.next_token ?? null,
      result_count: res.data?.meta?.result_count ?? posts.length,
    };
  },
});

export const postsRepost = defineOperation({
  id: 'posts.repost',
  summary: 'Repost a post',
  description: 'Reposts a post as the authenticated account. Not idempotent; reposting twice is an error from X.',
  input: z.object({ id: z.string() }),
  output: z.object({ reposted: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['user.interaction'],
  async run(ctx, input) {
    const userId = (await me(ctx)).id;
    await ctx.limiter.acquire('tweets');
    await ctx.transport.call({
      method: 'POST',
      path: `/2/users/${encodeURIComponent(userId)}/retweets`,
      bucket: 'tweets',
      body: { tweet_id: extractId(input.id) },
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['user.interaction'], 'retweets/create');
    return { reposted: true };
  },
});

export const postsUnrepost = defineOperation({
  id: 'posts.unrepost',
  summary: 'Undo a repost',
  description: 'Removes a repost by the authenticated account. Idempotent on X side.',
  input: z.object({ id: z.string() }),
  output: z.object({ reposted: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => PRICE['interaction.delete'],
  async run(ctx, input) {
    const userId = (await me(ctx)).id;
    await ctx.limiter.acquire('tweets');
    await ctx.transport.call({
      method: 'DELETE',
      path: `/2/users/${encodeURIComponent(userId)}/retweets/${encodeURIComponent(extractId(input.id))}`,
      bucket: 'tweets',
      signal: ctx.signal,
    });
    ctx.spend.record(PRICE['interaction.delete'], 'retweets/delete');
    return { reposted: false };
  },
});

export function extractId(value: string): string {
  const match = /status\/(\d+)/.exec(value);
  if (match?.[1]) return match[1];
  return value.trim().replace(/^@/, '');
}
