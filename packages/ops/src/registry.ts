import { accountStatus } from './ops/account.js';
import {
  postsCreate,
  postsDelete,
  postsEdit,
  postsGet,
  postsHideReply,
  postsMetrics,
  postsQuotes,
  postsRepost,
  postsSearchAll,
  postsSearchRecent,
  postsThread,
  postsTimeline,
  postsUnrepost,
} from './ops/posts.js';
import {
  usersBlock,
  usersBlocked,
  usersFollowers,
  usersFollowing,
  usersGet,
  usersLiked,
  usersMute,
  usersMuted,
  usersUnblock,
  usersUnmute,
} from './ops/users.js';
import { mediaStatus, mediaUpload } from './ops/media.js';
import { dmsConversation, dmsList, dmsSend } from './ops/dms.js';
import { bookmarksAdd, bookmarksList, bookmarksRemove } from './ops/bookmarks.js';
import {
  listsAddMember,
  listsCreate,
  listsDelete,
  listsMembers,
  listsOwned,
  listsRemoveMember,
  listsUpdate,
} from './ops/lists.js';
import { analyticsAccount } from './ops/analytics.js';
import { usageGet } from './ops/usage.js';
import { articlesDraft, articlesPublish } from './ops/articles.js';
import {
  communitiesGet,
  communitiesSearch,
  newsSearch,
  spacesGet,
  spacesSearch,
  trendsGet,
} from './ops/discover.js';
import type { AnyOperation } from './types.js';

export const registry = [
  accountStatus,

  postsCreate,
  postsThread,
  postsGet,
  postsEdit,
  postsDelete,
  postsSearchRecent,
  postsSearchAll,
  postsTimeline,
  postsMetrics,
  postsQuotes,
  postsHideReply,
  postsRepost,
  postsUnrepost,

  usersGet,
  usersFollowers,
  usersFollowing,
  usersLiked,
  usersBlocked,
  usersMuted,
  usersBlock,
  usersUnblock,
  usersMute,
  usersUnmute,

  mediaUpload,
  mediaStatus,

  dmsSend,
  dmsList,
  dmsConversation,

  bookmarksList,
  bookmarksAdd,
  bookmarksRemove,

  listsOwned,
  listsCreate,
  listsUpdate,
  listsDelete,
  listsMembers,
  listsAddMember,
  listsRemoveMember,

  analyticsAccount,
  usageGet,

  trendsGet,
  spacesSearch,
  spacesGet,
  communitiesSearch,
  communitiesGet,
  newsSearch,

  articlesDraft,
  articlesPublish,
] as const satisfies readonly AnyOperation[];

export type Registry = (typeof registry)[number];
export type OpId = Registry['id'];
