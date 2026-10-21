import * as z from 'zod/v4';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { defineOperation, type AnyOperation, type ToolAnnotations } from '@xctl/ops';

const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const WARNING =
  'UNOFFICIAL: this uses X\'s private web API through your browser session. X prohibits this and may suspend the account. ' +
  'It runs only because you enabled the unofficial transport.';

function web(ctx: { web?: { kind: 'unofficial' } }) {
  if (!ctx.web) {
    throw new Error(
      'Unofficial transport is not active. Enable it with `x config set-unofficial on --i-understand` ' +
        'and import cookies with `x auth import-cookies --file cookies.json`.',
    );
  }
  return ctx.web as import('@xctl/core').WebClient;
}

function idFrom(value: string): string {
  const match = /status\/(\d+)/.exec(value);
  return match?.[1] ?? value.trim();
}

export const likesAdd = defineOperation({
  id: 'likes.add',
  summary: 'Like a post (unofficial)',
  description: `${WARNING} Likes one post as the authenticated account. X's rules require likes to be initiated directly ` +
    'by the user: call this only for an explicit, individual request, never in a loop.',
  input: z.object({ id: z.string().describe('Post id or status URL') }),
  output: z.object({ liked: z.boolean() }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: WRITE,
  cost: () => 0,
  async run(ctx, input) {
    await web(ctx).graphql('FavoriteTweet', { tweet_id: idFrom(input.id) });
    return { liked: true };
  },
});

export const likesRemove = defineOperation({
  id: 'likes.remove',
  summary: 'Unlike a post (unofficial)',
  description: `${WARNING} Removes a like. One post per call.`,
  input: z.object({ id: z.string() }),
  output: z.object({ liked: z.boolean() }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: { ...WRITE, destructiveHint: false },
  cost: () => 0,
  async run(ctx, input) {
    await web(ctx).graphql('UnfavoriteTweet', { tweet_id: idFrom(input.id) });
    return { liked: false };
  },
});

export const followsAdd = defineOperation({
  id: 'follows.add',
  summary: 'Follow a user (unofficial)',
  description: `${WARNING} Follows one account. Bulk or aggressive following violates X's rules. One target per call.`,
  input: z
    .object({
      user_id: z.string().optional(),
      username: z.string().optional(),
    })
    .refine((v) => Boolean(v.user_id || v.username), { message: 'Provide user_id or username' }),
  output: z.object({ following: z.boolean() }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: WRITE,
  cost: () => 0,
  async run(ctx, input) {
    const form: Record<string, string> = input.user_id
      ? { user_id: input.user_id }
      : { screen_name: (input.username ?? '').replace(/^@/, '') };
    await web(ctx).v11('/1.1/friendships/create.json', { method: 'POST', form });
    return { following: true };
  },
});

export const followsRemove = defineOperation({
  id: 'follows.remove',
  summary: 'Unfollow a user (unofficial)',
  description: `${WARNING} Unfollows one account.`,
  input: z
    .object({
      user_id: z.string().optional(),
      username: z.string().optional(),
    })
    .refine((v) => Boolean(v.user_id || v.username), { message: 'Provide user_id or username' }),
  output: z.object({ following: z.boolean() }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: { ...WRITE, destructiveHint: false },
  cost: () => 0,
  async run(ctx, input) {
    const form: Record<string, string> = input.user_id
      ? { user_id: input.user_id }
      : { screen_name: (input.username ?? '').replace(/^@/, '') };
    await web(ctx).v11('/1.1/friendships/destroy.json', { method: 'POST', form });
    return { following: false };
  },
});

export const profileUpdate = defineOperation({
  id: 'profile.update',
  summary: 'Update name, bio, location or URL (unofficial)',
  description:
    `${WARNING} Updates profile fields. There is no official endpoint for this. Provide only the fields you intend ` +
    'to change; omitted fields are left alone.',
  input: z.object({
    name: z.string().max(50).optional(),
    description: z.string().max(160).optional(),
    location: z.string().max(30).optional(),
    url: z.string().max(100).optional(),
  }),
  output: z.object({ updated: z.boolean(), fields: z.array(z.string()) }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: WRITE,
  cost: () => 0,
  async run(ctx, input) {
    const form: Record<string, string> = {};
    if (input.name !== undefined) form['name'] = input.name;
    if (input.description !== undefined) form['description'] = input.description;
    if (input.location !== undefined) form['location'] = input.location;
    if (input.url !== undefined) form['url'] = input.url;
    if (!Object.keys(form).length) throw new Error('No profile fields provided.');

    await web(ctx).v11('/1.1/account/update_profile.json', { method: 'POST', form });
    return { updated: true, fields: Object.keys(form) };
  },
});

export const profileAvatar = defineOperation({
  id: 'profile.avatar',
  summary: 'Replace the avatar image (unofficial)',
  description:
    `${WARNING} Uploads a new avatar. The image is base64-encoded in the request body; X limits avatars to 2 MB.`,
  input: z.object({ path: z.string().describe('Local image path') }),
  output: z.object({ updated: z.boolean(), bytes: z.number().int() }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: WRITE,
  cost: () => 0,
  async run(ctx, input) {
    const bytes = await readFile(input.path);
    if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('Avatar exceeds 2 MB.');
    await web(ctx).v11('/1.1/account/update_profile_image.json', {
      method: 'POST',
      form: { image: bytes.toString('base64') },
    });
    return { updated: true, bytes: bytes.byteLength };
  },
});

export const profileBanner = defineOperation({
  id: 'profile.banner',
  summary: 'Replace the banner image (unofficial)',
  description:
    `${WARNING} Uploads a new banner. Provide width/height and offsets so X crops it correctly; defaults are 1500x500 ` +
    'at offset 0,0.',
  input: z.object({
    path: z.string(),
    width: z.coerce.number().int().positive().default(1500),
    height: z.coerce.number().int().positive().default(500),
    offset_top: z.coerce.number().int().default(0),
    offset_left: z.coerce.number().int().default(0),
  }),
  output: z.object({ updated: z.boolean(), bytes: z.number().int() }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: WRITE,
  cost: () => 0,
  async run(ctx, input) {
    const bytes = await readFile(input.path);
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('Banner exceeds 5 MB.');
    await web(ctx).v11('/1.1/account/update_profile_banner.json', {
      method: 'POST',
      form: {
        banner: bytes.toString('base64'),
        width: String(input.width),
        height: String(input.height),
        offset_top: String(input.offset_top),
        offset_left: String(input.offset_left),
      },
    });
    return { updated: true, bytes: bytes.byteLength };
  },
});

export const postsPin = defineOperation({
  id: 'posts.pin',
  summary: 'Pin a post to the profile (unofficial)',
  description: `${WARNING} Pins one of your posts to the top of your profile. There is no official endpoint for this.`,
  input: z.object({ id: z.string() }),
  output: z.object({ pinned: z.boolean() }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: WRITE,
  cost: () => 0,
  async run(ctx, input) {
    await web(ctx).graphql('PinTweet', { tweet_id: idFrom(input.id) });
    return { pinned: true };
  },
});

export const postsUnpin = defineOperation({
  id: 'posts.unpin',
  summary: 'Unpin a post (unofficial)',
  description: `${WARNING} Removes the pinned post from the profile.`,
  input: z.object({ id: z.string() }),
  output: z.object({ pinned: z.boolean() }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: { ...WRITE, destructiveHint: false },
  cost: () => 0,
  async run(ctx, input) {
    await web(ctx).graphql('UnpinTweet', { tweet_id: idFrom(input.id) });
    return { pinned: false };
  },
});

export const postsQuote = defineOperation({
  id: 'posts.quote',
  summary: 'Quote-post a post (unofficial)',
  description:
    `${WARNING} Quote-posting is Enterprise-only on the official API. This creates a normal post with the quoted status ` +
    'attached. NOT idempotent.',
  input: z.object({
    id: z.string().describe('Post id being quoted'),
    text: z.string().max(25_000).default(''),
  }),
  output: z.object({ quoted: z.boolean() }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: WRITE,
  cost: () => 0,
  async run(ctx, input) {
    await web(ctx).graphql('CreateTweet', {
      tweet_text: input.text,
      dark_request: false,
      media: { media_entities: [], tagged_users: [] },
      semantic_annotation_ids: [],
      attachment_url: `https://x.com/i/status/${idFrom(input.id)}`,
      disallowed_reply_options: null,
    });
    return { quoted: true };
  },
});

export const postsNote = defineOperation({
  id: 'posts.note',
  summary: 'Publish a long-form Note post (unofficial)',
  description:
    `${WARNING} Creates a long-form post via CreateNoteTweet. Premium accounts only. NOT idempotent.`,
  input: z.object({ text: z.string().min(1).max(25_000) }),
  output: z.object({ posted: z.boolean() }),
  rateClass: 'write',
  transports: ['unofficial'],
  annotations: WRITE,
  cost: () => 0,
  async run(ctx, input) {
    await web(ctx).graphql('CreateNoteTweet', {
      tweet_text: input.text,
      dark_request: false,
      media: { media_entities: [], tagged_users: [] },
      semantic_annotation_ids: [],
    });
    return { posted: true };
  },
});

export const unofficialRegistry = [
  likesAdd,
  likesRemove,
  followsAdd,
  followsRemove,
  profileUpdate,
  profileAvatar,
  profileBanner,
  postsPin,
  postsUnpin,
  postsQuote,
  postsNote,
] as const satisfies readonly AnyOperation[];
