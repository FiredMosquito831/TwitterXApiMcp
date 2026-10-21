# X/Twitter MCP Servers — Prior-Art Survey (2026-10-21)

Scope: every notable X/Twitter MCP server, the `agent-twitter-client` lineage, tool-schema conventions, reported pain points, browser-automation options, and the gaps a new comprehensive X MCP can own. Star/tool counts are as reported on the dates shown; several are self-reported in READMEs, not audited. Anything unconfirmed from a primary source is marked **[UNVERIFIED]**.

---

## 0. TL;DR

Three generations of X MCP servers, and the market is unusually fragmented:

1. **2024–mid-2025: thin official-API wrappers.** 2–15 tools, OAuth 1.0a keys in env, post + search. Mostly abandoned.
2. **Late-2024–mid-2025: the `agent-twitter-client` / `twikit` no-API-key generation.** Username+password or cookie login against X's private GraphQL. That era ended: `agent-twitter-client` is **deprecated on npm, GitHub repo 404, elizaOS moved to the official API**; `twikit` is repeatedly broken by X's HTML/Cloudflare changes and patched/forked by nearly every downstream project.
3. **2026: two divergent tracks.**
   - **Official:** X shipped a **hosted Streamable-HTTP MCP at `https://api.x.com/mcp`** (announced 2026-06-30), reachable via the `xurl mcp` OAuth bridge, plus self-hosted `xdevplatform/xmcp` (OpenAPI→tools, ~175 endpoints). Hosted server is **read-mostly**: documented writes are bookmarks and Articles only — **no posting, no media upload, no DMs**.
   - **Session/browser:** a Cambrian explosion of cookie- and Playwright/Selenium-based servers (60–154 tools), because the official API is metered ($0.005/read, $0.015/post) and self-serve tiers lost likes/follows/quote-posts in April 2026.

Registry sprawl: Glama lists 108,052 MCP servers, 236 under "Social Media", 20+ matching "twitter" on page one. There is **no** Twitter/X server in the official `modelcontextprotocol/servers` repo.

---

## 1. Official X / first-party MCPs

| Thing | What it is | Auth | Notes |
|---|---|---|---|
| **Hosted X MCP** `https://api.x.com/mcp` | X-operated Streamable HTTP MCP, protocol `2025-06-18`, `serverInfo: xmcp` | (a) app-only Bearer → **read-only**; (b) **OAuth 2.0 PKCE** via `xurl mcp` → user context + writes | Writes limited to **bookmarks + `article_publish`**; **no DMs, no media upload, no streaming/webhooks**. Billed at X API rates. |
| **`xurl`** (`xdevplatform/xurl`, npm `@xdevplatform/xurl`) | Local stdio↔HTTP bridge | OAuth2 PKCE, browser once, tokens cached in `~/.xurl`, auto-refresh incl. after 401 | 1,358★, last commit 2026-09-29. Redirect URI must be exactly `http://localhost:8080/callback`. Docs warn: *"Never read or send this file to LLM context."* Clients need ≥300 s startup timeout. |
| **`xdevplatform/xmcp`** | Self-hosted Python **FastMCP** server generated from X's OpenAPI spec | OAuth 1.0a browser consent at startup + Bearer token env | ~175 endpoints as tools; `X_API_TOOL_ALLOWLIST`; 862★, last commit **2026-04-09**. **OAuth1 tokens memory-only → re-auth every restart.** Raw REST-shaped names (`createPosts`, `finalizeMediaUpload`). |
| **Docs MCP** `https://docs.x.com/mcp` | Documentation search | — | `search_x`, `get_page_x`. |

**Pricing reality (official routes):** ~$0.005 per post read, ~$0.015 per post created, **$0.20 for a post containing a link**; tiers Free / Basic $200/mo / Pro $5,000/mo plus pay-per-use credits. Since **April 2026** follows, likes and quote-posts are unavailable on self-serve tiers; since **February 2026** programmatic replies only work when the author mentioned or quoted your account.

**Name collision:** "xmcp" = both X's hosted server (`serverInfo`) and `xdevplatform/xmcp`. Disambiguate in docs.

---

## 2. `agent-twitter-client` (elizaOS) — key prior art, now dead

**Status:**
- **npm:** `agent-twitter-client`, MIT, last version **0.0.18 published 2024-12-29**, deprecation notice "Package no longer supported."
- **GitHub:** `elizaOS/agent-twitter-client` returns **HTTP 404**. ~1.6k★, ~406 forks at removal.
- **Why:** elizaOS issue reply: *"It got taken down due to X's cease and desist request. X wants you to pay 5k per month."* — **UNVERIFIED**, consistent with 404 + deprecation.
- **Successor:** `@elizaos/plugin-twitter` now uses **OAuth 1.0a keys** (`TWITTER_API_KEY` etc.). The framework abandoned credential login.

**Architecture (from README + deps):**
- TypeScript; modified fork of `@the-convocation/twitter-scraper`; runs in browser or Node.
- Depends on `twitter-api-v2` (polls), `tough-cookie`/`set-cookie-parser`, `otpauth` (TOTP), `undici`/`node-fetch` + `headers-polyfill`, `@roamhq/wrtc` + `ws` (Spaces), `json-stable-stringify` (transaction-id signing) — a blueprint for what spoofing X requires.
- **Auth:** `new Scraper()` → `login(...)`; **cookie-first**: `getCookies()` returns JSON array, `setCookies(json)` restores; `PROXY_URL` supported. elizaOS PR #1288 removed `TWITTER_COOKIES` env; users then reported `DenyLoginSubtask`, `ArkoseLogin`, error 336, cookie-load failures.
- **Features:** post, retweet, like, get tweets/replies, search, profile, follow relationships, polls (v2), Spaces. DM in some forks **[UNVERIFIED]**.
- **Failure modes:** Arkose on login; repeated logins triggering security alerts (eliza #1969: *login on every post* → alerts); cookie expiry; silent death when X changes endpoints.

**Takeaway:** do not resurrect credential login. Durable lessons: cookie-jar + proxy + signed-header architecture — and even that is ToS-hostile and fragile.

---

## 3. Community servers (comparison)

### 3a. Official-API servers

| Server | Lang | Tools | Auth | ★ | Last commit | License | Notable limits |
|---|---|---|---|---|---|---|---|
| EnesCinr/twitter-mcp | TS | **2** | OAuth 1.0a | ~405 | 2025-07-17 | MIT | Canonical hello-world; stale; no media/threads |
| GenAIwithMS/twitter-mcp | TS | ~13 | OAuth 1.0a | 25 | 2026 | MIT | Thread splitting, quote, bookmarks, media |
| MindMadeLab/x-mcp | Python | **21** | Bearer read + OAuth1 write | 0 | 2026-03-27 | MIT | Best flat surface: `x_get_me`, `x_post_thread`, polls, v1.1 media, `auth` doctor. **v1.6.0 removed DMs/liked-tweets** |
| Infatoshi/x-mcp | TS | ~15 | OAuth 1.0a | 49 | 2026 | — | URL-or-ID inputs; `get_metrics`; documents tier gaps |
| realman90/x-mcp | JS | **44** | Bearer + OAuth1 | 4 | 2026 | MIT | Broadest official surface; tool-explosion risk |
| vibeforge1111/xmcp | Py/TS | **70+** | OAuth1 + Bearer | 19 | 2026 | MIT | **Permission profiles** (researcher 23 / creator 41 / manager 55 / automation 70), runtime-switchable |
| fatwang2/x-api-mcp | TS | **26** | **OAuth 2.0 PKCE**, multi-account, tokens `~/.x-api-mcp/tokens.json` 0600, refresh rotation with file lock | — | 2026 | MIT | Most carefully engineered: **grouped action tools** (`post_action`, `user_action`, `list_action`), chunked media, alt text, `X_TOOLS=read\|write`, `X_REQUIRE_ACCOUNT=1` |
| achetronic/twitter-mcp | **Go** | ~25 | OAuth1 + Bearer | 3 | 2026 | Apache-2.0 | **Persistent scheduling** to `schedule.yaml`; heat-score analysis; HTTP transport with JWT/JWKS |
| isteamhq/twitter-mcp | TS | 15 | OAuth 1.0a | 1 | 2026-04 | MIT | `update_profile`; excellent README on rate limits + **non-idempotent posting** |
| Dishant27/twitter-mcp | TS | 11 | OAuth 1.0a | 3 | 2025-04 | MIT | Profile update, followers, lists |
| rafaljanicki/x-twitter-mcp-server | — | — | Official v2 | 35 | 2026-05-24 | — | Advertises now-restricted favorites/follower mgmt |
| crazyrabbitLTC/mcp-twitter-server | TS | **53** | OAuth1 + SocialData | — | 2025 | MIT | Requires Basic tier; 5 prompts + 6 resources |
| piyushgithub15/twitter-mcp | TS | 14 | **per-request token header** | 0 | 2026-08 | — | Cleanest stateless Streamable HTTP + per-request token |
| @m8lab/mcp-x-twitter | TS | 8 | OAuth 1.0a | — | 2026-03 | MIT | Tags each tool with required tier |

### 3b. Cookie / credential / reverse-engineered servers

| Server | Lang | Tools | Auth | ★ | Last commit | License | Notes |
|---|---|---|---|---|---|---|---|
| 6551Team/opentwitter-mcp | Python | 12 | Vendor token | 1,227–1,445 | 2026-09-22 | MIT | Read-only; strongest read analytics (follower events, deleted tweets, KOL followers) |
| ihuzaifashoukat/x-use | Python/Selenium | **82** | Browser cookies, multi-account, proxies | 176 | 2026-10-13 | MIT | Best safety model: **draft-by-default**, `prepare_thread`→`approve_draft`, queues, per-account budgets, `get_account_health` |
| nirholas/XActions | JS | **154** | Cookies (`auth_token`+`ct0`), multi-account | ~600 | 2026-10 | Apache-2.0 | 17 tool groups, polls, scheduling, DMs, Spaces, Grok, workflow, cross-posting. Approval **opt-in** (`XACTIONS_MCP_REQUIRE_APPROVAL=1`) |
| tangivis/twikit-mcp | Python | ~20 | `cookies.json` | 13 | 2026 | MIT | PyPI `twikit-mcp`; inherits twikit breakage |
| arvinmoj/twitghost-mcp | Python | ~10 | Cookies or password | 0 | 2026-06 | MIT | Fork of mcp-twikit on patched twikit; DM send/delete; "cookies expire ~30 days" |
| adhikasp/mcp-twikit | Python | ~8 | password | 235 | 2025-03-14 | — | Abandoned |
| bintangtimurlangit/twikit-x-mcp | Python | **27** | Cookies | 2 | 2026-07 | Other | Cleanest **tool annotations** table; built-in rate limiter; cursor envelope |
| shubhank-saxena/twitter-account-mcp | Python | 19 | Cookie-Editor JSON | 3 | 2026-03 | MIT | Returns inline images/video keyframes via ffmpeg |
| 0xhijo/mcp_twitter | TS | 11 | credentials/API | 11 | 2025-03 | MIT | Dead dependency |
| taazkareem/twitter-mcp-server | TS | 12 | credentials | 20 | 2025-02 | — | Dead dependency; README is a copy-paste template |
| mzkrasner/twitter-client-mcp | TS | 12 | credentials, sodium-native | 6 | 2025-04 | — | Only interesting for credential hygiene (zeroing env, no secret logging) |
| LuniaKunal/mcp-twitter | Python | claimed 60 | twikit cookies | 60 | 2025-04 | — | Inconsistent tool counts |

### 3c. Browser-automation servers

| Server | Tools | Auth | ★ | Notes |
|---|---|---|---|---|
| Miles0sage/twitter-mcp | 11 | Persistent Chrome profile `~/.twitter-mcp/chrome-profile/` | 4 | Xvfb guidance ("Twitter blocks headless"), cron keepalive every 30 min |
| trendfluence-org/x-mcp-bridge | ~21 | Managed Chromium, login once | 0 | Hybrid **GraphQL writes, DOM reads**; `--login/--logout/--status`; `DM_PIN` |
| Barresider/x-mcp | 20–25 | password + `PROXY_URL` | 10 | Threads, media, scraping, Docker, stdio+SSE |
| MikeSquared-Agency/Xbot | varies | Session file | 4 | Playwright + **procedure memory**, fingerprint masking, Bézier mouse, selector resilience |
| microsoft/playwright-mcp | **70+** | `--storage-state` / persistent profile | **38,418** | Generic; a11y snapshots; `browser_run_code_unsafe` is **RCE-equivalent**; Playwright docs now prefer CLI+skills over MCP for token efficiency |

---

## 4. Commercial / hosted X MCPs

| Vendor | Endpoint | Tools | Auth | Cost | Notes |
|---|---|---|---|---|---|
| **Composio** | `https://connect.composio.dev/mcp` | **81** | OAuth2; **customer-owned X app required since Feb 2026** | plan | JIT tool loading, large-response offloading. Broadest write surface: group DMs, cards, polls, compliance jobs, media append |
| **Arcade** | `https://api.arcade.dev/mcp/<gateway>` | **38** | Per-user OAuth; policy-gated approvals | free tier | Best **tool naming**: PascalCase `X.PostTweet`, `X.GetConversation`; **Spaces** tools nobody else has |
| **Pipedream** | remote MCP + `x-pd-app-slug` | per-app | managed OAuth | free for own use | Exposes **Xquik** (8 actions), not first-party X OAuth |
| **Zapier** | per-user URL | subset | managed | 2 tasks/call | Exposes app actions (Tweet Hunter); first-party X app **[UNVERIFIED]** |
| **OpenTweet** | `mcp.opentweet.io/mcp` | 36–43 | vendored OAuth, `ot_` key | $19.99–$49/mo | Posting/threads/scheduling/analytics; cannot read arbitrary timelines |
| **Reduck** | browser-extension MCP | 11 | **your logged-in Chrome** | free | `post_tweet`, `post_thread`, `reply_to_tweet`, `schedule_tweet`, `get_messages`, `get_mentions`, `get_personal_feed` |
| **TwitterAPIs.com** | `npx @twitterapis/mcp` | **112** (68R/44W) | vendor bearer | $0.0008/read, $0.0016/post | Every read accepts `fields` (dotted projection) + `compact=1` — best anti-bloat idea in the field |
| **6551.io, Xquik, GetXAPI, SocialData** | various | 8–40+ | vendor tokens | per-call | Data vendors wrapping unofficial scrapers |
| @granitebps/twitter-mcp | npm | small | Rettiwt or official | vendor | Node 22.21 pin → EBADENGINE on Node 24 |

**Non-existent names:** `@kazuph/mcp-twitter` — no such npm package (kazuph has 23 packages, none Twitter). `xapi-mcp` resolves to `x-api-mcp`. `grok-mcp` is a family of Grok/xAI servers using xAI Live Search — read-only, synthesized, priced per xAI token.

---

## 5. Tool schema conventions (what good looks like)

### Naming
| Pattern | Example | Where |
|---|---|---|
| `snake_case` verb_noun (~70%) | `post_tweet`, `like_tweet`, `unlike_tweet` | EnesCinr, isteam, GenAIwithMS |
| Namespaced snake | `x_get_me`, `x_post_thread` | MindMadeLab, TwitterAPIs |
| **PascalCase `Service.Verb`** | `X.PostTweet`, `X.LookupTweetEngagers` | Arcade |
| REST-mirroring (auto-gen) | `createPosts`, `finalizeMediaUpload` | xdevplatform/xmcp |
| **Grouped action tools** | `post_action`, `user_action`, `list_action` | x-api-mcp (26 ops → 4 verbs) |

**Recommendation:** one namespace + verb_noun, *plus* grouped "action" tools for the long tail. Only pattern found that scales past ~25 tools without blowing context.

### Parameter shapes worth copying
- **Identifier flexibility:** `tweet_id` **or** URL, `username` **or** `user_id`; strip `@`.
- **Pagination:** `max_results` (document 5–100 / 1–1000 bounds) + `pagination_token` or `cursor`/`next_cursor`, with `{ items, count, next_cursor }`. Do not silently truncate.
- **Time windows:** ISO-8601 `since_time`/`until_time`, not relative strings.
- **Result projection:** `fields: "id,text,author.username"` + `compact: "1"` — best anti-bloat idea in the field.
- **Enum'd sort:** `Top | Latest | Media | Photos | Videos`.
- **Media:** three patterns — (1) base64 inline (worst), (2) `upload_media(...) -> {media_id}` then `post_tweet({media_ids})`, (3) chunked `append`→`finalize`→`get_media_status` with `alt_text` and "1 video/GIF or up to 4 images".
- **Auth state:** env, cookie JSON path, profile dir, or token file — almost never a tool arg. Two exceptions worth copying:
  - `account: "work"` + `X_REQUIRE_ACCOUNT=1` for multi-account;
  - account-management *tools* (`add_account`, `auth_status`, `complete_authorization`, `set_default_account`) so the agent can drive OAuth conversationally, incl. paste-the-callback-URL for headless hosts.
- **Annotations:** `readOnlyHint`, `idempotentHint`, `destructiveHint`; publish the mapping table in the README (clients show it in approval UIs).
- **Output:** `{ content: [{type:"text", text: JSON.stringify(payload)}] }` is the de-facto standard; also return `structuredContent`. Keep payload keys stable (`id`, `url`, `author`, `created_at`, `text`, `metrics`).
- **Safety tools:** `prepare_thread` → `get_draft` → `approve_draft` (x-use) is the best HITL schema; `X_TOOLS=read|write` + allowlist is the best capability scoping.
- **Errors:** surface `429` + `x-rate-limit-reset` and `client-not-enrolled` with remediation. **Dedupe client-side** — X does not.

---

## 6. Pain points actually reported

**Cost / runaway agents**
- *"After ~10 minutes and ~1000 tweets from one user, $5 was gone."* At $0.005/read this is the #1 onboarding surprise.
- Posting costs $0.015, and **$0.20 with a link** — 13× a plain post; almost no tool description warns about this.

**Rate limits**
- Per-endpoint 15-min windows: `POST /2/tweets` 300, `search/recent` 450, likes 300, retweets 300, follows 300, mentions 450.
- Hosted MCP: writes are stricter than reads; bursty agents get 429s on `article_publish`/bookmarks.
- Cookie servers add their own throttling because private endpoints punish bursts hard.

**Non-idempotency**
- X does not dedupe tweet text; any retry-on-timeout creates duplicates. Only `isteam` calls this out; **no server implements idempotency keys.**

**Cookie / login expiry**
- `auth_token` commonly revoked ~30 days; **`ct0` rotates every few hours**; `auth_token` alone is insufficient for writes — you need `ct0` as `x-csrf-token` or session-tier endpoints 404.
- Reports: "a month, then two weeks, and now just a day", then `{"code":32,"message":"Could not authenticate you"}`.
- `KEY_BYTE indices` breakage from an x.com homepage change on **2026-03-18** broke twikit login globally; downstream projects bundle patched copies.

**Cloudflare / bot detection**
- X moved to **Cloudflare bot detection around Oct 2025**: default `Curl/*` UA blocked, `X-Client-Transaction-Id` required on some endpoints, `castle_token` in login/registration flows, TLS/JA3 fingerprinting.
- Logged-out requests to session-tier GraphQL return a bare **404** rather than 401, reading like "endpoint removed".
- X's identity endpoints 404 on ~25% of calls even with healthy cookies.

**Account bans**
- *"The second I tried an at mention, it suspended the accounts."* Consensus: **reading is low-risk on either route; writing (esp. replies/@mentions) is where suspensions happen.**
- x-use best practices: captcha → action blocks → shadow restriction → suspension; one account per stable residential IP; 90–240 s delays even in "aggressive" preset.
- X's ToS prohibits access "other than through our currently available, published interfaces."

**Tool explosion / context bloat**
- Servers ship 44, 53, 70+, 81, 112, 154 tools. At ~150–400 tokens of schema each, 154 tools ≈ 30–60k tokens before the first user message.
- Industry answers: **profiles** (23/41/55/70), **grouped actions**, **gateway selection**, **JIT tool search** (Composio), **result projection** (TwitterAPIs).

**Transport / packaging friction**
- OAuth bridges block the handshake on first run → clients time out below 300 s. Redirect-URI typos are the top install failure.
- Tokens in memory only (xmcp) → re-auth on every restart.
- Several servers pollute **stdout** with logs and corrupt JSON-RPC — keep logs on stderr.

---

## 7. Browser automation of X

- **`microsoft/playwright-mcp`** (38.4k★) can be pointed at x.com today: `browser_navigate`, a11y `browser_snapshot` with `ref`s, `browser_type`, `browser_click`, `browser_file_upload`, `browser_tabs`, `--storage-state`. Caveats: `browser_run_code_unsafe` is RCE-equivalent; snapshot token cost is high; Playwright now recommends **CLI + skills** over MCP for token efficiency.
- **X-specific browser servers** show the production pattern: persistent profile, headed or Xvfb, DOM/a11y parsing for reads + **GraphQL calls for writes**, keepalive cron, `--login/--status/--logout` lifecycle, screenshots on failure.
- **Hybrid routing** is emerging as best practice: `armatrix/twitter-mcp` routes reads to twitterapi.io ($0.15/1K), writes to official OAuth 1.0a, and **falls back to cookies only when OAuth returns 403 on replies**. "Cheap reads, compliant writes, cookie fallback" is the most pragmatic architecture found.

---

## 8. Gaps we can fill

**A. Nobody unifies the official API surface.** Hosted X MCP = reads + bookmarks + Articles, no posting/media/DMs. Community = posting but partial reads, or reads but no writes. No single server does **read + post + media + thread + poll + DM + list + analytics** with one auth story.

**B. Media is the weakest area.** Almost nobody does the full pipeline: multi-image, 1 video/GIF, **chunked upload with processing wait**, **alt text**, size limits, `upload_media` + `get_media_status` + attach-by-`media_id`.

**C. Threads are treated as a loop, not a transaction.** Nobody offers draft/preview → atomic-ish post with rollback (`delete_post` on failure), per-post character accounting (URLs = 23 chars, Premium 25k), auto-splitting, or "append to existing thread". `x-use`'s staged lifecycle is closest, and it's browser-based.

**D. Polls, quote-posts, scheduling are orphan features.** Polls in ~4 servers; quote-posts are restricted on self-serve tiers and many servers still advertise them (compliance trap). **Scheduling exists in only 3** and never in an official-API server with a durable store.

**E. Analytics is basically absent.** Only `Infatoshi` has `get_metrics`, only for own posts. Nobody offers impressions/engagement time series, follower growth, best-time-to-post, per-tweet benchmark vs median.

**F. DMs are the biggest hole.** Hosted MCP has none; official-API servers mostly removed them (need OAuth 2 user context); only `x-api-mcp` (opt-in `X_ENABLE_DM=1`), TwitGhost, Reduck, Composio do them. Nobody does group DMs, attachments, read receipts, or E2E caveats well.

**G. Multi-account is rare and clumsy.** Only `x-api-mcp`, `x-use`, XActions. Nobody does per-account rate budgets, per-account proxies, or "act as account X" with an auditable trail in an official-API server.

**H. Token economics.** Only TwitterAPIs does field projection; only Composio/Arcade do JIT/gateway scoping; only vibeforge does profiles. Nobody combines ~15 intent tools + progressive disclosure + projection + caching + configurable page sizes.

**I. Profile editing.** Two servers update name/bio/location/url (`isteam`, `Dishant27`). Nobody does avatar/banner upload, pinned tweet, or username change.

**J. Safety and governance are opt-in or absent.** Only `x-use` and `x-api-mcp` have real guardrails. **No server** has: spend meter in dollars before a call, dry-run previews, prompt-injection defense for untrusted tweet content, audit logs, "confirm if cost > $X".

**K. Idempotency and reliability.** Zero servers implement idempotency keys or dedupe. Combined with 429 backoff, table stakes.

**L. Enterprise/edge surface.** Streaming/filtered stream and webhooks excluded everywhere. Compliance jobs, activity subscriptions, Community Notes (write), Spaces, bookmark folders, Articles exist only as raw endpoints or vendor tools. **No open-source server can publish Articles.**

**M. Auth UX.** Nobody solved OAuth for MCP cleanly: hosted MCP has no DCR and needs a local bridge; xmcp re-auths each restart; community servers punt to env vars. `add_account`/`auth_status`/`complete_authorization` + OS-keychain + refresh rotation + headless paste-callback would be best-in-class.

**N. Cross-platform friction.** Several popular stacks are macOS/Linux-flavored (mcp-fetch needs macOS Accessibility; twikit/Playwright assume Xvfb). A Windows-clean, no-native-deps server is a real gap.

---

## 9. Implications for a comprehensive X MCP

1. **Build on official API v2 with OAuth 2.0 PKCE user tokens** (refresh + rotation + keychain). Add OAuth 1.0a only where v2 can't (legacy media upload).
2. **Steal four designs:** `x-api-mcp`'s grouped action tools + account management; `x-use`'s draft/approve lifecycle; TwitterAPIs' `fields`/`compact`; `twikit-x-mcp`'s annotation table.
3. **Ship ~15–20 intent tools, not 80**, each with an `action` enum for the long tail, plus a read-only profile and an `X_TOOLS` filter.
4. **Explicitly cover gaps:** media pipeline with alt text, thread-as-transaction with rollback, polls, scheduling with durable queue, DM opt-in with scopes, multi-account, own-post analytics, cost meter + dry-run, idempotency keys.
5. **Treat cookie/browser mode as a clearly labeled, opt-in "unofficial" transport**, never the default, with ToS/ban warnings — evidence says session-cookie writes are what get accounts suspended.

---

## Sources

Official: docs.x.com/tools/mcp · github.com/xdevplatform/xmcp · github.com/xdevplatform/xurl · github.com/xdevplatform/docs (tools/mcp.mdx) · TechCrunch 2026-06-30 · modelcontextprotocol/servers

Comparisons: xautodm.com/blog/twitter-mcp-server-connect-claude-chatgpt-agents-to-x (2026-10-13) · mcp.directory/blog/x-twitter-mcp-server · opentweet.io/blog/twitter-mcp-servers-compared-2026 · opentweet.io/alternatives/agent-twitter-client · glama.ai/mcp/servers?query=twitter

Servers: EnesCinr/twitter-mcp · GenAIwithMS/twitter-mcp · MindMadeLab/x-mcp · pypi x-mcp-server · Infatoshi/x-mcp · realman90/x-mcp · vibeforge1111/xmcp · glama.ai/mcp/servers/fatwang2/x-api-mcp · achetronic/twitter-mcp · isteamhq/twitter-mcp · Dishant27/twitter-mcp · crazyrabbitLTC/mcp-twitter-server · piyushgithub15/twitter-mcp · npm @m8lab/mcp-x-twitter · 6551Team/opentwitter-mcp · ihuzaifashoukat/x-use (+ docs/BEST_PRACTICES.md) · nirholas/XActions (+ xactions.app troubleshooting) · tangivis/twitter-mcp · arvinmoj/twitghost-mcp · adhikasp/mcp-twikit · bintangtimurlangit/twikit-x-mcp · shubhank-saxena/twitter-account-mcp · 0xhijo/mcp_twitter · taazkareem/twitter-mcp-server · mzkrasner/twitter-client-mcp · armatrix/twitter-mcp · Barresider/x-mcp · Miles0sage/twitter-mcp · trendfluence-org/x-mcp-bridge · MikeSquared-Agency/xbot

agent-twitter-client: npmjs.com/package/agent-twitter-client · elizaOS/eliza#5074 (C&D claim) · #1969 (repeated logins) · #1288 · npm @elizaos/plugin-twitter

Commercial: composio.dev/toolkits/twitter · docs.composio.dev/kb/guide/toolkits-twitter · arcade.dev/tools/x · mcp.pipedream.com/app/xquik · zapier.com/mcp/tweet-hunter · reduck.ai/use-cases/x-mcp · twitterapis.com/mcp · npm @granitebps/twitter-mcp

Browser: github.com/microsoft/playwright-mcp · playwright.dev/mcp/introduction · playwright.dev/docs/getting-started-mcp

Failure modes: d60/twikit#288 · cmj/twitter-tools#3 · elizaOS/eliza#1288 · elizaOS/eliza#856
