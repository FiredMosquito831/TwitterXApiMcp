# X (Twitter) API Landscape — official API (2026-10-21)

Verified against `docs.x.com` primary sources, the OpenAPI spec (`v2.172`, 186 paths), the `xdevplatform/docs` GitHub source, the official changelog, and X staff forum posts. Unverifiable items flagged **UNVERIFIED**.

---

## 0. Executive summary

The plan — a personal CLI + MCP server covering posting, liking, DMs, profile management — is **partly impossible on official X API self-serve access as of today**. Three restriction waves in 2026 removed the exact features most "control my account" tools need.

| Capability | Status on self-serve (pay-per-use), Oct 2026 |
|---|---|
| Post / delete / thread / poll / media | ✅ Works |
| Reply | ⚠️ **Only if the original author "summoned" you** (Feb 23, 2026) |
| Quote post | ❌ **Enterprise only** (Apr 20, 2026) |
| Like / unlike | ❌ **Removed from all self-serve tiers** (Apr 20, 2026) |
| Follow / unfollow | ❌ **Removed from all self-serve tiers** (Apr 20, 2026) |
| Repost / undo repost | ✅ Still works (widely mis-reported as removed — it was not) |
| Profile update (name/bio/location/url/avatar/banner) | ❌ **No v2 endpoint exists at all** |
| Pin post | ❌ **No endpoint exists at all** |
| DMs send/read | ✅ Works, no tier restriction |
| Bookmarks | ✅ Works |
| Lists, Spaces (read), Communities (read), analytics | ✅ Read; Spaces/Communities read-only |

---

## 1. Tiers and pricing

**The tier system is gone.** Free / Basic / Pro no longer exist for new signups. X is pay-per-use, credit-based. Pricing page carries no publication date — live-verified 2026-10-21.

> "The X API uses **pay-per-usage** pricing. No subscriptions—pay only for what you use." — docs.x.com/x-api/getting-started/pricing

| Tier | Price | Availability Oct 2026 | Notes |
|---|---|---|---|
| **Pay-per-use** | Prepaid credits, per-resource | ✅ Only self-serve option | Cap: 3,000,000 Post reads / billing cycle |
| **Free** | $0 | ❌ Discontinued Feb 6, 2026 | "For-good Public Utility apps" keep scaled access; legacy Free users got a one-time $10 voucher |
| **Basic** | $200/mo | ❌ Closed to new signups | Legacy; third-party reports of forced migration after Jun 1, 2026 — **UNVERIFIED by X** |
| **Pro** | $5,000/mo | ❌ Closed to new signups | Legacy; reported deprecation after Sep 1, 2026 — **UNVERIFIED** |
| **Enterprise** | Custom (reported ~$42,000+/mo, 2023 figure) | ✅ Sales-gated | Sole route to quotes, likes, follows, full firehose |

### 1.1 Rate card

**Reads — per resource returned**

| Resource | Price |
|---|---|
| Posts: Read | $0.005 |
| User: Read | $0.010 |
| DM Event: Read | $0.010 |
| Following/Followers: Read | $0.010 |
| List / Space / Community / Note: Read | $0.005 |
| Like / Mute / Block: Read | $0.001 |
| Profile Update: Read | $0.005 |

**Writes — per request**

| Action | Price |
|---|---|
| Post: Create | $0.015 |
| **Post: Create (with URL)** | **$0.200** |
| Post: Create (summoned reply) | $0.010 |
| DM Interaction: Create | $0.015 |
| User Interaction: Create | $0.015 |
| Interaction: Delete | $0.010 |
| Content: Manage | $0.005 |
| List: Create / Manage | $0.010 / $0.005 |
| Bookmark | $0.005 |
| Media Metadata | $0.005 |
| Privacy: Update | $0.010 |
| Mute: Delete | $0.005 |
| Counts: Recent / All | $0.005 / $0.010 |
| Trends | $0.010 |

**Webhook events — per delivery**

| Event | Price |
|---|---|
| `post.create` | $0.005 |
| `post.delete` | free |
| `follow.follow` / `follow.unfollow` | $0.010 |
| `mute.*` / `block.*` | $0.001 |
| `profile.update.*` | $0.005 |
| `dm.received` / `chat.received` | $0.010 |
| `dm.sent`, `dm.read`, `dm.indicate_typing`, `chat.sent` | free |
| `news.new`, `spaces.start`, `spaces.end` | $0.005 |

**Owned Reads — $0.001 per resource**, only when `{id}` is the authenticated user **who owns the developer app**. Qualifying: `/2/users/{id}/` + `tweets`, `mentions`, `liked_tweets`, `bookmarks`, `followers`, `following`, `blocking`, `muting`, `owned_lists`, `followed_lists`, `list_memberships`, `pinned_lists`.

> **The single most important lever:** a single-tenant personal tool where the user owns the app qualifies for $0.001 reads (5× cheaper). A multi-tenant product where customers connect accounts does **not**.

### 1.2 Billing rules that change the math

- **Deduplication:** charged once per 24h UTC window regardless of fetch count — a "soft guarantee" with outage exceptions. Polling hourly costs the same as once/day.
- **Failed requests are not billed** — only successful responses returning data.
- **Expansions bill separately.** `expansions=author_id` on 100 posts = 100 × $0.005 + up to 100 × $0.010 = $1.50, not $0.50. (**UNVERIFIED** directly, consistent with the rate card.)
- **Balances can go slightly negative**; requests blocked until topped up. Undocumented `402` / `credits-depleted`.
- **Auto-recharge:** max one top-up per 5 minutes; paused at zero/negative balance.
- **Spending limit:** hard dollar cap per billing cycle.

### 1.3 Free credits (new, Oct 2, 2026)

| Incentive | Amount | Conditions |
|---|---|---|
| First card + first purchase | $20 | First and only payment method; once per account **and** per physical card |
| First auto-recharge match | up to $50 | First successful auto-recharge only |
| **Total** | **$70** | Expire **3 months**; consumed before purchased credits |

### 1.4 xAI credit rebate

Up to 20% back in xAI/Grok API credits per billing cycle: 0% at $0–199, 10% at $200–499, 15% at $500–999, 20% at $1,000+. Requires linking your xAI team to your X developer account.

---

## 2. Endpoint coverage (OpenAPI v2.172, 186 paths)

### 2.1 What works

| Action | Endpoint | Self-serve? | Price |
|---|---|---|---|
| Create post | `POST /2/tweets` | ✅ | $0.015 |
| Create post with URL | `POST /2/tweets` | ✅ | **$0.200** |
| Reply | + `reply.in_reply_to_tweet_id` | ⚠️ summoned only | $0.010 |
| Self-reply / thread chaining | `POST /2/tweets` | ✅ (own posts need no summon) | $0.015 |
| Quote post | + `quote_tweet_id` | ❌ **Enterprise** | — |
| Poll | + `poll` (2–4 options, 1–25 chars, 5–10,080 min) | ✅ | $0.015 |
| Delete post | `DELETE /2/tweets/{id}` | ✅ | $0.010 |
| Edit post | + `edit_options.previous_post_id` | ✅ | $0.015 |
| Repost / undo | `POST`/`DELETE /2/users/{id}/retweets` | ✅ | $0.015 |
| Like / unlike | `/2/users/{id}/likes` | ❌ **Removed** | — |
| Follow / unfollow | `/2/users/{id}/following` | ❌ **Removed** | — |
| Bookmark add/remove/list/folders | `/2/users/{id}/bookmarks` | ✅ | $0.005 |
| Mute / unmute | `/2/users/{id}/muting` | ✅ | $0.005 |
| Block / unblock | `/2/users/{id}/blocking` | ✅ | Privacy: Update |
| DM send | `POST /2/dm_conversations/with/{id}/messages`, `POST /2/dm_conversations` | ✅ | $0.015 |
| DM read | `GET /2/dm_events`, `/2/dm_conversations/.../dm_events` | ✅ | $0.010/event |
| DM media download | `GET /2/dm_conversations/media/...` | ✅ | — |
| Hide reply | `PUT /2/tweets/{tweet_id}/hidden` | ✅ | $0.005 |
| Media upload | `/2/media/upload` (simple) + `/initialize`→`/append`→`/finalize` | ✅ | $0.005 |
| Media metadata / subtitles / analytics | `/2/media/metadata`, `/2/media/subtitles`, `/2/media/analytics` | ✅ | $0.005 |
| List create/update/delete/members/pin | `/2/lists/...`, `/2/users/{id}/pinned_lists` | ✅ | $0.010 / $0.005 |
| Home timeline | `GET /2/users/{id}/timelines/reverse_chronological` | ✅ | $0.005 (owned $0.001) |
| Mentions | `GET /2/users/{id}/mentions` | ✅ | owned $0.001 |
| User posts | `GET /2/users/{id}/tweets` | ✅ | owned $0.001 |
| Search recent (7d) | `GET /2/tweets/search/recent` | ✅ | $0.005/post |
| Search all (2006→) | `GET /2/tweets/search/all` | ✅ | $0.005/post |
| Counts | `/2/tweets/counts/recent`, `/counts/all` | ✅ | $0.005 / $0.010 |
| Trends | `/2/trends/by/woeid/{woeid}`, `/2/users/personalized_trends` | ✅ | $0.010 |
| Spaces | `GET /2/spaces`, `/search`, `/{id}`, `/{id}/buyers`, `/{id}/tweets` | ✅ **read-only** | $0.005 |
| Communities | `GET /2/communities/{id}`, `/2/communities/search` | ✅ **read-only** | $0.005 |
| Community Notes | `POST /2/notes`, `/2/notes/evaluate`, search | ✅ | $0.005 |
| Post analytics | `GET /2/tweets/analytics`, `/2/media/analytics` | ✅ | — |
| Usage / credits | `GET /2/usage/tweets`, `/2/usage/credits` | ✅ | free |
| Articles | `POST /2/articles/draft`, `/2/articles/{id}/publish` | ✅ | — |
| X Chat (E2E DMs) | 36 endpoints under `/2/chat/...` | ✅ | `chat.received` $0.010 |
| News | `/2/news/search`, `/2/news/{id}` | ✅ | — |
| Broadcasts | 11 endpoints under `/2/broadcasts/...` | ✅ | — |
| Scheduled calls | `/2/calls/scheduled` | ✅ | — |
| Bots | `/2/bots`, `/2/bots/{id}/token` | ✅ | — |
| Filtered stream | `GET /2/tweets/search/stream` | ⚠️ basic; Powerstream Enterprise | per post |
| X Activity API | `/2/activity/subscriptions`, `/2/activity/stream` | ✅ | per event |
| Webhooks | `/2/webhooks` | ✅ | per event |
| Compliance jobs | `/2/compliance/jobs` | ✅ | — |

### 2.2 Hard gaps

| Missing | Detail |
|---|---|
| **Profile update** | No v2 endpoint. `GET /2/users/me` read-only. `users/lookup` intro: "none creates or updates a profile." No `PATCH /2/users`. The "Profile Update: Read" price line refers to reading `profile.update.*` *events*. v1.1 `account/update_profile` is not in the v2 map. |
| **Pinned post** | No endpoint in v2 or OpenAPI. Only `pinned_lists`. Third-party APIs do it via internal GraphQL — which violates the automation rules. |
| **Avatar / banner upload** | No v2 endpoint. |
| **Create/join Community** | Lookup + search only. (You *can* post *into* a community via `community_id`.) |
| **Create/start a Space** | Spaces API entirely read-only. |
| **Quote post** | Enterprise only — hard block in `POST /2/tweets`. |
| **Like / follow** | Removed from self-serve. |
| **Bulk DM** | Prohibited by policy; rate-limited to 15/15min. |

### 2.3 The three 2026 restriction waves

**Wave 1 — Feb 23, 2026 — replies.**
> "Programmatic replies via `POST /2/tweets` are now only permitted when the original Post's author has 'summoned' the replier (by @mentioning that account or quoting one of its Posts). Additional restrictions apply to programmatically @mentioning or quoting users. These changes affect self-serve tiers only — Enterprise access is not impacted."

**Wave 2 — Apr 16/20, 2026 — likes, follows, quotes.** X staff (taycaldwell), forum thread 263025:
> "**Following, Likes, and Quote-Posts via API Writes** will be removed for all self-serve tiers… `POST /2/users/{id}/following` (and DELETE), `POST /2/users/{id}/likes` (and DELETE), Quote-posting via `POST /2/tweets` (when using `quote_tweet_id`)."

**Wave 3 — cashtag limit.** Self-serve posts limited to 1 cashtag per post.

**Docs drift:** `like-post.mdx` and `follow-user.mdx` contain only an OpenAPI reference with no restriction note, and the spec carries no `enterprise`/`self-serve` markers. Design defensively — expect a runtime 403, not a schema-level block. Runtime 403 behavior **UNVERIFIED**.

### 2.4 Rate limits (independent of billing)

| Endpoint | Per app | Per user |
|---|---|---|
| `POST /2/tweets` | 10,000/24h | **100/15min** |
| `DELETE /2/tweets/:id` | — | 50/15min |
| `GET /2/tweets` | 3,500/15min | 5,000/15min |
| `GET /2/tweets/:id` | 450/15min | 900/15min |
| Recent search | 450/15min | 300/15min |
| Full-archive search | 300/15min + 1/s | 1/s |
| User posts timeline | 10,000/15min | 900/15min |
| Mentions | 450/15min | 300/15min |
| Home timeline | — | 180/15min |
| Followers / following | 300/15min | 300/15min |
| Likes lookup | 75/15min | 75/15min |
| User lookup | 300/15min | 900/15min |
| `GET /2/users/me` | — | 75/15min |
| **DM read** | — | **15/15min** |
| **DM send** | 1,440/24h | **15/15min and 1,440/24h** |
| DM delete | 4,000/24h | 300/15min, 1,500/24h |
| Follow / unfollow | — | 50/15min |
| Media upload | 50,000/24h | 500/15min |

**DM polling at 15 reads/15min is the binding constraint** for poll-based DM features — max one poll per minute. Use the X Activity API `dm.received` webhook/stream instead.

Account-level posting caps (e.g. "50 original posts + 200 replies/day for unverified") appear only in third-party blogs — **UNVERIFIED**.

---

## 3. OAuth 2.0 Authorization Code with PKCE

| Item | Value |
|---|---|
| Authorize URL | `https://x.com/i/oauth2/authorize` |
| Token URL | `POST https://api.x.com/2/oauth2/token` |
| Content type | `application/x-www-form-urlencoded` |
| `response_type` | `code` |
| PKCE | `S256` or `plain` |
| `state` | up to 500 chars |
| `redirect_uri` | exact match required |
| **Authorization code lifetime** | **30 seconds** |
| **Access token lifetime** | **2 hours** |
| Refresh token | only if `offline.access` requested |
| Refresh body | `grant_type=refresh_token`, `refresh_token`, `client_id` (public clients must include; confidential may use Basic auth) |
| Refresh token lifetime | **not documented** — UNVERIFIED |

### 3.1 Scope list

| Scope | Grants |
|---|---|
| `tweet.read` | All posts you can view, incl. protected |
| `tweet.write` | Post and repost |
| `tweet.moderate.write` | Hide/unhide replies |
| `users.read` | Any account you can view |
| `users.email` | Authenticated user's email |
| `follows.read` / `follows.write` | Follow graph / follow-unfollow (**write inert on self-serve**) |
| `like.read` / `like.write` | Likes (**write inert on self-serve**) |
| `block.read` / `block.write` | Blocks |
| `mute.read` / `mute.write` | Mutes |
| `bookmark.read` / `bookmark.write` | Bookmarks |
| `list.read` / `list.write` | Lists |
| `dm.read` / `dm.write` | Direct Messages |
| `media.write` | Upload media |
| `space.read` | Spaces |
| `broadcast.read` / `broadcast.write` | Live broadcasts + chat |
| `offline.access` | Issues refresh token |

⚠️ `media.write` is **not optional**. Uploads 403 without it; tokens minted before adding it must be re-authorized. #1 reported integration failure.

### 3.2 Auth method per endpoint

| Auth | Use |
|---|---|
| **OAuth 2.0 user token (PKCE)** | Recommended for all user-context work; granular scopes |
| **OAuth 1.0a user token** | Fully supported. Accepted by media upload (`UserToken`), Articles, DMs. Use for a permanent token without refresh plumbing |
| **App-only Bearer** | Public reads only |
| **Basic auth** | Enterprise only |

**OAuth 1.0a status:** alive, not deprecated. Since **Sep 21, 2026**, OAuth 1.0a user tokens can be exchanged for OAuth 2.0 tokens via `POST /2/oauth2/token`.

**Media upload auth:** `POST /2/media/upload` accepts `OAuth2UserToken[media.write]` **or** `UserToken` (OAuth 1.0a).

**v1.1 media upload is dead.** `upload.twitter.com/1.1/media/upload.json` deprecated Mar 31, 2025, shut down **June 9, 2025**; returns 403 with empty body. Any tutorial recommending v1.1 for media is wrong.

---

## 4. Automation rules, Developer Agreement, platform manipulation policy

Primary: help.x.com/en/rules-and-policies/x-automation (updated April 2026); docs.x.com/developer-guidelines; docs.x.com/developer-terms/agreement; /policy; /restricted-use-cases.

### 4.1 Allowed for a personal bot

> "Build solutions that automatically broadcast helpful information in posts."
> "Run creative campaigns that auto-reply to users who engage with your content."
> "Automated posts that cross-post outside information: … based on sources of outside information — such as an RSS feed, weather data, etc. — as long as you are sufficiently authorized to publish such information."
> "Other automated posts (excluding mentions or replies): Provided you comply with all other rules, you may post automated posts for entertainment, informational, or novelty purposes."

Automated **reposts** are allowed for entertainment/informational/novelty purposes, but "bulk, aggressive, or spammy Reposting is a violation."

Automated **bookmarks** and **reads**: explicitly fine for personal/automated use within rate limits.

### 4.2 Disallowed

**Likes (hard prohibition, independent of the API removal):**
> "**Automated likes or hide replies:** You may not like posts or hide replies in an automated manner."
> "**Likes must be directly initiated by the authenticated user.** Automated, bulk, or indiscriminate liking — including auto-liking by keyword, hashtag, user, or schedule — is prohibited. Apps may not offer 'auto-like' features or sell likes as a service."

**Following:**
> "**Automated following/unfollowing:** You may not follow or unfollow accounts in a bulk, aggressive, or indiscriminate manner."

**Replies/mentions:**
> "Automating these actions to reach many users on an unsolicited basis is an abuse of the feature, and is not permitted. For example, sending automated replies to posts based on keyword searches alone is not permitted."

Permitted only if: recipient opted in beforehand; clear opt-out honored; **"you only send one automated reply or mention per user interaction"**; reply targets the user's original post. "A user following your account is not on its own a sufficient indication of user intent."

**AI-generated replies — separate approval gate:**
> "the deployment or operation of any AI reply bot requires prior written and explicit approval from X."
> "Deploying AI-generated replies without approval is a violation, even if the content itself is helpful."

**DMs:**
> "You may not send unsolicited Direct Messages in a bulk or automated manner."
> Auto-DMing new followers is "Unsolicited, even to followers."

**Duplicate / bulk content:**
> "You may not post duplicative or substantially similar posts on one account or over multiple accounts you operate."
> "You may not create and/or automate multiple accounts for duplicative or substantially similar use cases."

**Trends:**
> "You may not automatically post about trending topics on X, or use automation to attempt to influence or manipulate trending topics."

**Lists:**
> "You may not add users to lists or add posts to collections in a bulk or indiscriminate manner."

**Non-API automation — permanent suspension:**
> "Use non-API-based forms of automation, such as scripting the X website. The use of these techniques may result in the permanent suspension of your account."
> "**Non-API automation (scraping, browser automation) results in permanent suspension.**"

**AI training:** storing X data to train AI/ML models is "Prohibited (except Grok)."

**Redistribution caps:** max 1.5M Post IDs per 30-day period to any single entity; max 50,000 hydrated Posts/Users per recipient per day.

### 4.3 Bot labeling — mandatory for automated accounts

1. Enable the **"Automated" profile label**
2. Disclose in bio that it's a bot **and who operates it**
3. Link to a human-managed account
4. Honor opt-out requests immediately
5. Use only the official X API
6. Stay within rate limits

Violations: "app suspension, API access revocation, or permanent account bans."

**Implication:** a *human-in-the-loop* CLI/MCP that the user drives (they type the post, they trigger the action) is not an "automated account" — it's a client app, like a third-party Twitter client. That framing is the safest compliance posture. Anything scheduled, keyword-triggered, or unattended crosses into bot territory and inherits all six requirements plus the prohibition list.

---

## 5. New in 2025–2026

| Date | Change |
|---|---|
| Jan 16, 2025 | v2 media upload endpoints launched |
| Apr 30, 2025 | Chunked media upload |
| May 20, 2025 | Account Activity API in v2 |
| **Jun 9, 2025** | **v1.1 media upload shut down** |
| Jul 8, 2025 | Community Notes API |
| Aug 22, 2025 | Like + follow POST removed from **Free** tier |
| Sep 9, 2025 | Filtered Stream Webhooks (Enterprise) |
| Oct 3, 2025 | **Post editing** |
| Oct 18, 2025 | X Activity API open beta |
| Oct 20, 2025 | Pay-per-use closed beta |
| Nov 3, 2025 | **Python + TypeScript XDKs** |
| Nov 19, 2025 | News endpoints |
| Dec 23, 2025 | X API Playground |
| Jan 15, 2026 | OAuth 2.0 on Account Activity API |
| Jan 19, 2026 | `min_likes`/`min_replies`/`min_reposts` deprecated |
| **Feb 6, 2026** | **Pay-Per-Use GA**, new Console, XDK, Playground, MCP server, xAI rebate |
| **Feb 23, 2026** | **Replies restricted to summoned-only** |
| Mar 11, 2026 | Legacy DM events in X Activity API |
| Mar 13, 2026 | Event names → dot-lowercase |
| Mar 20, 2026 | Account Activity replay deprecated → `POST /2/webhooks/replay` |
| **Apr 16/20, 2026** | **Owned Reads $0.001; posts $0.015; URL posts $0.20; likes/follows/quotes removed from self-serve** |
| May 4, 2026 | New search index; `min_likes:` restored; **retweets dropped from keyword search** |
| Jun 3, 2026 | `paid_partnership` field |
| **Jun 11, 2026** | **Articles draft + publish** |
| Jul 21, 2026 | Mute/block events in X Activity API |
| Sep 15, 2026 | Lead Generation API |
| **Sep 21, 2026** | **OAuth 1.0a → OAuth 2.0 token exchange** |
| Sep 29, 2026 | `broadcast.chat.remove` event |
| Oct 1, 2026 | Reply moderation guide rewritten around **Grok** + X Activity API |
| **Oct 2, 2026** | **$20 + up to $50 free credits** |

### 5.1 Specific items

**Grok:** no inference endpoint inside the X API. Grok is xAI's separate API (`docs.x.ai`). X-side integrations: the up-to-20% xAI credit rebate, Grok in X's own reply-moderation recipe, and AI-trend surfaces.

**Communities:** lookup + search only. No create/join/leave/member management. Post into a community via `community_id` on `POST /2/tweets`.

**Articles:** `POST /2/articles/draft` (title + `content_state` in DraftJS block/entity format + optional cover media) then `POST /2/articles/{id}/publish` → `post_id`. Auth: OAuth 1.0a or OAuth 2.0 PKCE with `tweet.read`, `tweet.write`, `users.read`. Character limit not documented — **UNVERIFIED**.

**X Chat (encrypted DMs):** 36 endpoints. Genuinely new architecture — **client-side E2E encryption**: X routes ciphertext only, messages signed for sender verification, identity + signing keypairs, per-conversation keys distributed as encrypted copies. Features: group conversations, admin/join requests, invites, message TTL, screen-capture settings, pinned messages, message requests, encrypted media. Scopes: `dm.read`, `dm.write`, `users.read`, `tweet.read`, `media.write`. **Major implementation burden** — keypair management and client-side crypto. Legacy `/2/dm_events` remains available and unencrypted server-side; the pragmatic choice for a personal tool.

**New surfaces:** `/2/bots` (app-managed bot accounts, idempotent on handle, token rotation), `/2/broadcasts/*`, `/2/calls/scheduled`, `/2/news/*`, `/2/sources/*`.

**Deprecations to avoid:** v1.1 media upload (dead), Account Activity replay endpoint (Mar 25, 2026), `min_likes:` on old search index, PascalCase X Activity event names.

---

## 6. Realistic monthly cost

**Assumptions:** 500 reads/day, 50 posts/day, DM polling, 30-day month. Own data qualifies for Owned Reads ($0.001) if the account owns the developer app.

### Scenario A — personal tool, own account, app owned

| Line item | Volume/mo | Rate | Cost |
|---|---|---|---|
| Reads (own timeline, mentions, bookmarks) | 15,000 | $0.001 | **$15.00** |
| Posts (no links) | 1,500 | $0.015 | **$22.50** |
| DM events read | 1,500 | $0.010 | **$15.00** |
| DMs sent | 300 | $0.015 | **$4.50** |
| User lookups (no expansions) | 500 | $0.010 | **$5.00** |
| **Total** | | | **≈ $62/mo** |

### Scenario B — 20% of posts carry a link

| Line item | Volume | Rate | Cost |
|---|---|---|---|
| Posts, no link | 1,200 | $0.015 | $18.00 |
| **Posts with URL** | **300** | **$0.200** | **$60.00** |
| Everything else as A | | | $39.50 |
| **Total** | | | **≈ $118/mo** |

### Scenario C — reads of *other people's* posts

| Line item | Volume | Rate | Cost |
|---|---|---|---|
| Reads (public, non-owned) | 15,000 | $0.005 | **$75.00** |
| Everything else as A | | | $47.00 |
| **Total** | | | **≈ $122/mo** |
| With 20% link posts | | | **≈ $178/mo** |

### Scenario D — `expansions=author_id` on every read

Each expanded user object adds $0.010 → up to **+$150/mo**. Realistically +$30–60 if you expand only where needed. **Set a spending limit in the console before shipping.**

### Cost-control checklist

1. Set a **spending cap** in `console.x.com`.
2. Rely on **24h deduplication** — poll no more than once/day for daily data.
3. Use **Owned Reads** endpoints ($0.001 vs $0.005).
4. **Never request `expansions` you don't render.**
5. Avoid URLs in posts when unnecessary: **$0.20 vs $0.015 is 13.3×**.
6. Use **X Activity API** for DM/mention events, not polling — `dm.sent`/`dm.read` free, `dm.received` $0.010, sidesteps the 15/15min limit.
7. Track with `GET /2/usage/credits` and `/2/usage/tweets`.

**Plan for $60–180/month** for the stated workload — not the $200 Basic tier of 2024–25, and certainly not free.

---

## 7. Official SDKs, CLI, AI tooling

| Offering | Detail |
|---|---|
| **XDK TypeScript** | `@xdevplatform/xdk`, npm latest **0.6.6**, published 2025-11-03, modified 2026-07-25. Full type safety, pagination, streaming, model definitions. Covers posts, users, lists, DMs, communities, compliance, media, trends, webhooks |
| **XDK Python** | Official; same coverage. Package name **UNVERIFIED** |
| **`xurl` CLI** | `@xdevplatform/xurl`, npm latest **1.3.4** (2026-09-29). "Auth-enabled curl-like CLI." OAuth 2.0 PKCE with auto refresh, tokens in `~/.xurl`, `--headless` auth |
| **X MCP server** | `https://api.x.com/mcp` — hosted Streamable HTTP, protocol `2025-06-18`, `serverInfo: xmcp`. 200+ endpoints as tools: posts, search (incl. full-archive), users, bookmarks + folders, news, trends by WOEID, Articles draft/publish. **No streaming or webhook endpoints** |
| **MCP auth** | OAuth 2.0 via `xurl mcp` bridge (PKCE, token caching/refresh) or app-only Bearer (read-only). No dynamic client registration — you need your own app, OAuth 2.0 enabled, redirect URI registered (default `http://localhost:8080/callback`), `CLIENT_ID` + `CLIENT_SECRET`. First login needs a browser; set client startup timeout ≥300s |
| **Docs MCP** | `https://docs.x.com/mcp` — `search_x`, `get_page_x` |
| **Other** | OpenAPI at `https://api.x.com/2/openapi.json` (186 paths, v2.172); `llms.txt`/`llms-full.txt`/`AGENTS.md`/`skill.md`; Playground; Postman; `xdevplatform/samples` |

**Implication:** X already ships a first-party MCP covering the read-heavy half. Differentiated value is the **write path** (posting, threads, media, DMs) plus **profile/pin** (which requires a different mechanism entirely), and a **terminal-native CLI**, which X does not offer beyond the raw `xurl` wrapper.

---

## 8. Design recommendations

1. **Scope the promise honestly.** Ship: post/delete/thread/poll/media, DMs, bookmarks, lists, reading timelines/mentions/search, Articles. Mark likes/follows/quotes/profile/pin as **unavailable on official API** with an explanation, or gate behind Enterprise.
2. **Frame it as a user-driven client, not a bot.** Human-in-the-loop, no scheduling-by-default, no keyword triggers. This keeps you out of the automation rules' requirements entirely.
3. **Enforce the summoned-reply rule in your own code** before calling the API, with a clear error. Don't let users hit an opaque 403.
4. **Do not implement browser automation as a default path.** It's an explicit permanent-suspension offense and the obvious temptation for profile/pin.
5. **Request `media.write` from day one.** Retrofitting forces every user to re-authorize.
6. **Use OAuth 2.0 PKCE + `offline.access`**, with a 2-hour refresh loop and the strict 30-second code exchange window.
7. **Default to Owned Reads endpoints** and document $0.001 vs $0.005.
8. **Hard-code a spending-limit warning** and surface `GET /2/usage/credits` in the CLI.
9. **Use X Activity API webhooks for DMs/mentions**, not polling — 15 reads/15min makes polling useless for chat.

---

## 9. UNVERIFIED

- Runtime 403 behavior for `POST /2/users/{id}/likes` and `/following` on a live pay-per-use account.
- Whether legacy **Basic** and **Pro** plans have actually been force-retired. X's changelog says they "remain available"; third-party trackers say otherwise.
- **Account-level posting caps.** Third-party only; X's help page 404s.
- **Articles character limit.**
- **Refresh token lifetime.**
- **Expansion billing** ($0.010 per expanded user object) — reported, not directly verified.
- **"Last updated" date of the pricing page** — none published.
- Python XDK package name.
- Any 2026 **Grok inference endpoint** inside `api.x.com` — none in the OpenAPI spec.

---

## Sources

docs.x.com: /x-api/getting-started/pricing · /x-api/fundamentals/post-cap · /x-api/fundamentals/rate-limits · /x-api/getting-started/free-credits · /x-api/getting-started/about-x-api · /changelog · /developer-guidelines · /x-api/posts/create-post · /x-api/posts/manage-tweets/introduction · /x-api/posts/quote-tweets/introduction · /x-api/media/introduction · /fundamentals/authentication/oauth-2-0/authorization-code · /fundamentals/authentication/oauth-1-0a/overview · /xchat/introduction · /x-api/articles/introduction · /x-api/communities/lookup/introduction · /x-api/spaces/introduction · /tools/mcp · /tools/ai · /xdks/typescript/llms.txt

api.x.com/2/openapi.json · github.com/xdevplatform/docs · help.x.com/en/rules-and-policies/x-automation · docs.x.com/developer-terms/agreement · /policy · /restricted-use-cases

devcommunity.x.com: thread 263025 (X staff pricing announcement, Apr 17 2026) · thread 257909 (reply restriction)

Other: TechCrunch 2025-10-21 (pay-per-use beta) · Medianama 2026-02 · ClaudeKit X MCP setup · VoiceMoat X API pricing 2026 · Sorsa rate limits 2026 · NoobClaw (likes/follows removal; v2 media upload) · Emplifi (v1.1 media deprecation) · npm @xdevplatform/xdk · npm @xdevplatform/xurl · github.com/xdevplatform/samples
