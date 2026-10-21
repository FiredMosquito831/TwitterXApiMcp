import * as z from 'zod/v4';
import { defineOperation } from '../types.js';
import { READ, WRITE } from '../schemas.js';

interface DraftBlock {
  key: string;
  text: string;
  type: string;
  depth: number;
  inlineStyleRanges: unknown[];
  entityRanges: unknown[];
  data: Record<string, unknown>;
}

interface DraftState {
  blocks: DraftBlock[];
  entityMap: Record<string, unknown>;
}

function buildContentState(paragraphs: string[]): DraftState {
  return {
    blocks: paragraphs.map((text, index) => ({
      key: `blk${index.toString(36)}`,
      text,
      type: 'unstyled',
      depth: 0,
      inlineStyleRanges: [],
      entityRanges: [],
      data: {},
    })),
    entityMap: {},
  };
}

export const articlesDraft = defineOperation({
  id: 'articles.draft',
  summary: 'Create a long-form Article draft',
  description:
    'Creates an Article draft from paragraphs or a raw DraftJS content_state. Returns an article id; publish it with ' +
    'articles.publish. Drafts are not public until published. DraftJS shape must match X\'s editor; if X rejects it, ' +
    'pass content_state exported from a real draft.',
  input: z
    .object({
      title: z.string().min(1).max(200),
      paragraphs: z.array(z.string().min(1)).min(1).max(200).optional(),
      content_state: z.string().optional().describe('Raw DraftJS JSON string'),
      cover_media_id: z.string().optional(),
    })
    .refine((v) => Boolean(v.paragraphs?.length || v.content_state), {
      message: 'Provide paragraphs or content_state',
    }),
  output: z.object({ article_id: z.string(), title: z.string() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => 0,
  async run(ctx, input) {
    let contentState: unknown;
    if (input.content_state) {
      try {
        contentState = JSON.parse(input.content_state);
      } catch {
        throw new Error('content_state must be valid JSON');
      }
    } else {
      contentState = buildContentState(input.paragraphs ?? []);
    }

    await ctx.limiter.acquire('tweets');
    const res = await ctx.transport.call<{ data?: { id?: string; article_id?: string } }>({
      method: 'POST',
      path: '/2/articles/draft',
      bucket: 'tweets',
      body: {
        title: input.title,
        content_state: contentState,
        ...(input.cover_media_id ? { cover_media_id: input.cover_media_id } : {}),
      },
      signal: ctx.signal,
    });

    const id = res.data?.data?.id ?? res.data?.data?.article_id;
    if (!id) throw new Error('Article draft was created without an id.');
    return { article_id: id, title: input.title };
  },
});

export const articlesPublish = defineOperation({
  id: 'articles.publish',
  summary: 'Publish an Article draft',
  description:
    'Publishes a draft created with articles.draft, making it publicly visible on X. Destructive and not reversible ' +
    'in the same call; confirm the article id and content first.',
  input: z.object({ article_id: z.string() }),
  output: z.object({ post_id: z.string().nullable(), published: z.boolean() }),
  rateClass: 'write',
  annotations: WRITE,
  cost: () => 0,
  async run(ctx, input) {
    await ctx.limiter.acquire('tweets');
    const res = await ctx.transport.call<{ data?: { post_id?: string; published?: boolean } }>({
      method: 'POST',
      path: `/2/articles/${encodeURIComponent(input.article_id)}/publish`,
      bucket: 'tweets',
      signal: ctx.signal,
    });
    return {
      post_id: res.data?.data?.post_id ?? null,
      published: res.data?.data?.published ?? true,
    };
  },
});
