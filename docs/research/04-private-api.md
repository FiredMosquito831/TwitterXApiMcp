# X.com private web API ("Apollo-reborn" approach) — technical research (2026-10-21)

All claims from public repos, issue trackers, captured-traffic write-ups, court filings and X's published terms. Query IDs change every few weeks; every ID here is a snapshot with a sell-by date.

---

## 0. Executive summary

- The private API shape is unchanged: `https://x.com/i/api/graphql/<queryId>/<OperationName>?variables=…&features=…&fieldToggles=…`, plus v1.1 on `api.x.com/1.1/…` and `x.com/i/api/1.1/…`.
- **Query IDs rotate every ~2–6 weeks**, discovered by regex-scanning JS bundles. twscrape updated them 2026-06-16, 06-26, 07-21, 08-07, 08-25, 10-21.
- **`x-client-transaction-id` is generated per request**: parsed from the page (`twitter-site-verification` meta + 4 SVG frames + index array in a lazily-imported chunk), then `SHA-256(method!path!time + "obfiowerehiring" + animationKey)` truncated to 16 bytes, wrapped in key + timestamp + trailer-3 frame, XOR-obfuscated, base64'd. **Enforcement is selective**: as of 2026-07/08 only `SearchTimeline`, `UserTweetsAndReplies`, `Followers` hard-404 without a valid one; sign everything anyway.
- **2026 is the year the anti-bot layer moved**: logged-out landing page migrated to a Rolldown/"x-web" build (`entry-client-logged-out-*.js`) with no inline chunk map and 16-hex/base62 chunk hashes. Every tid library broke in March 2026 ("Couldn't get KEY_BYTE indices") and again in August 2026. Working approaches bootstrap from an **authenticated** page or `/i/flow/login`.
- **Cookie auth suffices** for the whole read surface and most writes. `auth_token` + `ct0` are the only required cookies; `twid` gives your own user id without `verify_credentials` (retired → 404).
- **Guest tokens** still worked mid-2026 but are per-IP, short-lived, heavily limited; Nitter's final death (Aug/Sep 2026 C&D, archived 2026-09-11) was explicitly about "unlawful use and circumvention".
- **Risk is real but bounded for single-account automation**: dominant failures are per-endpoint 429s (15-minute windows), `ct0`-missing/IP blocks, Arkose challenges, read-only/suspended accounts — plus a contractual liquidated-damages clause ($15,000 per 1,000,000 posts per 24 h).

---

## 1. URL surface and request shape

| Surface | Base | Used for | Notes |
|---|---|---|---|
| GraphQL | `https://x.com/i/api/graphql/<queryId>/<Op>` | timelines, search, lookups, most mutations | GET reads, POST+JSON mutations; some reads moved to POST in 2026 (SearchTimeline) |
| GraphQL alt hosts | `api.x.com/graphql/...`, `api.twitter.com/graphql/...` | same | Interchangeable; x.com is what the web client uses |
| v1.1 web | `https://x.com/i/api/1.1/...`, `https://api.x.com/1.1/...` | DM, follow/block/mute, profile update, media metadata, settings | Most go to `api.x.com`; a few to `x.com/i/api/1.1` |
| v2 web | `x.com/i/api/2/notifications/all.json`, `/2/guide.json` | notifications, explore | |
| Upload | `upload.x.com/i/media/upload.json` (web), `upload.x.com/1.1/media/upload.json` (OAuth1.0a) | media INIT/APPEND/FINALIZE | separate host/auth story |

**Canonical GraphQL call:**

```python
params = {"variables": {**kv}, "features": {**GQL_FEATURES, **ft}}
if toggles: params["fieldToggles"] = toggles
rep = await client.get(f"https://x.com/i/api/graphql/{op}", params=encode_params(params))
```

`encode_params` JSON-encodes each value and URL-encodes — X requires `variables`/`features` as JSON **strings**, not nested objects. Mutations POST the same three keys as a JSON body.

---

## 2. Query IDs: discovery and rotation

### 2.1 Where the IDs live

```js
{ queryId: "wR5Z_lEibLvkew3tF9w-Sg", operationName: "CreateTweet", operationType: "mutation", ... }
params: { id: "<queryId>", name: "<OperationName>", operationKind: "query" }
```

**twscrape's updater** uses two regexes:

```python
rgs = [
  r'queryId:[`"](.+?)[`"].+?operationName:[`"](.+?)[`"]',
  r'params:\{id:[`"]([^`]+)[`"].+?name:[`"]([^`]+)[`"].+?operationKind:[`"]',
]
```

It fetches `https://x.com/xdevelopers` and `https://x.com/home`, extracts script URLs, BFS-follows `import("./x.js")` references to lazily-loaded chunks, parses all chunks, prefers `/responsive-web/client-web/` over `/x-web/` when IDs disagree, and rewrites a marked block in `api.py`. A content-type check (`"javascript" not in ct`) is a rate-limit tripwire.

**Script URL extraction** (the part most code gets wrong in 2026):

```python
ASSET_URL_RE          = r"https://[\w.-]+/x-web/[\w./-]+\.js"
RESPONSIVE_WEB_URL_RE = r"https://[\w.-]+/responsive-web/client-web/[\w./-]+\.js"
LEGACY_MAIN_RE        = r"/client-web/main\.([^.\"']+)\.js"
hash_map = {m[1]: m[2] for m in re.finditer(r'(\d+):"([0-9a-f]{7}|[0-9a-f]{16})"', html)}
name_map = {cid: val for cid, val in re.findall(r'(\d+):"([^"]+)"', html) if not is_hash(val)}
url = f"https://abs.twimg.com/responsive-web/client-web/{name_map.get(cid,cid)}.{hash}a.js"
```

Note the `+"a"` suffix on the hash — observed, never explained, in every implementation.

### 2.2 Rotation cadence — measured

| twscrape release | Date |
|---|---|
| v0.19.0 / v0.19.1 | 2026-06-16, 2026-06-26 |
| v0.19.2 | 2026-07-21 |
| v0.20.0 | 2026-08-07 |
| v0.20.1 | 2026-08-25 |
| v0.21.0 | 2026-10-21 |

Community consensus: **2–4 weeks**. Some IDs are stable for years (`FavoriteTweet = lI07N6Otwv1PhnEgXILM7A`, `UnfavoriteTweet = ZYKSe-w7KEslx3JhSIk5LA`, `CreateBookmark = aoDbu3RHznuiSkQ9aNM67Q`, `DeleteBookmark = Wlmlj2-xzyS1GN3a6cj-mQ` unchanged 2023→Oct 2026). **Never assume — always refresh.**

### 2.3 Operation catalogue (snapshot 2026-10-21, from fa0311/TwitterInternalAPIDocument, 911 GraphQL ops)

| Operation | Method | queryId |
|---|---|---|
| CreateTweet | POST | `wR5Z_lEibLvkew3tF9w-Sg` |
| CreateNoteTweet (long form) | POST | `H7QXYuKegEKuUJvkuW5_dg` |
| DeleteTweet | POST | `nxpZCY2K-I6QoFHAHeojFQ` |
| FavoriteTweet | POST | `lI07N6Otwv1PhnEgXILM7A` |
| UnfavoriteTweet | POST | `ZYKSe-w7KEslx3JhSIk5LA` |
| CreateRetweet | POST | `mbRO74GrOvSfRcJnlMapnQ` |
| DeleteRetweet | POST | `ZyZigVsNiFO6v1dEks1eWg` |
| CreateBookmark | POST | `aoDbu3RHznuiSkQ9aNM67Q` |
| DeleteBookmark | POST | `Wlmlj2-xzyS1GN3a6cj-mQ` |
| PinTweet | POST | `VIHsNu89pK-kW35JpHq7Xw` |
| UnpinTweet | POST | `BhKei844ypCyLYCg0nwigw` |
| HomeTimeline | GET | `svLglq6U2wlTyZMGDDcLYQ` |
| HomeLatestTimeline | GET | `NmDBT3APtNxDpMqIEauu7A` |
| SearchTimeline | GET (POST works) | `irezafrnzav4Ulf1vDkEBg` |
| UserByScreenName | GET | `AMIBMjtxEEATh4z8V9GtRg` |
| UserByRestId | GET | `mxaYWwt52eAb6OAzYHMVzg` |
| UserTweets | GET | `7_KBXBpG0zBPRN6UCIV0-w` |
| UserTweetsAndReplies | GET | `bnsYxFljT6y98rFwiGr3fw` |
| TweetDetail | GET | `3BlMtudy4N-d78ch7zTLZQ` |
| Bookmarks | GET | `VjWsfItbiMLeajpZ90NJeg` |
| NotificationsTimeline | GET | `EUX2EwvgT4f9F7sC4A59Eg` |
| ListLatestTweetsTimeline | GET | `RgfF9JYDXXI1F-ZrDqjUfQ` |
| ListMembers / ListSubscribers | GET | `yQ_0-CTekcCY2oFRTskpSw` / `n52ZU-g4FEWzgdPkv1UC2g` |
| CreateList / UpdateList / DeleteList | POST | `zdGzorOEOslDL4XEbe2INw` / `oe5s3-_kb6-t8iFv4hLH3A` / `UnN9Th1BDbeLjpgjGSpL3Q` |
| ListAddMember / ListRemoveMember | POST | `-Kf1YVC1rNKkPvPFk7YXZw` / `_2o1-wSMWGFSi5HUscn1Hw` |
| CommunityQuery | GET | `-ElI1vg3dYbttVMhBhGdLw` |
| CommunityTweetsTimeline | GET | `wXey4HQTUdYUlWWXltWMpg` |
| JoinCommunity / LeaveCommunity | POST | `3jItWhb1PKC9lute3hWWXA` / `0qehtlwzUschfhKTAv0lKQ` |
| Followers / Following | GET | `stpzFPAIZ2qv8s2lRzPOnQ` / `ath0FIohYC_c3Hj3SsxoCg` |
| DmAllSearchSlice | GET | `Sy2C0fq3p4y5h4YuteslPg` |

**Not GraphQL / different surface:**

| Feature | Endpoint | Notes |
|---|---|---|
| Follow / Unfollow | `POST api.x.com/1.1/friendships/create.json`, `friendships/destroy.json` | 15/15min follow, 187/15min unfollow |
| Block / Unblock | `blocks/create.json`, `blocks/destroy.json` | 187/15min |
| Mute / Unmute | `mutes/users/create.json`, `mutes/users/destroy.json` | 187/15min |
| UpdateProfile | `POST api.x.com/1.1/account/update_profile.json` | name, description, location, url |
| UpdateProfileImage | `POST .../account/update_profile_image.json` | base64 `image` param |
| UpdateProfileBanner | `POST .../account/update_profile_banner.json` (+ remove) | |
| CreatePoll | **not GraphQL** — `POST https://caps.twitter.com/v2/cards/create.json` with `card_data={twitter:card:"poll4choice_text_only", twitter:long:duration_minutes:N, twitter:string:choiceN_label:…}` → `card_uri`, passed as a **variable inside CreateTweet** | verified in twitter-api-client and twikit; **current path UNVERIFIED for Oct 2026** |
| Send DM | `POST x.com/i/api/1.1/dm/new2.json` | 187/15min; also `dm/inbox_initial_state.json`, `dm/conversation/<id>.json` (900/15min), `dm/search/query`, `DMMessageDeleteMutation` |
| Notifications (legacy) | `GET x.com/i/api/2/notifications/all.json` (180/15min), `/mentions.json`, `/verified.json` | being replaced by GraphQL `NotificationsTimeline` |
| Media metadata (alt text) | `POST api.x.com/1.1/media/metadata/create.json` | |
| Guest activate | `POST api.x.com/1.1/guest/activate.json` | §4 |

v1.1 endpoints the **web client still dispatches** (fa0311 `v1.1.json`, 107 entries, Oct 2026) include `friendships/create|destroy|cancel|accept|deny|update`, `blocks/create|destroy`, `mutes/users/create|destroy`, `mutes/keywords/*`, `account/settings`, `account/update_profile*`, `account/logout`, `account/verify_password`, `dm/*`, `media/metadata/create`, `media/subtitles/create`, `onboarding/task`, `onboarding/sso_init`, `search/typeahead`, `users/lookup`, `lists/memberships`, `application/rate_limit_status`. **Absent**: `statuses/update.json`, `statuses/show`, `users/show`, `account/verify_credentials`, `media/upload`.

---

## 3. Headers and cookies

### 3.1 Header set

```http
authorization: Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA
x-csrf-token: <value of ct0 cookie>
x-twitter-auth-type: OAuth2Session
x-twitter-active-user: yes
x-twitter-client-language: en
x-client-transaction-id: <generated per request>
content-type: application/json
referer: https://x.com/
origin: https://x.com
user-agent: <real Chrome UA>
cookie: auth_token=…; ct0=…; guest_id=…; kdt=…; twid=u%3D…; personalization_id=…; …
```

| Header | Source | Notes |
|---|---|---|
| `authorization` | constant in every web bundle | **Public** client bearer, not a secret; identical for all users. Older/alternate bearers exist with different rate buckets — using non-web bearers with web cookies is a fingerprint mismatch |
| `x-csrf-token` | `ct0` cookie, byte-identical | X rejects mismatch. twikit has `_remove_duplicate_ct0_cookie()` because httpx can produce two `ct0` entries (domain variants) → 403 |
| `x-twitter-auth-type` | constant | `OAuth2Session` for cookie sessions; optional in practice (twscrape omits it and works) |
| `x-twitter-active-user` | constant `yes` | |
| `x-twitter-client-language` | UI language | mismatch with `Accept-Language` is a soft signal |
| `x-client-transaction-id` | derived per request | §5 |
| `x-act-as-user-id` | twikit only | delegated/multi-account |
| `x-guest-token` | guest flow | replaces cookie auth |

### 3.2 Cookies

| Cookie | Role | Required? |
|---|---|---|
| `auth_token` | the session (~1 year, rotates on use) | **yes** |
| `ct0` | CSRF token; also sent as header | **yes** |
| `twid` | `u%3D<user_id>` — your numeric id without a profile call | recommended |
| `guest_id*` | device/guest identity | recommended |
| `kdt` | device token | recommended |
| `personalization_id` | ad personalization | cosmetic |
| `gt` | guest token (cookie) | only guest flow |
| `att` | anti-bot/flow token from `onboarding/task.json` | needed during login flow |

Handoff caveat: `ct0` is bound to the `auth_token` session; mixing cookies from two sessions yields 403/`(32) Could not authenticate you`.

### 3.3 TLS / HTTP fingerprint

twscrape added `curl_cffi` impersonation (`impersonate="chrome"|"safari"|"firefox"|"edge"`) because plain httpx fingerprints get challenged (`TWS_HTTP_BACKEND=curl`). Highest-leverage anti-bot mitigation after the transaction ID.

---

## 4. Guest token flow

```
POST https://api.x.com/1.1/guest/activate.json
Authorization: Bearer <web bearer>
→ 200 {"guest_token":"2066858643715129597"}
```

- **2023-06**: guest tokens effectively killed for timeline access (snscrape "blocked (404)" pinned issue).
- **2024-06 → 2026-06**: multiple measurements get a token (200); twittrapi's June 2026 test returns a fresh token "every time".
- **2026-06-23**: Lqm1's package added `activateGuestToken()` because "X no longer embeds the guest token in the homepage HTML". Activation still works; the HTML-embedded token is gone.
- **2026-09**: logged-out browsing shows one preview then a sign-in wall; Nitter dies permanently.

What a guest token still reads (**UNVERIFIED for today**): single `TweetResultByRestId`/`TweetDetail`, `UserByScreenName`, some Explore/Search paths, at per-IP limits far lower than an authenticated session, gated behind tid for `SearchTimeline`. **Not a viable path for an account-automation product.**

---

## 5. `x-client-transaction-id` — full mechanics

### 5.1 What it is

A per-request, time-bound, request-bound signature derived from materials shipped with the page. **Single-use in practice**: replaying a captured value returns 404. Not a CSRF token, not a session token.

### 5.2 Algorithm

Inputs, harvested once per session:

1. **Key bytes (48)** — `<meta name="twitter-site-verification" content="base64…">`; the client selects `document.querySelectorAll("[name^=tw]")[0]`.
2. **Animation frames** — four SVG paths (`loading-x-anim-0..3`, or in the 2026 build the atomic class `.r-4uwx00`), each a `d` attribute of `M…C…C…C…`.
3. **Index array** — four ints scraped from the signing chunk (`ondemand.s.*.js`, now `sign.o-*.js`) with `INDICES_REGEX = r"(\(\w{1}\[(\d{1,2})\],\s*16\))+"`. `idx[0]` is the row index; `idx[1:]` are key-byte indices.

Derivation:

```
ts        = floor((now_ms - 1682924400*1000)/1000)          # seconds since 2023-04-30
ts_bytes  = little-endian 4 bytes of ts
frame     = key_bytes[idx[0]] % 16
frameTime = round( (prod(key_bytes[i] % 16 for i in idx[1:])) / 10 ) * 10
t         = frameTime / 4096

# Simulate the CSS animation at t: cubic-bezier curves per component,
# interpolate from_color -> to_color and rotate 0 -> solve(frames[6],60,360),
# then serialise rgb+matrix to hex, strip "." and "-"
animationKey = hex_repr(rgb(t), rotation_matrix(t))

payload = sha256(f"{METHOD}!{path}!{ts}obfiowerehiring{animationKey}").digest()[:16]
out     = [rand] + key_bytes + ts_bytes + payload + [3]
out     = out.map((v,i,a) => i ? v ^ a[0] : v)
tid     = base64(out).replace("=", "")
```

Reference implementation:

```python
class XClIdGen:
    def calc(self, method: str, path: str) -> str:
        ts = math.floor((time.time()*1000 - 1682924400*1000)/1000)
        ts_bytes = [(ts >> (i*8)) & 0xFF for i in range(4)]
        dkw, drn = "obfiowerehiring", 3
        pld = f"{method.upper()}!{path}!{ts}{dkw}{self.anim_key}"
        pld = list(hashlib.sha256(pld.encode()).digest())
        pld = [*self.vk_bytes, *ts_bytes, *pld[:16], drn]
        num = random.randint(0, 255)
        pld = bytearray([num, *[x ^ num for x in pld]])
        return base64.b64encode(pld).decode().rstrip("=")
```

Only `new URL(u).pathname` is hashed — no host, no query string. Method uppercased.

**Numeric gotchas that cause silently wrong IDs:**
- Bézier epsilon ~`1e-6` (Servo) not `1e-5`; translate WebKit's algorithm, not web-animations-js (drifts).
- `frameTime` rounded to nearest 10 before dividing by 4096.
- Curve values rounded to 2 decimals; colours clamped to `[0,255]`; hex must not zero-pad single digits.
- Output length with 48-byte key: `1 + 48 + 4 + 16 + 1 = 70` bytes → 94 base64 chars.
- WebRTC SDP bytes can be appended between hash and trailer; **all nine ground-truth captures had it empty**, and ports omit it successfully.

### 5.3 What changed in 2026

| When | Change | Who broke |
|---|---|---|
| ~2026-03-18 | Webpack chunk metadata split: `"ondemand.s":"HASH"` no longer contiguous; chunk id and hash keyed separately in two maps | twikit #408/#409, XClientTransaction 1.0.2 |
| ~2026-08-24 | Chunk hashes widened 7 hex → **16 hex** | twscrape 0.20.1 (#327/#328) |
| 2026 mid | Logged-out landing page → **Rolldown/"x-web"** (`entry-client-logged-out-*.js`, base62 asset hashes), no `ondemand` string in HTML; chunk URL computed at runtime | every library; "Couldn't get KEY_BYTE indices" |
| 2026-08+ | Signing module renamed **`sign.o-*.js`**, dynamically imported from a bundle chunk | twscrape now scans all chunks for `\b(?:ondemand\.s|sign\.o)[\w.-]*\.js` |
| 2026-08 | Four SVG frames server-rendered in initial HTML; selector is atomic class `.r-4uwx00` | |

Two working discovery paths today:

1. **Authenticated page** — still serves the legacy `responsive-web/client-web` build with chunk map and `ondemand.s`. twscrape raises `XClIdAccountError("Logged-out X web app")` if it only sees `entry-client-logged-out`.
2. **`/i/flow/login`** — 288 KB webpack shell with intact chunk maps, even logged out.

Feature flag: `rweb_client_transaction_id_enabled`; loader `r.e(59924).then(r.bind(r, 208932))`. If generation throws, the client sends `btoa("e:" + err)` in the header itself (a tid starting with `ZTou` means exactly that).

### 5.4 Enforcement matrix (measured, not assumed)

| Operation | Without / invalid tid |
|---|---|
| `SearchTimeline` | HTTP **404, 0-byte body** |
| `UserTweetsAndReplies` | 404, 0 bytes |
| `Followers` | 404, 0 bytes |
| `Following` (adjacent op) | 200 |
| `ExplorePage`, `TweetDetail`, `HomeTimeline`, `UserTweets`, `Bookmarks`, `Likes`, `List*`, communities | 200 |
| `FavoriteTweet`, `CreateTweet` | 200 in the samples taken (two mutations only — do not rely on this) |
| v1.1 `users/lookup` (2024-11) | shut down; required tid |

Enforcement is **per-operation, hard-coded, not a category rule**. Treat as a moving target: sign every request; it costs one SHA-256.

**Retry policy:** any 404 → regenerate `XClIdGen` from scratch, retry up to 3× with 1 s sleeps. This handles both tid drift and bundle changes without distinguishing them.

---

## 6. Activation / login flow and v1.1 endpoint status

### 6.1 `POST https://api.x.com/1.1/onboarding/task.json`

Flow name `login`; the client drives subtasks:

```
1. guest/activate.json                                  -> guest_token
2. task.json?flow_name=login  {input_flow_data:{flow_context:{start_location:{location:"splash_screen"}}},
                               subtask_versions:{...38 entries...}}   -> flow_token
3. onboarding/sso_init.json (apple)                      (optional)
4. LoginJsInstrumentationSubtask  {js_instrumentation:{response:<ui_metrics>,link:"next_link"}}
5. LoginEnterUserIdentifierSSO    {settings_list:{setting_responses:[{key:"user_identifier",...}]}}
6. (optional) LoginEnterAlternateIdentifierSubtask
7. LoginEnterPassword             {enter_password:{password,link:"next_link"}}
8. (optional) LoginAcid (email code), LoginTwoFactorAuthChallenge (TOTP)
9. AccountDuplicationCheck        {check_logged_in_account:{link:"AccountDuplicationCheck_false"}}
```

- `ui_metrics` comes from `https://twitter.com/i/js_inst?c_name=ui_metrics` and must be executed (twikit uses `js2py`); "may reduce the risk of account suspension". New-device/IP logins trigger Arkose (`ArkoseLogin`/`LoginAcid`).
- `att` header returned by step 2 must be echoed on later calls.
- twscrape's version: initiate → `LoginEnterUserIdentifier` → `LoginEnterPassword` → `LoginTwoFactorAuthChallenge`, with IMAP for email codes. It asserts `"ct0" in cookies` and treats absence as "most likely ip ban".
- `onboarding/task.json` rate limit: **187/15 min**.

### 6.2 Endpoint status with cookie auth vs OAuth1

| Endpoint | Status 2026 | Auth that works |
|---|---|---|
| `account/verify_credentials.json` | **retired — 404 for every caller** | none; replace with a `UserByScreenName` probe (401 = dead cookie, 200 = live) |
| `account/settings.json` | alive | cookie |
| `users/show.json` | not used by web client; legacy OAuth1 path nominally exists | OAuth1; cookie **UNVERIFIED** |
| `users/lookup.json` | shut down Nov 2024 — required tid when it worked | — |
| `1.1/account/update_profile*.json` | alive | cookie (web) or OAuth1 |
| `friendships/`, `blocks/`, `mutes/` | alive | cookie or OAuth1 |
| `dm/*` | alive | cookie |
| `1.1/media/upload.json` (upload.x.com) | **alive** but **OAuth 1.0a signatures only** on the legacy path | OAuth1 |
| `/2/media/upload` | command-style legacy; **moved to `/2/media/upload/initialize`, `/{id}/append`, `/{id}/finalize`** per X's 2026-09-01 changelog | OAuth2 user token with `media.write` (or OAuth1) |
| `media/metadata/create.json` | alive | cookie / OAuth1 |
| web-session upload | `https://upload.x.com/i/media/upload.json` with same cookies+headers (INIT/APPEND/FINALIZE, multipart field `media`, `segment_index`) | cookie |

If driving cookies, use the web upload host / GraphQL `CreateTweet` with `media.media_entities`.

---

## 7. Anti-bot layers and how they fail

| Layer | Evidence | Symptom |
|---|---|---|
| **Cloudflare** in front of `x.com` | twscrape detects `cf-ray` on HTML error bodies → `"Blocked by Cloudflare"`; challenge page `/cdn-cgi/challenge-platform/...` | 403/503 HTML instead of JSON |
| **Cloudflare on specific endpoints** | `UserByRestId` returns **403 HTML from non-browser contexts regardless of queryId freshness** | 403 text/html |
| **Akamai** | no primary evidence found | — (**UNVERIFIED / probably not applicable**) |
| **TLS/JA3 fingerprint** | twscrape ships `curl_cffi`; "works on my mac, not on AWS EC2" is recurring | 403/429 from datacenter IPs |
| **Transaction-ID signing** | §5.4 | naked 404, 0 bytes |
| **Per-account/per-endpoint rate limits** | `x-rate-limit-limit|remaining|reset` on every response | 429 + headers |
| **Account-level throttling** | twikit PR #419: "X rate-limits the account (not per-endpoint)" — a nested call also 429s | 429 on every endpoint at once |
| **Behavioral (no error)** | reduced reach, replies behind "Show more", follows not notifying | no HTTP signal |
| **Challenge/lock** | Arkose (`LoginAcid`, 326), `Denied by access control` | codes 326 / 32 / 88 |
| **Feature-flag drift** | `(336) The following features cannot be null: a, b, …` | parse flag names, set true, retry once |

**Response semantics to code against:**

```
336  -> features outdated; parse names after "cannot be null:", set true, retry once
x-rate-limit-remaining == 0 && reset > 0 -> rate limited; lock account until reset
(88) Rate limit exceeded WITH remaining > 0 -> treated as ban; account inactive
(326) Authorization: Denied by access control -> ban/inactive
(32)  Could not authenticate you -> session expired or banned
403 with "OK" body -> session expired or banned
(-1) LoadShed / DeadlineExceeded -> transient; backoff and retry same account
200 + "No status found with that ID" -> treat as empty, not error
```

---

## 8. Prior art — exact files to study

| Project | Where the tables live | Status 2026-10 |
|---|---|---|
| **vladkens/twscrape** (2.9k★, MIT) | `api.py` (GQL_OPS_CODEGEN, GQL_FEATURES), `xclid.py`, `queue_client.py`, `accounts_pool.py`, `account.py`, `scripts/update-gql-ops.py`, `changelog.md` | **Most current.** Read-only ops only. Pushed 2026-10-21 |
| **d60/twikit** (4.7k★) | `client/gql.py` (`class Endpoint` = full queryId table), `client/v11.py`, `client/client.py`, `x_client_transaction/transaction.py`, `ratelimits.md` | Last push 2026-03-10 → IDs stale; tid broken (#408/#410/#411/#419/#432). Fork `unclecode/twikit` carries 2026 patches |
| **trevorhobenshield/twitter-api-client** | `twitter/constants.py` (`class Operation` — ~250 ops with queryIds + variable schemas), `twitter/account.py`, `scripts/update.py` | Stale IDs but **best catalogue of mutation names/variables**, incl. poll via `caps.twitter.com/v2/cards/create.json` |
| **agent-twitter-client** | was `src/twitter-api.ts` | **Repo 404**; npm 0.0.18 (Dec 2024) "no longer supported". Dead |
| **JustAnotherArchivist/snscrape** (5.4k★) | `snscrape/modules/twitter.py` (bearer, guest-token manager, GraphQL instruction walkers) | Dead since 2023-06; last commit 2023-11-15. Useful as a **parser** reference |
| **fa0311/twitter-openapi** | `src/config/placeholder.json`, `dist/docs/openapi-3.0.yaml` | Updated frequently (2026-10-21) |
| **fa0311/TwitterInternalAPIDocument** | `docs/json/API.json` (**911 GraphQL ops with queryIds**), `docs/json/v1.1.json` (107 entries), `docs/json/v2.json`, `docs/markdown/GraphQL.md` | Best single source for "what exists"; pushed 2026-10-21 |
| **fa0311/twitter_api_safe_relay** | Playwright-driven relay calling the web API from a real browser context | pinned 2026-10-17 |
| **iSarabjitDhiman/XClientTransaction** (MIT) | `x_client_transaction/transaction.py`, `constants.py`, `utils.py` | Original tid reference; broken by 2026 x-web (#41–43) |
| **Lqm1/x-client-transaction-id** (Deno/TS) | `transaction.ts`, `cubic.ts`, `interpolate.ts`, `rotation.ts`, `utils.ts` | Added `activateGuestToken` 2026-06-23; handles new chunk-map format |
| **public-clis/twitter-cli** | `client.py` (`_ensure_client_transaction`, `FALLBACK_QUERY_IDS`), issues #78/#88 | Excellent field notes on x-web breakage |
| **mikf/gallery-dl** | `gallery_dl/extractor/twitter.py` | #9275 is a clean SearchTimeline 404 repro; #5330 has real rate-limit numbers |

---

## 9. Rate limits, ban risk, mitigations

### 9.1 Per-endpoint budgets (15-minute windows, per account)

| Endpoint | Limit |
|---|---|
| `UserByScreenName` | **95** |
| `UserByRestId` | 500 |
| `Followers` | **50** |
| `Following` | 500 |
| `SearchTimeline` | **50** |
| `UserTweets` / `UserTweetsAndReplies` | **50** each |
| `UserMedia`, `Likes`, `Favoriters`, `Retweeters` | 500 |
| `TweetDetail` | 150 |
| `HomeTimeline`, `HomeLatestTimeline` | 500 |
| `Bookmarks`, `List*` | 500 |
| `friendships/create` (follow) | **15** |
| `friendships/destroy`, `blocks/*`, `mutes/*` | 187 |
| `dm/new2.json` | 187 |
| `dm/conversation/<id>.json` | 900 |
| `notifications/all.json` | 180 |
| `onboarding/task.json` | 187 |
| `guide.json` (trends) | 20000 |
| Create/Delete/Favorite/Retweet/List mutations | **undocumented** |

Guest accounts: historically ~999 timeline pages per token (2021), ~1 guest token per IP per day (2023). Datacenter IPs hit a "300 requests/hour" wall.

### 9.2 What "banned" looks like

- **Read-only suspension**: reads still work at much lower thresholds; writes fail.
- **`ct0 not in cookies`** on login → IP-level block, not account death; fixed by new proxy.
- **(88) with remaining > 0**, **(326)**, **(32)**, or bare 403 → mark account inactive.
- **Arkose/`LoginAcid`** on login, recurring daily for flagged accounts.
- **Chain bans** when many accounts share an IP.
- Reports of mass 429 + bans in discrete waves — enforcement is campaign-like, not a smooth curve.

### 9.3 Mitigations actually used

| Technique | Implementation |
|---|---|
| Per-op account locking until reset | locks are per *queue* (operation name), so one endpoint's exhaustion doesn't idle the account |
| Account rotation with wait | `get_for_queue_or_wait(queue, wait_timeout)` |
| Jittered exponential backoff | `sleep(2**fails[kind])`, budget 3 per kind / 4 total |
| Proxy per account, pinned | never rotate IP mid-session; pair accounts 1:1 with residential IPs |
| Browser TLS impersonation | `curl_cffi` |
| Browser-plausible UA per account (seeded) | `seed = sha256(username)[:8]` → stable UA |
| Fresh tid on every request; 404 → new tid | 3 tries |
| Feature-flag self-healing | parse `(336)`, set flags true, retry |
| Activity shaping / daily caps | randomized 45–120 s delays with ±15 % jitter; stop after 3 attempts |
| Don't retry hard | hammering a rate-limited endpoint escalates enforcement |

Ban-avoidance numbers people report: keep under ~50 % of the advertised bucket (e.g. ~20–25 searches/15min vs 50); single account; human-paced writes.

---

## 10. Legal / ToS framing (factual)

**What the contract says**

- X ToS (effective 2024-11-15, through 2026-04-10 and 2026-10-09 revisions): "You may not access the Services in any way other than through the currently available, published interfaces that we provide… you cannot scrape the Services without X's express written permission, try to work around any technical limitations we impose, or otherwise attempt to disrupt the operation of the Services." A parenthetical adds that "crawling or scraping the Services in any form, for any purpose without our prior written consent is expressly prohibited."
- **Liquidated damages** (since 2024-11-15): access > 1,000,000 posts in any 24-hour period → **$15,000 per 1,000,000 posts**. Still present per a 2026-10-09 capture.
- **2026-10-09 revision**: Texas courts/law for non-EU/EFTA/UK, arbitration fallback, class-action and jury-trial waivers; users responsible for "features that perform autonomous actions on your behalf".
- Developer Agreement (separate) bans reverse-engineering and requires the official API.
- `x.com/robots.txt`: `User-agent: * → Disallow: /`.
- **X Automation Rules** permit some automation on your own account but prohibit aggressive/bulk actions, duplicate accounts to evade limits, and automation of engagement. (Page 403s to non-browser clients — quote from a mirror before relying on exact wording.)

**What has actually happened**

- *X Corp. v. Bright Data* (N.D. Cal. 3:23-cv-03698): complaint dismissed 2024-05-09 (Alsup, J.) — scraping public data is not breach/trespass as pleaded; settled and dismissed with prejudice 2025-07-01. No appellate merits ruling.
- *X Corp. v. CCDH*: dismissed 2024-03-25 under California's anti-SLAPP statute.
- **Nitter**: C&D letters Aug/Sep 2026 alleging "unlawful use and circumvention"; repo archived 2026-09-11; XCancel dark 2026-09-15.
- **API pricing**: pay-per-use (~$0.005/post read, $0.015/post create; no general free read tier).
- Enforcement against individual *users* is account-level (suspension, read-only, forced re-auth/Arkose, IP blocks); litigation has targeted vendors/researchers at scale.

**Practical reading for "my own account, my own cookies, rate-limited":** contract risk is a ToS breach (account termination; theoretically the liquidated-damages clause above 1M posts/24h). Legal risk of public-data scraping in the US is low post-*Bright Data*/CCDH and rises sharply when access controls are defeated or EU personal data is handled without a basis. Not legal advice.

---

## 11. Implications for an MCP server automating one's own account

1. **Bootstrap once per session, cache aggressively, refresh on 404.** Cache: bearer (constant), cookies, queryId table (TTL ~24 h + on-404 refresh), tid materials (per session; re-harvest on 404 or after long idle).
2. **Sign every GraphQL request with a fresh tid**, even where not currently enforced. One SHA-256 vs a naked 404 you can't distinguish from a rotated queryId.
3. **Retry ladder on 404**: (1) new tid, same queryId → (2) re-scrape queryId → (3) re-harvest tid materials → (4) fail loudly. Log which layer drifted.
4. **Read `x-rate-limit-*` on every response**; per-operation token bucket per account, with `reset` as the hard floor. Don't burn a mutation endpoint's budget on retries.
5. **Use `twid` for identity**, not `verify_credentials` (retired). Probe liveness with `UserByScreenName` on a known account: 401 = dead session.
6. **Keep a live operation manifest**, not hardcoded IDs.
7. **Never send `features` you didn't harvest**, but handle `(336)` by parsing flag names and retrying once.
8. **For writes, prefer GraphQL mutations** (`CreateTweet`, `FavoriteTweet`, `CreateRetweet`, `CreateBookmark`, `PinTweet`, `CreateNoteTweet`); follow/block/mute/profile/media-metadata remain v1.1 cookie calls.
9. **Media**: cookie session → `upload.x.com/i/media/upload.json` INIT/APPEND/FINALIZE (multipart field `media`, ≤5 MB chunks, `segment_index` from 0), then `media.media_entities` in `CreateTweet`; alt text via `media/metadata/create.json`.
10. **Poll/act like a human**: single account, per-op budgets at ~50 % of the bucket, jittered delays, no burst retries, no IP hopping mid-session.

---

## 12. Confidence flags

| Claim | Status |
|---|---|
| Query IDs in §2.3 | **Snapshot 2026-10-21**; expect drift within 2–6 weeks |
| tid algorithm and constants | Solid: multiple independent ports agree, 9/9 capture validation reported |
| tid required only for SearchTimeline / UserTweetsAndReplies / Followers | Measured Jul–Aug 2026; **may have widened** — sign everything |
| Guest token still issued | Measured June 2026; contested by Sept 2026 logged-out wall — treat as unreliable |
| `dm/new2.json` as current send path | **UNVERIFIED for Oct 2026** |
| `caps.twitter.com/v2/cards/create.json` for polls | **UNVERIFIED for Oct 2026** |
| Akamai in front of X | **No evidence found**; Cloudflare evidenced (`cf-ray`) |
| ToS 2026-10-09 retains liquidated damages | Secondary source quoting the live doc |
| Exact write-op rate limits | **Undocumented** |
| `users/show.json` with cookies | **UNVERIFIED**; retired from web dispatch, likely OAuth1-only |

---

## Sources

- twscrape: github.com/vladkens/twscrape (api.py, xclid.py, queue_client.py, scripts/update-gql-ops.py, changelog.md, issues #248, #274, #175, #268, #351)
- twikit: github.com/d60/twikit (client/gql.py, client/v11.py, x_client_transaction/transaction.py, ratelimits.md, PR #419, PR #412, issue #408, fork unclecode/twikit)
- twitter-api-client: github.com/trevorhobenshield/twitter-api-client (twitter/constants.py, twitter/account.py)
- snscrape: github.com/JustAnotherArchivist/snscrape (twitter.py, issue #754)
- fa0311: twitter-openapi · TwitterInternalAPIDocument (API.json, v1.1.json, GraphQL.md) · twitter_api_safe_relay
- Transaction ID: udp.re/blog/x-client-transaction-id · sneakerdev.com/blog/twitter-header-part-2-reverse-engineering · blog.nest.moe/posts/twitter-header-part-4 · isarabjitdhiman/xclienttransaction · deepwiki XClientTransaction · Lqm1/x-client-transaction-id · langkor/x-client-transaction · takionapi.tech blog · tjdwls101010/Agentic-X docs/wiki/Transaction-ID.md
- Breakage notes: public-clis/twitter-cli #78, #88 · mikf/gallery-dl #9275, #5330 · nirholas/XActions PR #44 · JDownloader thread
- Guest/anon: twittrapi 2026 guide · twitterscraperapi June 2026 · truescrape Nitter post-mortem · twitterapi.io Nitter probe · stacker.news logged-out GraphQL · DIYgod/RSSHub #19416
- Media: xdevplatform/samples media_upload_v2.py · bundle.social media guide · Sume v2 initialize changelog · kaitox article-publish protocol
- Rate limits/bans: twikit rate-limits doc · helperx anti-abuse stack · proxycove ban guide · twitterapi.io twscrape review
- Legal: archive.is/F6Ncd (ToS 2024-11-15) · conductatlas.com/platform/x/x-terms-of-service · forcedarbitration.com/clauses/x-corp · knightcolumbia.org (liquidated damages) · Reuters Bright Data dismissal · Alsup order · stipulation of dismissal · Bloomberg settlement · Knight CCDH dismissal
