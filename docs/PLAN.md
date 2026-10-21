# X Control Plane — research synthesis and plan

**Date:** 2026-10-21 · **Target:** a Node.js CLI + programmatic SDK + MCP server that controls a user's own X account.

Six parallel research tracks (official API, libraries/CLIs, existing MCPs, private endpoints, browser automation, architecture) are captured verbatim in `docs/research/`. This document is the synthesis and the decision record.

---

## 1. The verdict in one table

| Transport | Compliance | Coverage | Reliability | Cost |
|---|---|---|---|---|
| **A. Official X API v2** (OAuth 2.0 PKCE) | ✅ Sanctioned | Posts, threads, polls, media, DMs, bookmarks, lists, reads, Articles, analytics. **No likes, follows, quotes, profile edit, pin** | High | $0.001–$0.20 per action |
| **B. Paid read gateway** (twitterapi.io / SocialData) | ⚠️ Vendor-dependent | Read-only, cheap, full archive | High | ~$0.00015–0.0002/read |
| **C. Private web API** (cookies + GraphQL) | ❌ ToS breach — "non-API automation… may result in permanent suspension" | Everything the web client can do, including likes, follows, profile edit, pin | Medium; queryIds rotate every 2–6 weeks | Free |
| **D. Browser automation** (real Chrome, human login) | ❌ Same prohibition, plus explicit "browser automation results in permanent suspension" | Everything, but slow and brittle | Low | Free |

**Recommendation: build A as the product, B as an optional read accelerator, C as an opt-in "unofficial" adapter in a separate package that is off by default. Do not build D as a driver** — C already reaches the same endpoints with less fragility, and a real browser the user logs into is best used only as the cookie source for C.

---

## 2. The uncomfortable findings

These are not opinions; they are quoted from X's own docs and changelog (see `docs/research/01-official-api.md` §4).

1. **Likes and follows are gone from self-serve entirely** (Apr 20, 2026), and were independently already prohibited by the Automation Rules: *"Likes must be directly initiated by the authenticated user. Automated, bulk, or indiscriminate liking… is prohibited."* A tool that likes on a schedule or by keyword is non-compliant **by rule**, regardless of transport.
2. **Quote posts are Enterprise-only.** Replies only work when the author "summoned" you (mentioned or quoted you). Self-serve replies to strangers will 403.
3. **Profile editing and pinning have no official endpoint at all.** Not gated, not paid — absent. Avatar/banner upload likewise.
4. **AI reply bots require prior written approval from X.** *"Deploying AI-generated replies without approval is a violation, even if the content itself is helpful."* This directly constrains the "respond to messages automatically" use case.
5. **The old no-API-key generation is dead.** `agent-twitter-client` repo 404 (reportedly a cease-and-desist), `twikit` broken since March 2026, Nitter archived Oct 2026 after legal action.

The honest framing: **a human-in-the-loop client is fine; an unattended engagement bot is not.** Every design decision below follows that line.

---

## 3. Capability matrix

Legend: ✅ works · ⚠️ restricted · ❌ unavailable · 🔓 unofficial only

| Surface | Official API | Notes |
|---|---|---|
| Post text | ✅ | $0.015 |
| Post with link | ✅ | $0.200 — 13× |
| Thread (self-reply chain) | ✅ | one request per segment |
| Poll | ✅ | 2–4 options |
| Media (image/video/GIF) | ✅ | `/2/media/upload` initialize→append→finalize + `media.write` |
| Alt text / subtitles | ✅ | `/2/media/metadata`, `/2/media/subtitles` |
| Edit post | ✅ | `edit_options.previous_post_id` |
| Delete post | ✅ | $0.010 |
| Repost / undo | ✅ | still works |
| Bookmark / folder | ✅ | |
| Like / unlike | ❌ official · 🔓 private | Removed + rule-prohibited when automated |
| Follow / unfollow | ❌ official · 🔓 private | Removed + rule-prohibited in bulk |
| Quote post | ❌ official (Enterprise) · 🔓 private | |
| Reply | ⚠️ summoned only | enforce client-side |
| Profile name/bio/location/url | ❌ official · 🔓 private | no v2 endpoint |
| Avatar / banner | ❌ official · 🔓 private | no v2 endpoint |
| Pin / unpin | ❌ official · 🔓 private | no endpoint anywhere official |
| DM send / read | ✅ | 15/15min — use Activity API instead of polling |
| X Chat (E2E DMs) | ✅ | client-side crypto; heavy |
| Read timelines / mentions / search | ✅ | Owned Reads $0.001 |
| Trends / news / Spaces / Communities (read) | ✅ | |
| Articles draft/publish | ✅ | DraftJS `content_state` |
| Analytics | ✅ | own posts + media |
| Lists CRUD | ✅ | |
| Scheduled post | ❌ | no official scheduling; X's own scheduler is web-only |

---

## 4. Product shape

**Name:** `xctl` — CLI `x`, MCP binary `x-mcp`.

**Positioning:** a terminal-native control plane for *your* X account, with a draft-and-confirm model. Not a bot farm, not a scraper, not an engagement tool.

**Three surfaces, one registry.** A single typed operation array projects into CLI commands, MCP tools, and SDK methods. Adding an operation is one file; all three surfaces update with it.

```
            ┌──────────────────────────────┐
            │  packages/ops (registry)     │  zod schema + run() + annotations
            └──────────┬───────────────────┘
       ┌───────────────┼───────────────────┐
       ▼               ▼                   ▼
  packages/cli    packages/mcp        packages/sdk
  (commander)     (MCP SDK v2)        (typed async fns)
```

**Transport layering:**

```
op.run(ctx, input)
   └─► Transport interface
         ├─ OfficialTransport   (twitter-api-v2 / @xdevplatform/xdk)   default
         ├─ GatewayTransport    (twitterapi.io / SocialData)           reads only, opt-in
         └─ UnofficialTransport (cookies + GraphQL)                    opt-in, separate pkg
```

Every operation declares `transports: ['official']` or `['unofficial']`. The CLI refuses an unofficial-only op unless the user has explicitly enabled the unofficial adapter **and** passed `--yes` / confirmed in the TUI.

**Guardrails baked in, not bolted on:**
- No batch/loop verbs. No `like-many`, no `follow-all`. One target per invocation.
- Draft-and-confirm for every write: `--dry-run` prints the exact request; `--yes` is required for destructive ops when non-interactive.
- Per-operation token buckets seeded from `x-rate-limit-*` headers, persisted in SQLite.
- Cost meter: before a write, show the price from the 2026 rate card; refuse if it would cross the configured monthly cap.
- Idempotency: a client-side dedupe key on `(text, reply_to)` with a 60s window prevents double-posts on retry.
- Never retry a non-idempotent write on timeout.

---

## 5. Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| MCP SDK | `@modelcontextprotocol/server` **2.3.1** | v2 line; v1 is legacy. Verified on npm 2026-10-21 |
| Schema | `zod` **4.6.7** via `zod/v4` | v2 requires Standard Schema; zod 3 fails at `tools/list` |
| CLI | `commander` **15.0.0** | best help/subcommand UX; flags generated from zod |
| Language | TypeScript **7.0.2**, ESM-only, Node ≥ 24 | Go port, 8–12× faster; no dual builds |
| Workspaces | npm workspaces (pnpm optional) | zero extra tooling for a skeleton; strict enough |
| Official client | `twitter-api-v2` **1.29.1** initially; `@xdevplatform/xdk` alongside | mature typings vs official maintenance |
| Secrets | `@napi-rs/keyring` **2.1.2** → 0600 file fallback → env | keytar archived |
| Queue/state | `node:sqlite` behind a small adapter | no native addon, `npx`-friendly |
| Testing | `vitest` + `msw`; MCP tested in-process | fast, no sockets |
| Rate limiting | header-seeded token bucket per `(profile, bucket)` | X's own numbers, not guesses |
| Tool count | ~16 first-class tools + `operations_search`/`operations_invoke` | avoids 30–60k tokens of schema |

---

## 6. Tool surface (MCP)

First-class, task-shaped:

1. `account_status` — profile, scopes, token health, spend this cycle
2. `posts_create` — text, reply_to, media_ids, poll, quote (official: quote will 403)
3. `posts_thread` — ordered segments, atomic-ish with rollback
4. `posts_delete`
5. `posts_get` — by id or URL
6. `posts_search` — recent / all archive
7. `timeline_get` — home / mentions / user
8. `media_upload` — path or URL → media_id, alt text
9. `users_get` — by handle or id
10. `dms_list` / `dms_send`
11. `bookmarks_list` / `bookmarks_add` / `bookmarks_remove`
12. `lists_manage`
13. `analytics_get` — own posts
14. `usage_get` — credits + spend
15. `operations_search` / `operations_invoke` — the long tail

Every write tool carries `destructiveHint: true`, `idempotentHint: false`, and a description that says "show the exact text to the user before calling".

---

## 7. Roadmap

**Phase 0 — skeleton (this session).** Monorepo, registry, CLI, MCP server, official transport stub, README, CLAUDE.md. No live credentials needed to build or test.

**Phase 1 — official write path.** OAuth 2.0 PKCE login with keychain storage and 2h refresh; `posts_create` / `posts_thread` / `media_upload` / `posts_delete`; cost meter; spending cap. This is the shippable product.

**Phase 2 — reads + DMs.** Owned Reads endpoints, search, mentions, bookmarks, lists, `dms_list/send`, `usage_get`.

**Phase 3 — MCP polish.** Tool annotations, `operations_search`, snapshot tests, Claude Code/Desktop install docs, profile-scoped multi-account.

**Phase 4 — optional unofficial adapter** (separate package, off by default): cookie import from a real browser profile, queryId discovery from bundles, transaction-ID generation, per-op budgets at 50% of the community-measured buckets. Ships with a first-run warning that must be typed out.

**Phase 5 — optional gateway reads.** Provider interface + cost attribution; no writes through gateways.

---

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Account suspension from unofficial path | Medium for writes, low for reads | High | Off by default; separate package; no batch ops; 50% budgets; human pacing |
| Query ID rotation breaks unofficial path | Near-certain every 2–6 weeks | Medium | Runtime discovery from bundles, 404 → re-scrape ladder, loud failure |
| Cost blowout from URL posts | Medium | Medium | Warn at $0.20 before posting a link; configurable cap |
| Reply 403 (summoned rule) | High for replies to strangers | Low | Pre-check + clear message |
| MCP client startup timeout on `npx` | Medium | Low | Tiny dep tree, lazy imports, global-install alternative |
| Docs drift (like/follow endpoints still listed) | High | Medium | Treat as runtime 403, not schema-level |
| Token theft from plaintext fallback | Low | High | Keyring first; 0600 fallback with a warning; env for CI only |

---

## 9. What we will not build

- Bulk like/follow/reply loops, or any "engagement farming" surface.
- Keyword-triggered auto-replies (rule-prohibited; AI replies need written approval).
- Multi-account rotation to evade rate limits.
- Anti-detection engineering (fingerprint spoofing, CAPTCHA solving). The unofficial adapter uses the user's own real browser session; it does not try to look like something it isn't.
- Scraping infrastructure or resale of X data.

---

## 10. Open questions

1. **Who is the primary user?** Just you, or a team? This changes Owned Reads eligibility ($0.001 vs $0.005) and the multi-account model.
2. **Do you need DMs in v1?** DM polling is capped at 15/15min; the Activity API is the correct path but needs a public webhook endpoint.
3. **Does the unofficial adapter ship in v1 or later?** Default plan: later, separate package.
4. **Do you have an X developer app already?** OAuth requires one; the 30-second code window makes setup the main onboarding friction.

---

## 11. Implementation status (2026-10-21)

**Decisions taken:** the unofficial adapter ships, but only as an opt-in package; likes and follows exist only as explicit single actions behind `--confirm`. No bulk verbs exist anywhere in the codebase.

### Built

| Phase | Status |
|---|---|
| 0 — skeleton | ✅ monorepo, registry, CLI, MCP |
| 1 — official write path | ✅ OAuth 2.0 PKCE + refresh + keychain, posts/threads/edit/delete, media (simple + chunked + alt text), polls, Articles |
| 2 — reads, DMs, lists | ✅ timelines, search (recent + archive), metrics, quote reads, DMs, bookmarks, lists, blocks/mutes, liked/blocked/muted lists, trends, Spaces, Communities, News, analytics, usage |
| 3 — MCP polish | ✅ 39 official tools + `operations_search`/`operations_invoke`, annotations, stdio smoke test |
| 4 — unofficial adapter | ✅ cookies, bundle parsing, transaction-id generation, 11 ops, config gate + `--confirm` |
| 5 — gateway reads | ⏸ not built (optional; provider interface designed, no implementation) |

Additional: local scheduling queue (`x queue add/list/run/remove`), multi-profile config, persistent SQLite state (rate buckets, spend ledger, dedupe, cache, queue), spend cap accounting.

**Distribution (added after the build):** one npm package (`x-mcp-automation`) and one PyPI launcher with the same name, both bundling the same two Node entry points; a Claude Code plugin (`xctl`) with a vendored MCP server, a skill and slash commands; a marketplace catalogue at `.claude-plugin/marketplace.json`; an `xctl install` command that adds the marketplace and installs the plugin; and OIDC publishing workflows for npm and PyPI. See `docs/PACKAGING.md` and `docs/INSTALL.md`.

**Current state (2026-10-21):** npm `x-mcp-automation@0.2.1` is live and published by CI with provenance. Multi-agent scoped installs cover Claude Code, Codex, opencode and Antigravity. GitHub release `v0.1.1` carries the wheel; PyPI publishing is configured but disabled until the project's pending publisher exists and `PUBLISH_PYPI=true`. The static site in `site/` deploys through GitHub Pages at `x-mcp-automation.danubelabs.net`.

### Verification

`npm test` passes: core primitives, operation request shapes, thread rollback, registry invariants, MCP handshake and tool calls. 60 operations (49 official + 11 unofficial); 51 MCP tools by default, 62 with the unofficial transport enabled.

### Needs a live account to verify

These paths are implemented against the documented shapes but were not exercised against X:

1. OAuth login end-to-end (code exchange, refresh rotation).
2. Media upload response shape, especially chunked `processing_info` polling.
3. `/2/articles/*` DraftJS payload acceptance.
4. `usage.get` response shape (`/2/usage/tweets` and `/2/usage/credits`).
5. Unofficial bundle discovery against a logged-in home page, and transaction-id generation against the current build. Both have fallbacks and loud failure modes, but the layout changes every few weeks.
6. Exact reply-403 behavior under the summoned-only rule.

### Known design limits

- Threads are sequential, not atomic. Rollback deletes published segments on failure, best effort.
- The dedupe window is 30 seconds and keys on text + reply target; it is a guard, not a guarantee.
- Media processing waits ~60 seconds; longer videos need `media.status`.
- Articles built from `paragraphs` produce a minimal DraftJS state; rich content should pass `content_state`.
- The unofficial client uses X's public web bearer (not a secret) and the user's cookies; it does not attempt fingerprint spoofing.
