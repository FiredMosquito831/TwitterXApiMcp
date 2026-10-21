import * as z from 'zod/v4';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { PRICE, XApiError } from '@xctl/core';
import { defineOperation } from '../types.js';
import { READ, WRITE } from '../schemas.js';

const CATEGORY = z.enum(['tweet_image', 'tweet_gif', 'tweet_video', 'dm_image', 'dm_gif', 'dm_video', 'subtitles']);

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.srt': 'text/plain',
  '.vtt': 'text/vtt',
};

const SIMPLE_LIMIT = 5 * 1024 * 1024;
const CHUNK_SIZE = 4 * 1024 * 1024;

interface MediaData {
  data?: {
    id?: string;
    media_key?: string;
    expires_after_secs?: number;
    processing_info?: {
      state?: 'pending' | 'in_progress' | 'succeeded' | 'failed';
      check_after_secs?: number;
      progress_percent?: number;
      error?: { code?: number; message?: string };
    };
  };
}

export const mediaUpload = defineOperation({
  id: 'media.upload',
  summary: 'Upload an image, GIF or video and return a media id',
  description:
    'Uploads a local file or a URL to X and returns a media_id to attach with posts.create. Images are uploaded in ' +
    'one request; videos and large files use chunked upload and wait for processing. Optionally sets alt text. ' +
    'The token needs the media.write scope (a missing scope is the most common 403 here).',
  input: z
    .object({
      path: z.string().optional().describe('Local file path'),
      url: z.string().url().optional().describe('Remote file URL to download and upload'),
      alt_text: z.string().max(1000).optional(),
      category: CATEGORY.optional(),
      dry_run: z.boolean().default(false),
    })
    .refine((v) => Boolean(v.path || v.url), { message: 'Provide path or url' }),
  output: z.object({
    media_id: z.string(),
    media_type: z.string(),
    size_bytes: z.number().int(),
    category: z.string(),
    processing_state: z.string().nullable(),
    cost_usd: z.number(),
    dry_run: z.boolean(),
  }),
  rateClass: 'media',
  annotations: WRITE,
  cost: () => PRICE['media.metadata'],
  async run(ctx, input) {
    const loaded = await loadMedia(input);
    const category = input.category ?? defaultCategory(loaded.mediaType, loaded.filename);
    const price = PRICE['media.metadata'];

    if (input.dry_run) {
      return {
        media_id: '',
        media_type: loaded.mediaType,
        size_bytes: loaded.bytes.byteLength,
        category,
        processing_state: null,
        cost_usd: price,
        dry_run: true,
      };
    }

    let mediaId: string;
    let processingState: string | null = null;

    if (loaded.mediaType.startsWith('video/') || loaded.bytes.byteLength > SIMPLE_LIMIT) {
      const result = await chunkedUpload(ctx, loaded, category);
      mediaId = result.mediaId;
      processingState = result.state;
    } else {
      mediaId = await simpleUpload(ctx, loaded, category);
    }

    ctx.spend.record(price, 'media/upload');

    if (input.alt_text) {
      await setAltText(ctx, mediaId, input.alt_text);
    }

    return {
      media_id: mediaId,
      media_type: loaded.mediaType,
      size_bytes: loaded.bytes.byteLength,
      category,
      processing_state: processingState,
      cost_usd: price,
      dry_run: false,
    };
  },
});

export const mediaStatus = defineOperation({
  id: 'media.status',
  summary: 'Check processing state of an uploaded media id',
  description: 'Returns the processing state for a media id. Use after media.upload for videos if you did not wait.',
  input: z.object({ media_id: z.string() }),
  output: z.object({ processing: z.record(z.string(), z.unknown()) }),
  rateClass: 'read',
  annotations: READ,
  cost: () => 0,
  async run(ctx, input) {
    await ctx.limiter.acquire('media');
    const res = await ctx.transport.call<MediaData>({
      method: 'GET',
      path: '/2/media/upload',
      bucket: 'media',
      query: { media_id: input.media_id },
      signal: ctx.signal,
    });
    return { processing: (res.data?.data ?? {}) as Record<string, unknown> };
  },
});

interface LoadedMedia {
  bytes: Uint8Array;
  mediaType: string;
  filename: string;
}

async function loadMedia(input: { path?: string | undefined; url?: string | undefined }): Promise<LoadedMedia> {
  if (input.path) {
    const bytes = new Uint8Array(await readFile(input.path));
    const filename = basename(input.path);
    const mediaType = MIME[extname(input.path).toLowerCase()] ?? 'application/octet-stream';
    return { bytes, mediaType, filename };
  }

  const res = await fetch(input.url ?? '');
  if (!res.ok) throw new Error(`Failed to download ${input.url}: HTTP ${res.status}`);
  const contentLength = Number(res.headers.get('content-length') ?? 0);
  if (contentLength > 512 * 1024 * 1024) throw new Error('Media exceeds X\'s 512 MB limit.');
  const mediaType = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0] ?? 'application/octet-stream';
  const url = new URL(input.url ?? '');
  const filename = url.pathname.split('/').pop() || 'upload';
  return { bytes: new Uint8Array(await res.arrayBuffer()), mediaType, filename };
}

function defaultCategory(mediaType: string, filename: string): z.infer<typeof CATEGORY> {
  if (mediaType === 'image/gif' || filename.toLowerCase().endsWith('.gif')) return 'tweet_gif';
  if (mediaType.startsWith('video/')) return 'tweet_video';
  return 'tweet_image';
}

async function simpleUpload(
  ctx: Parameters<typeof mediaStatus.run>[0],
  media: LoadedMedia,
  category: string,
): Promise<string> {
  const form = new FormData();
  form.set('media', new Blob([media.bytes], { type: media.mediaType }), media.filename);
  form.set('media_category', category);

  const res = await ctx.transport.call<MediaData>({
    method: 'POST',
    path: '/2/media/upload',
    bucket: 'media',
    body: form,
    signal: ctx.signal,
  });

  const id = res.data?.data?.id;
  if (!id) throw new Error('Media upload succeeded without a media id.');
  return id;
}

async function chunkedUpload(
  ctx: Parameters<typeof mediaStatus.run>[0],
  media: LoadedMedia,
  category: string,
): Promise<{ mediaId: string; state: string | null }> {
  const init = await ctx.transport.call<MediaData>({
    method: 'POST',
    path: '/2/media/upload/initialize',
    bucket: 'media',
    body: {
      media_type: media.mediaType,
      total_bytes: media.bytes.byteLength,
      media_category: category,
    },
    signal: ctx.signal,
  });

  const mediaId = init.data?.data?.id;
  if (!mediaId) throw new Error('Chunked upload initialize did not return a media id.');

  let segment = 0;
  for (let offset = 0; offset < media.bytes.byteLength; offset += CHUNK_SIZE) {
    const chunk = media.bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, media.bytes.byteLength));
    const form = new FormData();
    form.set('media', new Blob([chunk], { type: media.mediaType }), media.filename);
    form.set('segment_index', String(segment));
    await ctx.transport.call({
      method: 'POST',
      path: `/2/media/upload/${encodeURIComponent(mediaId)}/append`,
      bucket: 'media',
      body: form,
      signal: ctx.signal,
    });
    segment += 1;
  }

  const finalize = await ctx.transport.call<MediaData>({
    method: 'POST',
    path: `/2/media/upload/${encodeURIComponent(mediaId)}/finalize`,
    bucket: 'media',
    signal: ctx.signal,
  });

  let info = finalize.data?.data?.processing_info;
  let attempts = 0;
  while (info?.state === 'pending' || info?.state === 'in_progress') {
    if (attempts++ > 30) break;
    const wait = Math.max(1, info.check_after_secs ?? 2) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    const status = await ctx.transport.call<MediaData>({
      method: 'GET',
      path: '/2/media/upload',
      bucket: 'media',
      query: { media_id: mediaId },
      signal: ctx.signal,
    });
    info = status.data?.data?.processing_info;
  }

  if (info?.state === 'failed') {
    throw new Error(
      `Media processing failed: ${info.error?.message ?? 'unknown error'} (code ${info.error?.code ?? '?'})`,
    );
  }

  return { mediaId, state: info?.state ?? null };
}

async function setAltText(
  ctx: Parameters<typeof mediaStatus.run>[0],
  mediaId: string,
  altText: string,
): Promise<void> {
  try {
    await ctx.transport.call({
      method: 'POST',
      path: '/2/media/metadata',
      bucket: 'media',
      body: { media_id: mediaId, alt_text: altText },
      signal: ctx.signal,
    });
  } catch (err) {
    if (!(err instanceof XApiError) || ![400, 404, 405].includes(err.status)) throw err;
    // Fall back to the v1.1 shape, still served for cookie/OAuth1 sessions.
    await ctx.transport.call({
      method: 'POST',
      path: '/1.1/media/metadata/create.json',
      bucket: 'media',
      body: { media_id: mediaId, alt_text: { text: altText } },
      signal: ctx.signal,
    });
  }
}
