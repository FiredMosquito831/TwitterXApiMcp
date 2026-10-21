# X/Twitter from Node/TypeScript — library & service landscape (verified 2026-10-21)

---

## 0. Headline findings

1. **X ships its own agent stack.** Official hosted MCP at `https://api.x.com/mcp`, official CLI `xurl` (`@xdevplatform/xurl`, v1.3.4, 2026-09-29, MIT, 1.36k★), official TS SDK `@xdevplatform/xdk` (v0.6.6, 2026-07-25, MIT, ~30k dl/wk), official local FastMCP server `xdevplatform/xmcp` (864★, Python). **Any new X MCP must position against these, not against `twitter-api-v2`.**
2. **`twitter-api-v2` is still the best official-API client for Node** (v1.29.1, 2026-08-04, 253k dl/wk, Apache-2.0, 1.56k★) — but thin-maintenance (single maintainer, ~3 releases/yr, last commit 2026-08-04) and covers **only** the official API.
3. **The internal-API (cookie/GraphQL) ecosystem in Node is thin and unstable**, with one strong primitive: `x-client-transaction-id` (MIT, 13.5k dl/wk, updated 2026-09-26) — the signer required for authenticated web-GraphQL calls. `twitter-openapi-typescript` (223★, updated 2026-10-19) gives a typed generated client over internal GraphQL.
4. **The Node "scraper" lineage is read-only and semi-stale.** `@the-convocation/twitter-scraper` (640★, MIT) is **read-only** (no post/like/retweet/send-DM — confirmed by reading `src/`), last release 2026-04-01. The npm name `twitter-scraper` is a **different, dead 2016 package**.
5. **Python is where internal-API engineering lives**: `twscrape` (2.88k★, MIT, pushed **2026-10-21**) is the best architecture to port (account pool, SQLite sessions, per-endpoint rate-limit queue, `xclid.py`). `twikit` (4.75k★, MIT) is the best **operation catalogue** (every queryId in one file, incl. DMs).
6. **Nitter is dead as a strategy.** Repo archived 2026-10-09 after X cease-and-desist (2026-08-24); xcancel 451/verification-walled; ~1 of 18 instances renders a timeline. Do not build on it.
7. **Reading via a paid gateway is the pragmatic default** — 30–100× cheaper than official per-read. `twitterapi.io` and `Xquik` claim write support; `SocialData`/`Sorsa` are read-only.

---

## 1. Master comparison table

Snapshots taken 2026-10-21. "Write" = can create posts/likes/follows/DMs.

| Name | Lang | ★ | Latest | Last release | Auth | Write | License | Verdict |
|---|---|---|---|---|---|---|---|---|
| **`twitter-api-v2`** (PLhery) | TS | 1,555 | 1.29.1 | 2026-08-04 | OAuth1.0a, OAuth2 PKCE, app-only | ✅ full | Apache-2.0 | **Adopt as official-API backend.** Best typings, v1.1 chunked media, v2 paginators, streaming w/ reconnect, DM read+write, rate-limit plugin |
| **`@xdevplatform/xdk`** | TS | 65 | 0.6.6 | 2026-07-25 | Bearer, OAuth1.0a, OAuth2 | ✅ | MIT | Adopt/benchmark. Official, generated from OpenAPI; auto-pagination + streaming; clunkier ergonomics |
| **`@xdevplatform/xurl`** | Go (npm launcher) | 1,360 | 1.3.4 | 2026-09-29 | OAuth2 PKCE + auto-refresh, OAuth1.0a, app-only | ✅ incl. **encrypted DMs** | MIT | **Critical.** Official CLI + `xurl mcp` bridge; only first-party path to XChat DMs |
| **`xdevplatform/xmcp`** | Python | 864 | — | 2026-04-09 | OAuth1/2 via env | ✅ (200+ tools) | **none declared** ⚠️ | Reference "OpenAPI→MCP". Borrow `X_API_TOOL_ALLOWLIST`; don't copy code |
| **`@the-convocation/twitter-scraper`** | TS | 640 | 0.22.3 | 2026-04-01 | cookies; password login | ❌ read-only | MIT | Borrow ideas. Has `xctxid.ts`, `xpff.ts`, `castle.ts`, `chrome-fingerprint.ts`, CycleTLS bypass |
| `n0madic/twitter-scraper` | Go | 963 | — | 2023-11-04 archived | guest token (dead) | ❌ | MIT | Historical ancestor |
| `twitter-scraper` (npm) | JS | 10 | 5.1.0 | **2016-07-19** | OAuth1 | ❌ | none | **Dead.** Name collision trap |
| `agent-twitter-client` (fork mirror) | TS | 288 | 0.0.18 | 2024-12-29 | password/cookies | ✅ | MIT | Original repo gone. Don't depend |
| **`twitter-openapi-typescript`** (fa0311) | TS | 223 | 0.1.3 | **2026-10-17** | cookies or guest | ✅ internal mutations | ⚠️ dual: custom + AGPL-3.0 | **Best Node client for internal GraphQL.** License is a real constraint (§7) |
| **`x-client-transaction-id`** (Lqm1) | TS | 74 | 0.3.2 | **2026-09-26** | n/a (signer) | n/a | MIT | **Adopt.** Node/Deno/Bun/CF Workers |
| `x-twitter-scraper` (Xquik SDK) | TS | 0 | 0.16.0 | 2026-10-15 | API key | ✅ | Apache-2.0 | Thin vendor SDK |
| `@steipete/bird` | TS/Bun | repo removed | 0.8.0 | 2026-01-19 | browser cookies | ✅ | none declared | Avoid as dependency; great feature reference (auto-refreshing queryId cache) |
| `twit` / `twitter-lite` / `twitter-api-client` | JS | — | 2018/2021/2022 | dead | OAuth1 | ✅ | MIT | Legacy. Skip |
| **`twscrape`** (vladkens) | Py | 2,885 | 0.20.1 | **2026-10-21** | account pool, cookies, SQLite sessions | ❌ read-only | MIT | **Port this architecture** |
| **`twikit`** (d60) | Py | 4,745 | 2.3.3 | 2025-02-07 PyPI | password/cookies | ✅ | MIT | **Port the operation catalogue** (`gql.py`) |
| `ntscraper` | Py | 262 | 0.4.0 | 2025-05-24 | Nitter | ❌ | MIT | **Dead** |
| `tweepy` | Py | 11,186 | 4.17.0 | 2026-07-02 | OAuth1/2 | ✅ | MIT | Endpoint-coverage reference only |
| `zedeus/nitter` | Nim | 14,468 | — | 2026-10-09 archived | pooled accounts | ❌ | AGPL-3.0 | **Dead.** Do not touch |

---

## 2. `twitter-api-v2` — deep dive

v1.29.1 published 2026-08-04; 1,555★, 211 forks, 31 open issues, Apache-2.0, 0 runtime deps, ~23 kB gzip. Snyk "Sustainable" (70/100) but "no commits over the last 6 months", 1 maintainer.

**Coverage:**
- **v1.1 media upload**: chunked INIT/APPEND/FINALIZE, long video, subtitles, auto MIME, concurrent uploads.
- **v2 media**: `client.v2.uploadMedia()` + `createMediaMetadata()` (alt text).
- **v2 endpoints**: posts, users, lists, spaces, communities, bookmarks, usage, articles, ads.
- **Streaming**: v1.1 + v2 filtered/sample with auto-reconnect; `delete_all` rules.
- **Pagination**: async iterators + `.fetchLast()`; auto rate-limit stop.
- **DMs**: `listDmEvents`, event sending, typed `readOnly`/`readWrite` clients.
- **OAuth**: OAuth1.0a, OAuth2 (code + PKCE + user context), app-only, token-refresh plugin, rate-limit store plugin, Redis cache plugin.
- **Typings**: per-endpoint response interfaces, field-union derivation, typed `ApiResponseError`.

**Known issues:** `usersByUsernames()` 500s (#630, since 2026-05-28); long-standing 503-on-success when posting media (#499); #629 closed as "not our library".

**Verdict:** use as the official-API transport, pin the version, don't assume it keeps pace.

---

## 3. Scraper ecosystem

### `@the-convocation/twitter-scraper`
640★, MIT, v0.22.3 (2026-04-01). **Read-only**: `timeline-*.ts`, `tweets.ts` (fetch/get only), `relationships.ts` (followers/following), `direct-messages.ts` (read only). POSTs confined to `auth-user.ts`.
- Auth: `scraper.login(user, pass, email)` (Cloudflare/`error 399` prone) or `scraper.setCookies(ct0, auth_token)`.
- Anti-bot machinery: `xctxid.ts`, `xpff.ts`, `castle.ts` (Castle.io fingerprint), `chrome-fingerprint.ts`, `cycletls-fetch.ts`, `rate-limit.ts`.
- README warnings: accounts "subject to being banned at any time"; endpoints "change frequently"; default rate-limit waits up to 13 minutes.
- Forks on npm all older. No `@terry-brooks/*` package exists (**UNVERIFIED**).

**Verdict:** borrow ideas. If internal-API reads are needed, port `twscrape`'s pool/queue onto `twitter-openapi-typescript` + `x-client-transaction-id`.

---

## 4. Python prior art

### `twscrape` — active, pushed 2026-10-21
- **Auth**: `auth_token`+`ct0` imported from a real browser (`add_cookie`, `unjar x.com`); optional IMAP email-OTP login; per-account proxy; SQLite sessions; account pool with rotation on rate-limit.
- **Structure**: `accounts_pool.py` (18 KB), `queue_client.py` (17 KB — per-endpoint rate-limit scheduler), `api.py` (33 KB, read-only), `xclid.py` (14 KB — transaction-ID generator that scrapes `abs.twimg.com/responsive-web/client-web/*.js` and solves cubic-curve animation params), `login.py`, `imap.py`, `http.py` (httpx; optional `curl-cffi` for TLS fingerprint).
- **Endpoints**: SearchTimeline, UserByScreenName/ByRestId, TweetDetail, TweetResultByRestId, UserTweets(+AndReplies), UserMedia, Likes, Followers/Following/BlueVerifiedFollowers, Retweeters, Favoriters, ListLatestTweetsTimeline, ListMembers, Communities*, Bookmarks, Trends, SimilarPosts, ArticleTweet.
- **No write ops** (confirmed: no `create_tweet`).
- **Verdict:** best architectural template. MIT — safe to port.

### `twikit` — 4,745★, MIT, PyPI stale (2.3.3, 2025-02-07)
- **Auth**: `client.login(auth_info_1=username, auth_info_2=email, password=...)` via v1.1 `onboarding/task.json`; cookies persisted to JSON; cookie injection supported.
- **Best asset — `twikit/client/gql.py`**: complete dated map of internal GraphQL operations. Representative entries:

```
SearchTimeline            flaR-PUMshxFWZWPNpq4zA
UserByScreenName          NimuplG1OB7Fd2btCLdBOw
TweetDetail               U0HTv-bAWTBYlwEMT7x5A
HomeTimeline              -X_hcgQzmHGl29-UXxz4sw
HomeLatestTimeline        U0cdisy7QFIoTfu3-Okw0A
CreateTweet               SiM_cAu83R0wnrpmKQQSEw
CreateNoteTweet           iCUB42lIfXf9qPKctjE5rQ
DeleteTweet               VaenaVgh5q5ih7kvyVjgtg
FavoriteTweet             lI07N6Otwv1PhnEgXILM7A
CreateRetweet             ojPdsZsimiJrUGLR1sjUtA
CreateBookmark            aoDbu3RHznuiSkQ9aNM67Q
Bookmarks                 qToeLeMs43Q8cr7tRYXmaQ
Followers                 gC_lyAxZOptAMLCJX5UhWw
Following                 2vUj-_Ek-UmBVDNtd8OnQA
useDMReactionMutationAdd  VyDyV9pC2oZEj6g52hgnhA
DMMessageDeleteMutation   BJ6DtxA2llfjnRoRjaiIiw
CreateScheduledTweet      LCVzRQGxOaGnOnYH01NQXg
TweetResultsByRestIds     PTN9HhBAlpoCTHfspDgqLA
```

Query IDs rotate; `get_query_id()` derives the ID from the URL, treating the path segment as authoritative.
- `v11.py` holds non-GraphQL surface: `upload/media/upload.json`, `dm/new2.json`, `dm/inbox_initial_state.json`, `dm/conversation/{}.json`, `notifications/all.json`, `live_pipeline/events`, friendships/blocks/mutes.
- Has full `x_client_transaction/` (cubic_curve, interpolate, rotation, transaction).

### `ntscraper` — dead (Nitter dependency). `tweepy` — healthy, official-only, endpoint-coverage checklist.

---

## 5. Node CLI tools — architecture and gaps

| Tool | Stack | Auth | Scope | Notable | Gap |
|---|---|---|---|---|---|
| **`bird`** (`@steipete/bird`) | TS/Bun | browser cookie auto-extract | read + tweet/reply/follow/bookmark + **CreateNoteTweet auto-routing** | GraphQL-first; **auto-refreshes & caches query IDs without rebuild** (`bird query-ids --fresh`); `--json`/`--plain`; library API | Repo taken down Feb 2026; no declared license |
| **`xurl`** (official) | Go | OAuth2 PKCE + refresh, OAuth1.0a, app-only | arbitrary endpoint + `media upload` + `webhook` + **`chat` (encrypted DMs)** + **`xurl mcp`** | Official; `~/.xurl/auth.yml`; `--headless`; `xurl token` | Not an MCP server; DM/chat only on macOS / linux-amd64 |
| `xc` (`@dotta/xc`) | TS | OAuth2 PKCE via `@xdevplatform/xdk` | full CRUD + bookmarks + local SQLite FTS cache | "Request cost this sync: $…" cost accounting; ships an agent skill | Tiny/user-scale |
| `slash-x` | TS | cookies (browser) | post/reply/quote/thread, **Articles (Draft.js)**, `query-ids --fresh` | X Articles publishing via `ArticleEntity` mutations; dry-run | 2★, single author |
| `x-cli` (gxbvc) | TS | OAuth1.0a | tweets/threads/media/timeline | JSON envelopes `{"ok":true,...}`, `--pretty` | 0★ |
| `x-api-cli` | JS | OAuth1.0a | post/delete | strict flags, stable exit codes | Minimal |
| `tweet-cli` | JS | OAuth1.0a | post/reply/quote/delete | explicit 402/403/429 messaging | 0★ |
| `xcli` (dremnik) | Python | OAuth2 PKCE | post/reply/quote/timeline/video+SRT | `--dry-run` | Python |
| `sferik/x-cli` | Ruby | OAuth1/2 | full tree + streaming | Mature | Not Node |
| `tato418/x-twitter-api` | TS | OAuth1.0a | 31 commands (Claude Code skill) | Broadest command list | 0★ |

**Common gap:** none does (a) official-API + internal-API fallback in one tool, (b) cost accounting against the 2026 card, (c) an MCP surface with an allowlist, (d) DM support through a compliant path. That is the opening.

---

## 6. Nitter — 2026 state

- Jan 2024: guest accounts killed. Feb 2025: Nitter returns needing real pooled accounts.
- **2026-08-24**: X Corp cease-and-desist; instances go dark, repo archived.
- 2026-09-07: project says it "will continue following legal advice"; xcancel returns.
- 2026-09-11/15: repo re-archived; xcancel suspends again.
- 2026-10-09: repo `archived: true` confirmed via GitHub API. 14,468★, AGPL-3.0.
- 2026-10-11: maintainer on HN seeking funding and legal help.
- Probes: **1 of 18** instances renders a timeline. `nitter.net` shutdown notice; `xcancel.com` 451/verification wall; others Cloudflare/Anubis 403; `nitter.poast.org` DNS removed.

**What still works without X's tolerance:** X's own **oEmbed/embed** endpoint, and the **Wayback Machine**.

**Verdict:** Nitter = zero. Durable read paths are (1) official API, (2) paid gateway, (3) own authenticated pool — last is highest ban risk.

---

## 7. Paid/third-party X API services — top 5

Prices vendor-published, read 2026-10-14→21. Treat vendor comparison tables as marketing.

| # | Provider | Auth | Read price | Write | Rate limit | Free tier | Notes |
|---|---|---|---|---|---|---|---|
| **1** | **twitterapi.io** | `X-API-Key` | **$0.15/1K tweets**; profiles from $0.01/1K; followers $0.01–0.03/1K | ⚠️ claims write via session-cookie auth — **UNVERIFIED** | up to 1,000 req/s | $1 credits | 76 endpoints; archive to 2006; webhook + WebSocket; **native MCP server** |
| **2** | **Xquik** | API key | $0.00015/tweet, profile, follower (1 credit) | ✅ **explicit**: post/reply 30 cr ($0.0045); likes/follows 10 cr ($0.0015); media 2 cr/MB; 18 write actions | not published | none; PAYG from $10 | Plans $20/$99/$199; 1-second monitors w/ signed webhooks; 23 extraction tools; SDKs in 8 languages |
| **3** | **TwexAPI** | Bearer | ~**$0.00005/read** | ⚠️ ~$0.0005/write **via your own cookie** | 0.2–30 QPS by tier | 20,000 cr (7 days) | No URL penalty; hosted MCP with 2 tools |
| **4** | **SocialData** | Bearer | **$0.0002/tweet or profile** | ❌ read-only by design | ~120 rpm observed | — | 30+ endpoints; MCP with 14 tools; failed calls free |
| **5** | **Sorsa** (ex-TweetScout) | `ApiKey` | **$0.02–0.049/1K tweets** | ❌ read-only analytics | 20 rps | 100 free | 40 endpoints; crypto-focused; in production since 2022 |
| — | TwitterAPIs.com | key | $0.0008/call | ✅ claimed | 600 rpm | 625 req | per-call billing — bad for sparse polling |
| — | GetXAPI | key | $0.025–0.05/1K | ✅ claimed | — | 100 | cheap monthly plans |
| — | apidance | key (+ `AuthToken`) | $8/10K, $40/100K, $200/1M | ⚠️ via own token | — | — | **Crypto payment only, Telegram contact** — high operational risk |
| — | RapidAPI `twitter241` | key | $0.10–1.00/1K | ❌ | — | none | Reseller |
| — | Apify `@apidojo/x-scraper` | Apify token | actor-run | ❌ | — | — | wraps "Twitter Scraper Lite" |

**Official X reference point (docs.x.com, 2026-10-21):** post read $0.005; user/DM-event/follower read $0.010; like/mute/block read $0.001; owned read $0.001; create post $0.015; **create post with URL $0.200**; DM interaction $0.015; webhook events $0.005–0.010. Dedup within 24h UTC window. Cap: 3M post reads per monthly cycle (secondary source says 2M — conflict).

**Practical read:** 1,000 profile+20-post pulls ≈ **$0.0032 on twitterapi.io vs ~$0.11 official**. For read-first MCP, a gateway is the correct default; official API is the correct path for writes.

---

## 8. Browser automation maturity

Searches found **no Node project above ~3 stars** in X automation:

- `EngineeredReiwa/pupplet` — "X DOM automation via CDP. No API key. No Puppeteer." (0★)
- `alpersamur3/x-twitter-bot` (1★), `ElliyahuRosha/twitter-x-list-monitor` (0★), `haha1339507/twitter-scraper` (0★), `bracta/xlist-scraper` (0★), `vipulkumarsviit/twitter-scraper-apify-mongodb-playwright` (0★)

**Assessment:** immature, all single-author experiments. Structural reason: logged-out X shows ~5–10 posts then stops, search redirects to login, Cloudflare/Castle/Anubis gate the rest — which is why serious projects chose HTTP + cookie + transaction-ID signing. One interesting browser idea: `fa0311/twitter_api_safe_relay` — an HTTP relay at `localhost:3000/i/api` running requests through a logged-in browser session, so the client just points `basePath` at it.

---

## 9. Licensing — what we can reuse

| License | Projects | Implication |
|---|---|---|
| **MIT** | `@xdevplatform/xdk`, `@xdevplatform/xurl`, `@the-convocation/twitter-scraper`, `x-client-transaction-id`, `twscrape`, `twikit`, `tweepy`, `ntscraper`, `twit`, `twitter-lite`, `agent-twitter-client`, `slash-x`, `x-cli`, `tweet-cli` | **Safe to copy/port with attribution.** Porting `twscrape`'s pool/queue and `twikit`'s endpoint map is clean |
| **Apache-2.0** | `twitter-api-v2`, `x-twitter-scraper` (Xquik), `twitter-api-sdk` | Safe; include NOTICE, state changes, no trademark use |
| **AGPL-3.0 / dual** | **`twitter-openapi-typescript`** — custom MIT-like license with an anti-spam clause **or** AGPL-3.0 | ⚠️ **Constraint.** AGPL is a non-starter for closed-source/hosted. Custom option is conditionally restricted (not OSI-open). Depend as a library in a separate process; read the clause with counsel |
| **AGPL-3.0** | `zedeus/nitter` | Dead + copyleft + active legal action. **Do not touch** |
| **None declared** | `xdevplatform/xmcp`, `@steipete/bird`, `twitter-scraper` (2016) | **All rights reserved.** Ideas only, no code |
| NOASSERTION | `fa0311/twitter-openapi` | See above |

---

## 10. Recommendation for this project

**Three-tier transport behind one MCP tool surface:**

1. **Writes + private reads → official API.** `twitter-api-v2` today for typing maturity and OAuth2 DM support; `@xdevplatform/xdk` as the safer long-term bet. Cover post create/delete, media (v1.1 chunked + v2 metadata/alt), like/repost/bookmark/follow, DM read/send, filtered stream, bookmarks, lists, Articles. Add **cost accounting** against the 2026 card — no existing CLI has it.
2. **Bulk public reads → paid gateway behind a provider interface.** Default `twitterapi.io` (cheapest, 76 endpoints, MCP-native, full archive); fallback `SocialData` (read-only, clean ToS) or `Xquik` (gateway writes + monitors). Normalize to a common `Tweet`/`User` shape. Never let a gateway silently bill — surface per-call cost, mirroring `xc`'s "Request cost this sync: $…".
3. **Optional high-fidelity internal reads → own cookie session.** cookies → `x-client-transaction-id` (MIT) → `twitter-openapi-typescript` for typed calls, using `twikit`'s queryId map and `twscrape`'s account-pool/queue design (both MIT). **Off by default**, explicit ban-risk warning.

**Do not build on:** Nitter, `ntscraper`, `bird` (repo gone), the 2016 `twitter-scraper` npm name, or any Playwright driver as the primary path.

**Competitive fact:** X's hosted MCP already covers search, users, timelines, mentions, bookmarks+folder management, trends, news, and Article drafting/publishing with a user's own OAuth. It explicitly **does not do general Write-API posting**. Our wedge: **writes + DMs + multi-provider read arbitrage + cost transparency**, not "X data for LLMs".

---

## Sources

**Primary (GitHub/npm/PyPI APIs, 2026-10-21):** PLhery/node-twitter-api-v2 · the-convocation/twitter-scraper · n0madic/twitter-scraper · vladkens/twscrape · d60/twikit · bocchilorenzo/ntscraper · tweepy/tweepy · Lqm1/x-client-transaction-id · fa0311/twitter-openapi-typescript · zedeus/nitter · xdevplatform/xurl · xdevplatform/xdk-typescript · xdevplatform/xmcp · Xquik-dev/x-twitter-scraper-typescript · registry.npmjs.org, api.npmjs.org/downloads, pypi.org

**Official X docs:** docs.x.com/x-api/getting-started/pricing · docs.x.com/tools/mcp · docs.x.com/tools/ai · docs.x.com/x-api/fundamentals/rate-limits

**Providers:** twitterapi.io/pricing · twitterapi.io/blog/x-api-cost-breakdown-2026 · twitterapi.io/blog/twitterapi-vs-official-x-api · xquik.com/en/pricing · docs.xquik.com/guides/billing · twexapi.io/pricing.md · socialdata.tools · api.sorsa.io/pricing · tweetscout.io · doc.apidance.pro · xtwitterapiprices.com

**Nitter:** TechCrunch 2026-09-15 · The Register 2026-09-07 · TNW 2026-09-08 · HN 2026-10-11 · instance probes

**CLIs:** sferik/x-cli · cryppadotta/xc · edihasaj/slash-x · gxbvc/x-cli · eliaseffects/x-api-cli · 0xmythril/tweet-cli · dremnik/x-cli · tato418/x-twitter-api · npm @steipete/bird · bird.fast · zaydiscold/bird · Oceanswave/bird

**Maintenance signals:** security.snyk.io/package/npm/twitter-api-v2 · PLhery issues #629, #630, #499 · TechCrunch 2026-06-30 (X MCP launch)

### UNVERIFIED / low-confidence
- twitterapi.io write support via session cookies — vendor blog only, no published write price.
- X official 3M vs 2M post-read monthly cap.
- `@terry-brooks/twitter-scraper` — no such package found.
- `bird`'s license — tarball has no LICENSE; mirrors are third-party MIT-labelled.
- Star/download figures are point-in-time; the browser-automation section is "no project found above ~3★", not proof of absence.
