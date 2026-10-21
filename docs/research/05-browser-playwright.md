# Browser automation of x.com from Node.js — research report (2026-10-21)

Scope: fallback/driver layer for a CLI + MCP server that automates **the user's own account**. Confidence is marked inline: **[VERIFIED]** = read in primary docs/source; **[REPORTED]** = credible third party, single source; **[UNVERIFIED]** = plausible but could not confirm, or source looks machine-generated/unreviewed.

---

## 0. Executive summary

1. **The 2026 environment is materially worse than 2024.** X publicly announced (Feb 2026) that it is "rolling out more detection for automation & spam… If a human is not tapping on the screen, the account and all associated accounts will likely be suspended." By Oct 2026 X ships **liveness checks** (selfie video, Face ID / Touch ID, hand-motion) to accounts its systems suspect. Browser automation of x.com is now a *degraded, human-in-the-loop* channel, not a set-and-forget one.
2. **Architecturally, do not rebuild x.com's web client.** The durable pattern is: a **long-lived, headful, persistent-profile Chrome** (`channel: 'chrome'`, never bundled Chromium headless) whose *only* job is (a) to host the real logged-in session and (b) to execute the app's own authenticated request path from inside the page. Everything else is a job queue on top.
3. **`launchPersistentContext` and `storageState` are mutually exclusive.** The Playwright API does not accept `storageState` in `launchPersistentContext` **[VERIFIED]**, and it has been an open feature request since 2021/2022. Pick the profile dir as the source of truth; use `storageState` only for export/migration/backup and for isolated (non-profile) contexts.
4. **`data-testid` attributes are the most stable contract x.com offers** and are the right selector layer — but the compose button is `SideNav_NewTweet_Button`, not `SideNav_NewTweet`.
5. **Hybrid is right, but "free transaction-id" is a misconception.** A bare `page.evaluate(fetch(...))` inherits cookies, origin, TLS and browser fingerprint — but **not** `x-csrf-token`, **not** `x-client-transaction-id`, and **not** the `features` flag blob. You get those only by driving the page's *own* client (module hook / XHR interception) or by generating the transaction id in-page.
6. **Recommended process model:** one long-lived browser daemon per account, exposed over Playwright's own protocol, with a single-writer job queue, act-then-verify on the GraphQL response (not the DOM toast), and a first-class `needs_human` state for OCF/2FA/liveness.

---

## 1. Persistent, long-lived authenticated session

### 1.1 `launchPersistentContext` — the real option set

**[VERIFIED]** (playwright.dev/docs/api/class-browsertype)

- `userDataDir` is the **first positional argument**, not an option key.
- Supported options include `channel`, `headless`, `args`, `ignoreDefaultArgs`, `viewport`, `locale`, `userAgent`, `proxy`, `recordHar`, `tracesDir`, `executablePath`, `chromiumSandbox`, `timezoneId`, `serviceWorkers`.
- **`storageState` is not in the list.** Long-standing request: microsoft/playwright#7634 (open), #14949 (closed as feature request, P3).
- Two hard warnings: "browsers do not allow launching multiple instances with the same User Data Directory"; pointing `userDataDir` at Chrome's main "User Data" directory "may result in pages not loading or the browser exiting."

Practical consequences:

- **Profile dir = source of truth.** Never a JSON snapshot as the primary store.
- **One profile per account, one process per profile.** Enforce with a lock file; a second launch fails (`SingletonLock`).
- `context.close()` on a persistent context closes the browser. Always wrap in `try/finally`.

```js
// driver/browser.ts
import { chromium } from 'playwright'; // or 'patchright' (drop-in, see §2.6)

export async function launchAccount(profileDir, opts = {}) {
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',                 // real branded Chrome, not Playwright Chromium
    headless: false,                   // headful (Xvfb on Linux servers)
    viewport: null,                    // do not force a viewport; use the real window
    locale: 'en-US',
    timezoneId: 'America/New_York',    // must match the IP the session was created from
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
    ],
    ...opts,
  });
  ctx.setDefaultTimeout(20_000);
  return ctx;
}
```

### 1.2 `storageState` — what it actually holds

**[VERIFIED]** (playwright.dev/docs/api/class-browsercontext) `context.storageState()` returns cookies, localStorage, IndexedDB, origin private file system, and virtual WebAuthn credentials.

Options: `path`, `indexedDB` (v1.51+), `opfs` (v1.63+), `credentials` (v1.61+).

**Not captured:** `sessionStorage`, cache, extensions, permission grants, device-bound state.

```js
// backup / migration path only
const state = await ctx.storageState({ path: `backup/${account}.state.json`, indexedDB: true });
```

### 1.3 The X cookies that matter

| cookie | role | notes |
|---|---|---|
| `auth_token` | primary session token | HttpOnly, `Secure`; **not a JWT** — no decodable `exp` |
| `ct0` | CSRF token | must also be sent as header `x-csrf-token`; mismatch = 403 |
| `twid` | user id (`u%3D<id>`) | verifies which account is live |
| `kdt` | device token ("remember this device") | surviving device = fewer 2FA prompts |
| `guest_id*`, `personalization_id` | guest/consent | stable-ish, cheap to keep |

Reported TTLs (`auth_token` ~5 years) are **[UNVERIFIED]** and contradicted by field reports of ~30-day revocation for newer accounts (§9).

### 1.4 Expiry and re-login detection — three ways

```js
// 1) cookie presence + coarse expiry (session cookies report expires = -1)
async function cookieHealth(ctx) {
  const cookies = await ctx.cookies('https://x.com');
  const byName = Object.fromEntries(cookies.map(c => [c.name, c]));
  const now = Date.now() / 1000;
  return {
    hasAuth: !!byName.auth_token,
    hasCsrf: !!byName.ct0,
    authExpiresIn: byName.auth_token ? byName.auth_token.expires - now : null,
    userId: byName.twid?.value,
  };
}

// 2) authoritative server check from inside the page
async function sessionValid(page) {
  return page.evaluate(async () => {
    const ct0 = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1] ?? '';
    const r = await fetch('https://x.com/i/api/1.1/account/verify_credentials.json', {
      credentials: 'include',
      headers: { 'x-csrf-token': ct0, 'x-twitter-active-user': 'yes' },
    });
    return { ok: r.ok, status: r.status };
  });
}

// 3) UI signal — cheapest, catches soft-logout
const loggedIn = await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').isVisible().catch(() => false);
```

Do **not** use `[data-testid="BottomBar"]` — it exists as an empty div even when logged in.

Re-login flow: `needs_human` state → open headful window to `https://x.com/i/flow/login` → wait for `x.com/home` **and** `SideNav_AccountSwitcher_Button` → re-snapshot `storageState` → resume queue.

---

## 2. What x.com does to detect automation in 2026

### 2.1 The enforcement layer

- **Cloudflare in front of x.com, IP-reputation-first.** Field report: "Cloudflare blocks datacenter ASNs outright… One IP per account, never rotated, for logged-in session management." Cookie clients get Cloudflare 403 HTML even with fresh cookies from the same machine where the browser works — because the *TLS/HTTP fingerprint* is the tell (twikit#396).
- **No public evidence of Akamai Bot Manager on x.com.** Treat as **[UNVERIFIED — probably false]**. Cloudflare + X's own JS checks is the supportable claim.
- **TLS/JA3-JA4 mismatch.** Playwright's Chromium presents a different JA4 than real Chrome, and X cross-references TLS against the claimed User-Agent. Cloudflare-style stacks rank TLS first.
- **X's own automation detection.** Feb 2026 (Nikita Bier): detection for automation/spam; accounts with no human interaction "will likely be suspended — even if you're just experimenting"; scraping "will get caught." Oct 2026: **liveness checks** — selfie video, Face ID/Touch ID, hand-motion check.

### 2.2 `navigator.webdriver` and other JS tells

Best-documented detection set for Playwright-instrumented Chrome (Castle, DataDome):

1. `navigator.userAgent` contains `HeadlessChrome` (also leaks via `sec-ch-ua`).
2. Missing `Accept-Language` on a Chromium UA.
3. `navigator.webdriver === true`.
4. **CDP `Runtime.enable` side effect** — strongest: a `console.log` of an object whose `.stack` is a getter fires only when a CDP client is attached:
```js
var e = new Error();
Object.defineProperty(e, 'stack', { get() { /* CDP attached */ } });
console.log(e);
```
5. Playwright globals: `window.__playwright__binding__`, `window.__pwInitScripts`, `window.__playwright`.
6. `window.chrome` missing / `navigator.plugins.length === 0` — build properties absent from bundled Chromium, present in real Chrome.
7. **Input provenance**: `event.isTrusted` across the interaction chain, and whether a click had pointer-move samples before it.

### 2.3 Headless vs headful

- DataDome (2024): new headless is code-identical to headful, so after UA spoofing + `--disable-blink-features`, **only the CDP signal remains**.
- 2026 benchmark (54 runs, public detector pages, Debian + Xvfb): **"In headless mode, Patchright and nodriver got flagged on the same pages they passed headful."** Plain Playwright was flagged in *every* run from both datacenter and residential IPs; headful stealth forks passed the automation checks; residential IP only moved network-side checks.

Practical read: **headful is not optional**. Headless on a server means Xvfb + a real window.

### 2.4 `x-client-transaction-id` — the anti-bot header

**[VERIFIED across multiple independent write-ups]**

- X's web client sends `x-client-transaction-id` on every GraphQL request. It is **single-use**: replaying a captured value returns 404 with an empty body. No error message.
- **Which operations require it** (measured): `SearchTimeline`, `UserTweetsAndReplies`, `Followers` → 404 without it. `Following`, `TweetDetail`, most reads → 200 without it. Per-operation gate, not a category.
- Algorithm (2025 community reconstruction):
  1. `twitter-site-verification` meta tag → base64 → key bytes (48 bytes);
  2. resolve the `ondemand.s` webpack chunk, regex `\(\w\[(\d{1,2})\],\s*16\)` for key-byte indices;
  3. harvest four `loading-x-anim-*` SVG frames, simulate a cubic Bézier at a time derived from key bytes → `animation_key`;
  4. `SHA-256("{METHOD}!{path}!{timeNow}" + "obfiowerehiring" + animation_key)`, truncate to 16 bytes;
  5. payload = `[randomByte, ...keyBytes, ...timeBytesLE, ...hash16, 3]`, XOR every byte with `randomByte`, base64, strip `=`.
- **2026 breakage:** the documented discovery step died — `ondemand` no longer appears in landing HTML. Chunk URL is computed at runtime. Ports started failing with `Couldn't get KEY_BYTE indices`. A 2026 re-reversal exists; `Lqm1/transaction.ts` carries a runtime-resolution regex for the new layout **[VERIFIED code, UNVERIFIED still current on 2026-10-21]**.
- **Implication: never reimplement this server-side.** Generate it inside the page (§5) or let the page's own client do it.

### 2.5 Arkose Labs (FunCaptcha) on login

- X's login uses Arkose; public key reported for x.com desktop registration: `2CB16598-CB82-4CF7-B332-5990DB66F3AB`, endpoint `client-api.arkoselabs.com/fc/gt2/public_key/...`, DOM `iframe#arkose_iframe` → `iframe[title="Verification challenge"]` → `input[name="fc-token"]`.
- `twikit` surfaces the same gate as subtask `ArkoseLogin`.
- The challenge lives in **nested cross-origin iframes**; Arkose BDA fingerprints UA, screen, timezone, fonts, plugins, WebGL, audio/video, history length, interaction timing.
- **Correct response: hand it to the human.**

### 2.6 What actually moves the needle

Ranked by evidence strength:

1. **`channel: 'chrome'` (real branded Chrome).** Switching only the channel changed `window.chrome` from `undefined` → object and `navigator.plugins.length` 0 → 5.
2. **Headful.**
3. **Patchright** (drop-in Playwright fork, Chromium-only) if CDP-gated checks appear. Documented patches: avoids `Runtime.enable`, disables Console API, removes `--enable-automation`, adds `--disable-blink-features=AutomationControlled`, removes `--disable-popup-blocking`/`--disable-component-update`/`--disable-extensions`, adds closed-shadow-root support.
   **Cost:** console is dead → verification must not depend on `page.on('console')`; `page.evaluate` has an extra `isolatedContext` option.
4. **Warm-up + pointer paths.** Largest measured effects in the Akamai study were session warm-up (61% → 83%) and Bézier mouse paths (+11 points), **not** a different stealth library.

---

## 3. Login: the only strategy that survives

### 3.1 Recommended shape

**Headful, real Chrome, human logs in once, profile dir persisted, human re-authenticates when asked.** No password stored, no Arkose solving.

```js
export async function ensureLoggedIn(profileDir) {
  const ctx = await launchAccount(profileDir);
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });

  if (await isLoggedIn(page)) return { ctx, page, fresh: false };

  await page.goto('https://x.com/i/flow/login');
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    if (/^https:\/\/x\.com\/home/.test(page.url()) && await isLoggedIn(page)) break;
    await page.waitForTimeout(1500);
  }
  if (!(await isLoggedIn(page))) throw new NeedsHuman('login-timeout');

  await ctx.storageState({ path: `${profileDir}/../backup.state.json` }); // export only
  return { ctx, page, fresh: true };
}

async function isLoggedIn(page) {
  return page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').isVisible().catch(() => false);
}
```

### 3.2 Login flow states and selectors

| step | selector | notes |
|---|---|---|
| identifier | `input[autocomplete="username"]` | handle, email, phone |
| next | `div[role="button"]` "Next"; `[data-testid="loginButton"]` | URL never changes (SPA) |
| **OCF / unusual-activity** | `input[data-testid="ocfEnterTextTextInput"]` | "Enter your phone number or username". **Not 2FA.** Triggered by new IP/device/browser |
| password | `input[autocomplete="current-password"]` / `input[name="password"]` | `[data-testid="LoginForm_Login_Button"]` |
| 2FA | `input[data-testid="ocfEnterTextTextInput"]` | same testid as OCF — disambiguate by prompt text |
| Arkose | `iframe#arkose_iframe` → `iframe[title="Verification challenge"]` | cross-origin; hand to human |
| success | `x.com/home` + `SideNav_AccountSwitcher_Button` | |

### 3.3 Typing matters on the login form

`page.fill()` on the identifier produced the "We cannot verify your account" OCF screen; switching to click → 300 ms → `pressSequentially(text, { delay: 80 })` → 500 ms → Enter "dramatically reduced" (did not eliminate) OCF.

```js
const id = page.locator('input[autocomplete="username"]');
await id.click();
await page.waitForTimeout(300);
await id.pressSequentially(email, { delay: 80 });
await page.waitForTimeout(500);
await page.keyboard.press('Enter');
```

### 3.4 `--headless=new`, `channel: 'chrome'` issues

**[VERIFIED]** Playwright ships two Chromium builds: regular for headed, separate headless shell for headless. `channel: 'chromium'` opts into new headless. Branded Chrome: `channel: 'chrome'`, not installed by default (`npx playwright install chrome`). Chrome/Edge new headless is "closer to a regular headed mode".

Known issues:
- microsoft/playwright#34025: maintainer's reply is *"Playwright is making sure it is easily detectable to prevent misuse."* Closed. **Design position, not a bug — do not expect an upstream fix.**
- Playwright MCP profile locks: orphaned Chrome holding `SingletonLock` produces `Error: Browser is already in use for <dir>`. Daemon must kill orphans, retry once, else `needs_human`.
- `channel: 'chrome'` + Docker DNS breakage is a known class of failure.

---

## 4. Performing actions reliably

### 4.1 Selector layer: `data-testid`

**Compose / posting**

| target | selector |
|---|---|
| compose button (side nav) | `a[data-testid="SideNav_NewTweet_Button"]` |
| editor (nth in thread) | `div[role="textbox"][data-testid="tweetTextarea_{n}"]` |
| add next tweet | `[data-testid="addButton"]` |
| file input | `input[type="file"][data-testid="fileInput"]` |
| alt text | `[data-testid="altTextButton"]` → `[data-testid="altTextInput"]` |
| submit (modal) | `[data-testid="tweetButtonInline"]` |
| submit (/compose/post) | `[data-testid="tweetButton"]` |
| poll | `[aria-label="Add poll"]` |
| schedule | `[data-testid="scheduleOption"]` |
| toast | `[data-testid="toast"]` |
| confirmation sheet | `[data-testid="confirmationSheetConfirm"]` |
| tweet article | `article[data-testid="tweet"]` |

**Engagement / DM:** `[data-testid="like"]`/`"unlike"`, `"reply"`, `"retweet"`/`"unretweet"`, `"retweetConfirm"`/`"unretweetConfirm"`, `"share"`, `"bookmark"`/`"removeBookmark"`, `"caret"`, `"NewDM_Button"`, `"searchPeople"`, `"dmComposerTextInput"`, `"dmComposerSendButton"`, `"messageEntry"`, `"conversation"`.

**Stability issues observed**
- It is `SideNav_NewTweet_Button` (button) and `SideNav_AccountSwitcher_Button`.
- Two submit buttons: `tweetButtonInline` (modal) vs `tweetButton` (/compose/post). Prefer `page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]')`.
- `BottomBar` is a trap for login detection.
- Per-account testids: `UserAvatar-Container-<handle>`, `[data-testid$="-follow"]`/`"-unfollow"` embed the numeric user id — build dynamically.
- `data-testid` churns far less than generated `css-…` classes. Ship a single `selectors` module so a UI change touches one file.
- There is **no canonical published `data-testid` index**. Generate it by snapshotting `document.querySelectorAll('[data-testid]')` per page in CI.

### 4.2 The contenteditable / React quirk

The composer is **Draft.js** on a `contenteditable` div. Credible sources report **opposite** results: `keyboard.type()` posts an empty tweet; `fill()` works; `fill()` leaves the button `aria-disabled="true"` and `execCommand('insertText')` fixes it. **Design for both**, and make button state the gate.

```js
export async function setComposerText(page, text, index = 0) {
  const ta = page.locator(`div[role="textbox"][data-testid="tweetTextarea_${index}"]`);
  await ta.waitFor({ state: 'visible', timeout: 15_000 });
  await ta.click();
  await page.waitForTimeout(200);
  await ta.press('Control+A').catch(() => {});
  await ta.press('Backspace').catch(() => {});

  await ta.fill(text);                                 // path A
  await page.waitForTimeout(400);

  let state = await composerState(page, index);
  if (state.chars < text.length) {
    await ta.evaluate((el, t) => {                     // path B
      el.focus();
      document.getSelection()?.selectAllChildren(el);
      document.execCommand('insertText', false, t);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: t }));
    }, text);
    await page.waitForTimeout(600);
    state = await composerState(page, index);
  }
  return state;
}

export async function composerState(page, index = 0) {
  return page.evaluate((i) => {
    const ta = document.querySelector(`div[role="textbox"][data-testid="tweetTextarea_${i}"]`);
    const btn = document.querySelector('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
    return {
      chars: (ta?.textContent ?? '').length,
      disabled: !btn || btn.getAttribute('aria-disabled') === 'true' || btn.disabled === true,
    };
  }, index);
}
```
Never click submit without asserting `!disabled` — that is where "posted an empty tweet" comes from.

### 4.3 Post, then verify

The DOM toast is not proof. **The GraphQL response is.**

```js
const [resp] = await Promise.all([
  page.waitForResponse(r =>
    /\/i\/api\/graphql\/[^/]+\/CreateTweet/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30_000 }),
  page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]').click(),
]);

const body = await resp.json().catch(() => null);
const tweetId = body?.data?.create_tweet?.tweet_results?.result?.rest_id;
```

Then a **second, independent** confirmation:

```js
await page.goto(`https://x.com/i/status/${tweetId}`, { waitUntil: 'domcontentloaded' });
const ok = await page.locator('article[data-testid="tweet"] [data-testid="tweetText"]').first().isVisible();
```

If `resp` is 403/429 or `tweetId` is absent: classify (`rate_limited` / `duplicate` / `needs_human`) and never blind-retry a write.

### 4.4 Images, threads, polls, schedules, quotes

```js
// image upload — file input is hidden; setInputFiles works on hidden inputs
await page.locator('input[type="file"][data-testid="fileInput"]').setInputFiles(imgPath);
await page.waitForSelector('[data-testid="attachments"] img, [data-testid="tweetPhoto"]', { timeout: 60_000 });
// alt text per image
await page.locator('[data-testid="altTextButton"]').first().click();
await page.locator('[data-testid="altTextInput"]').fill(alt);
await page.getByRole('button', { name: /^(Save|Done)$/ }).click();
```

Upload path in X's own client is a 3-call flow (INIT → APPEND → FINALIZE against `upload.twitter.com/i/media/upload.json`) — the UI drives it for you.

**Thread:** `setComposerText(page, part0, 0)` → `[data-testid="addButton"]` → `setComposerText(page, part1, 1)` … → one submit posts the chain. Verify with multiple `CreateTweet` responses (one per segment); record `conversation_id_str` from the first.

**Poll:** `[aria-label="Add poll"]` opens choice inputs. Individual option inputs have no confirmed testid — **[UNVERIFIED]**; discover via `page.getByPlaceholder(/choice/i)`. Validate with a snapshot test.

**Schedule:** `[data-testid="scheduleOption"]` — requires Premium. Date/time inputs **[UNVERIFIED]**. Scheduled posts are published by X itself, so the process is out of the publish path — the lowest-risk way to do time-shifted posting.

**Quote tweet:** `[data-testid="retweet"]` → menuitem `/quote/i`. Menu item testid **[UNVERIFIED]**; use role/text. Verify `CreateTweet` + `attachment_url`.

**Reply:** `[data-testid="reply"]` on the target `article[data-testid="tweet"]`; verify `reply.in_reply_to_status_id_str` equals parent id.

**DM:** `NewDM_Button` → `searchPeople` → `dmComposerTextInput` → `dmComposerSendButton` → confirm `messageEntry`. DMs are the least stable surface; best-effort.

### 4.5 Content limits and dedup

- 280 chars standard; 25,000 for Premium.
- URLs count as 23 chars regardless of length.
- **Duplicate detection**: identical/near-identical text within ~24–48h rejected (`error 187` on the API path).

---

## 5. Hybrid: boot in Playwright, then act through the page

### 5.1 What you actually get "for free"

| property | `page.evaluate(fetch)` | page's own client (hook) | raw Node `fetch` + cookies |
|---|---|---|---|
| cookies | yes | yes | manual |
| TLS / JA3-JA4 / HTTP2 fingerprint | real Chrome | real Chrome | yours (likely blocked) |
| `x-csrf-token` | **no** | yes | manual |
| `x-client-transaction-id` | **no** | yes | manual, and it breaks |
| `features` blob / `queryId` currency | **no** | yes | manual, rotates |
| `x-twitter-active-user`, `x-twitter-auth-type` | no | yes | manual |

**`page.evaluate(fetch)` buys network identity and cookies, not request authorization.**

### 5.2 Pattern A — bridge into the page's own client (best fidelity)

`fa0311/twitter-api-safe-relay` injects a MAIN-world bridge that calls X's live API client, so "cookies, CSRF handling, auth state, feature flags, and request behavior" are never reimplemented. Ships a Playwright package, a WXT extension adapter, **and an HTTP relay** — a Node CLI can `POST http://localhost:3000/i/api/graphql/{queryId}/{op}` while the browser stays the transport.

`fa0311/twitter_api_browser_python` harvests the operation manifest and feature-switch state out of the page at runtime, so `queryId`s never go stale:

```python
operation_list = await page.evaluate("globalThis.<bridge>.operation_list")  # [{operationName, queryId, operationType, metadata}]
init_state     = await page.evaluate("globalThis.<bridge>.init_state")      # featureSwitch.{defaultConfig,user,debug,customOverrides}
```

This solves the biggest fragility of every reimplementation: `CreateTweet`'s `queryId` is a build artifact that changes on deploy.

### 5.3 Pattern B — `page.evaluate(fetch)` + in-page transaction id

```js
await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' }); // needed for key + anim frames
const result = await page.evaluate(async ({ path, method, body }) => {
  const ct0 = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1] ?? '';
  const tid = await window.__tidgen(method, path);   // your in-page implementation
  const r = await fetch(`https://x.com${path}`, {
    method,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': ct0,
      'x-client-transaction-id': tid,
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, text: await r.text() };
}, { path, method, body });
```
The bearer above is X's public web-client credential, not a user secret. Different public projects ship different `queryId`s for the same operation (`bDE2rBtZb3uyrczSZ_pI9g`, `LBFRMJBLzXkI-zdK3fCj1Q`, `7TKRKCPuAGsmYde0CudbVg`, `sgqau0P5BUJPMU_lgjpd_w`) — **that list is the argument for Pattern A.**

### 5.4 Pros/cons vs raw HTTP

| | page-hosted (A/B) | raw Node HTTP + cookies |
|---|---|---|
| transaction id | automatic or one-time port | reimplemented; broke in 2026; single-use |
| `queryId` rotation | auto-discovered | manual; silent breakage on deploy |
| TLS fingerprint | real Chrome | must impersonate, hard in Node |
| Cloudflare | passes as the browser | 403 HTML (twikit#396) |
| cost | ~300–600 MB live Chrome | ~nothing |
| when to use | writes, gated reads | bulk read-only of *public* data |

**Verdict:** for a same-account write tool, page-hosted wins outright.

---

## 6. Existing projects — what to borrow

| project | what it is | borrow |
|---|---|---|
| **`agent-twitter-client`** (elizaOS) | Node client over cookie auth + GraphQL; MCP wrapper exists | the **subtask taxonomy** (`LoginEnterUserIdentifierSSO`, `LoginAcid`, `LoginTwoFactorAuthChallenge`, `LoginSuccessSubtask`, `DenyLoginSubtask`) |
| **`twikit`** (Python) | GraphQL client, cookie login | cookie-only login (`set_cookies({auth_token, ct0})`), `401 ⇒ re-auth` pattern; living proof of Cloudflare 403 |
| **`twscrape`** | async Python, account pool | account-pool + rotation design |
| **`twitter-web-exporter`** | userscript, **GraphQL response interception** | interceptor model: read what the page already fetched |
| **`twitter-api-safe-relay` / `twitter_api_browser_python`** | bridge into the page's own client | **the architecture in §5.2** |
| **`Patchright`** | stealth Playwright fork | `launchPersistentContext` + `channel:'chrome'` + headful + `viewport:null` |
| **`browser-use` / Stagehand / Skyvern** | general browser agents | a11y-tree snapshotting for selector repair, vision fallback; **Skyvern is AGPL — license blocker** |
| **Playwright MCP** | a11y-tree tool surface | profile-lifecycle design (`--isolated`, `--storage-state`, `--user-data-dir`) |

---

## 7. Resource cost, headless servers, concurrency

- Headful Chrome, one profile: **~300–600 MB RSS**; plan **1–1.5 GB RAM per account**, 2 vCPU per 2–3 accounts.
- Official Playwright image ~2.9–3.3 GB unpacked.

```dockerfile
FROM mcr.microsoft.com/playwright:v1.64.1-noble   # pin; digest-pin in prod
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11-utils fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/* && fc-cache -f
RUN npx playwright install chrome || true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
CMD ["xvfb-run","-a","-s","-screen 0 1440x900x24","node","dist/daemon.js"]
```
- **`/dev/shm` is 64 MB by default and Chromium crashes on heavy pages.** Use `--ipc=host` or `--shm-size=1g`.
- **Do not use Alpine** (musl vs glibc). Use `noble`/`jammy`.
- Fonts matter twice: screenshots, and metrics. Missing emoji/CJK fonts break artifacts.
- **GPU**: no GPU ⇒ SwiftShader. Consistency across restarts matters more than matching a human's GPU.

**Concurrency rules:**
1. **One profile dir = one process, ever.** OS-level lock file + `SingletonLock` detection.
2. **One account = one browser.** Don't multiplex accounts into one browser.
3. **One account = one IP**, ideally the IP the session was created on. Datacenter ASNs are the most disqualifying signal.
4. **Serialize actions per account**, with jitter. ≥45–90 s between writes, ≤2 writes per 15 min, hard daily cap well below documented ceilings.
5. **Parallel reads are fine; parallel writes are the tripwire.**

---

## 8. Recommended architecture for the browser driver

### 8.1 Process model: long-lived daemon, one per account

Spawn-per-command is wrong: cold Chrome + x.com hydration costs 4–10 s and a fresh launch looks like a fresh device.

```
CLI / MCP client
      │  (stdio JSON-RPC, or HTTP to 127.0.0.1)
      ▼
xdrive supervisor (Node, one process, N account daemons)
      │  per account: child process "browser host"
      ▼
browser host  ── launchPersistentContext(profileDir, {channel:'chrome', headless:false})
      │            ├── Playwright protocol (in-process, highest fidelity)
      │            └── exposes: browserType.launchServer() ws endpoint
      ▼
Chrome (headful, Xvfb) + profile dir + the account's single job queue
```

IPC options:
- **`browserType.launchServer()` + `browserType.connect(wsEndpoint)`** — Playwright's own protocol; major.minor must match. Higher fidelity.
- **`connectOverCDP`** — docs: "significantly lower fidelity than the Playwright protocol connection". Use only to attach to a *human-started* Chrome.

Chrome 136+ caveat: `--remote-debugging-port` and `--remote-debugging-pipe` are **ignored** on the default data directory; must pair with non-default `--user-data-dir`.

### 8.2 Health checks (three levels)

```js
// L1 liveness
await page.evaluate('1');

// L2 session
const h = await cookieHealth(ctx);
const v = await sessionValid(page);
if (!v.ok) → state = 'needs_human'

// L3 target sanity
const fingerprint = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  hasApp: !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'),
  bodyLen: document.body.innerText.length,
}));
```
Heuristics: "Just a moment…" (Cloudflare), "Something went wrong", empty SPA shell. Run L1+L2 before every job; L3 after any navigation.

### 8.3 Screenshot-on-failure + artifacts

```js
async function onFailure(page, job, err) {
  const dir = `artifacts/${job.account}/${job.id}-${Date.now()}`;
  await fs.mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/screen.png`, fullPage: false }).catch(() => {});
  await page.content().then(html => fs.writeFile(`${dir}/dom.html`, html)).catch(() => {});
  await fs.writeFile(`${dir}/error.json`, JSON.stringify({
    message: err.message, name: err.name, url: page.url(),
    cookies: (await page.context().cookies('https://x.com')).map(c => ({ n: c.name, e: c.expires })),
  }, null, 2));
}
```
Keep artifacts **out of** the profile dir and gitignored — they contain cookies.

### 8.4 The act → verify state machine

```
queued ──► preflight(L1,L2,L3) ──► navigate ──► act
                                     │            │
                          fail ◄─────┘            ▼
                                              observe
                                    ┌───────────┼────────────┐
                                    ▼           ▼            ▼
                              server-proof  ui-proof     no-proof
                              (GraphQL ok)  (toast)      (timeout)
                                    │           │            │
                                    ▼           ▼            ▼
                                 verified    verify2     classify
                                    │      (fresh fetch)     │
                                    └──────► done ◄─────────┘
                                                │
                       failure classes: rate_limited | challenge(OCF/Arkose/liveness)
                                        | session_expired | duplicate | selector_drift | unknown
```
Rules: (a) one write attempt, one retry **only** for `selector_drift`/`unknown` after fresh navigation; (b) never retry `rate_limited` inside the window; (c) any `challenge`/`session_expired` moves the account to `needs_human` and pauses that account's queue; (d) attach the artifact dir to the job record.

### 8.5 Selector-drift defense

- One `selectors.ts` with a **fallback chain** per target: testid → role/name → aria-label → text.
- Nightly (or after N consecutive `selector_drift`): dump `document.querySelectorAll('[data-testid]')` for composer, home, DM, profile; diff against last good snapshot.
- Keep an a11y-snapshot debug tool so a coding agent can re-derive a selector without a code change.

---

## 9. 2FA, email/phone verification, session invalidation

### 9.1 2FA

- X uses TOTP; the UI reuses `[data-testid="ocfEnterTextTextInput"]` for both 2FA code and OCF identity prompt — **disambiguate by prompt text**.
- `otplib` / `totp-rs` can generate codes; `agent-twitter-client` and `127/ixer` support TOTP from an env secret.
- `kdt` cookie ("remember this device") is the main lever that makes 2FA rare.
- **Recommended:** TOTP optional and opt-in; default is human entry.

### 9.2 Email/phone verification

- **OCF identity prompt** (username/phone) — a soft challenge, not 2FA. Same profile, same IP, human-like typing reduces it.
- **Real verification** (new device, suspicious login) — must be human. States: `awaiting_email_code`, `awaiting_sms_code`, resumable, with timeout.

### 9.3 Session invalidation — expect it, detect it, never fight it

Field reports: newer accounts' `auth_token` "revoked every 30 days"; "initially a month, then two weeks, and now just a day"; "any account that doesn't show activity within a 30-day period will have to re-auth."

```js
const invalidationSignals = [
  /\/i\/flow\/login/.test(page.url()),
  !(await isLoggedIn(page)),
  (await sessionValid(page)).status === 401,
  (await sessionValid(page)).status === 403,   // csrf/ct0 mismatch also lands here
];
```
- On invalidation: `state = 'needs_human'`, **stop that account's queue**, emit an MCP notification with a deep link.
- Never auto-submit stored credentials as the recovery path — that produces OCF → Arkose → liveness escalation.
- After each successful human login, snapshot `storageState` with `indexedDB: true` (backup, not runtime store).
- **Volume caps below documented limits:** unverified accounts capped at **50 original posts + 200 replies/day since May 2026**, metered in **semi-hourly windows**; Premium reportedly 2,400 combined. For an assisted tool, 20–25/day with ≥30 min spacing is defensible.

### 9.4 Liveness checks

Since Oct 2026 an account X suspects can be required to submit a **selfie video, Face ID/Touch ID, or hand-motion check**. There is no automation answer; detect, stop, hand to human. Repeated attempts against a liveness gate is the shortest path to "the account and all associated accounts will likely be suspended."

---

## 10. Concrete recommendation

1. **Driver:** `patchright` (drop-in import swap) with `launchPersistentContext(profileDir, { channel: 'chrome', headless: false, viewport: null })`, one profile per account, headful under Xvfb, one IP per account. Keep vanilla Playwright behind a flag.
2. **Login:** never automated. Human logs in on first run and whenever `needs_human` fires. No stored password. TOTP optional.
3. **Actions:** `data-testid` selector layer with fallbacks, `fill` + verify + `execCommand('insertText')` repair, `aria-disabled` gate before submit, verify on the `CreateTweet` response `rest_id`, then once more on a fresh navigation.
4. **Reads:** page-hosted GraphQL via the page's own client (bridge), so `queryId`/`features`/`transaction-id` are discovered rather than reimplemented. No raw-HTTP path for authenticated calls.
5. **Process:** daemon per account, `launchServer`/`connect` (not CDP), single-writer queue, L1/L2/L3 health checks, screenshot + DOM + error JSON on every failure, per-account circuit breaker.
6. **Product framing:** a **draft-and-confirm** MCP tool surface (compose → show preview → explicit "post") is both the honest use of X's automation policy boundary and the best defence against liveness checks. Bulk like/reply/follow automation should not exist in this codebase.
7. **Fallback ladder for the README:** page-hosted browser (best fidelity, human gate) → official X API (paid) → nothing. Be explicit that the browser path is a **ToS risk owned by the user**.

---

## Source index

**Playwright primary** — playwright.dev/docs/api/class-browsertype; /class-browsercontext; /docs/browsers; /docs/auth; /docs/best-practices; /docs/evaluating; /mcp/configuration/user-profile; /docs/getting-started-mcp; /docs/release-notes

**Playwright issues** — microsoft/playwright#7634, #14949, #19742, #34025 ("easily detectable… by design"), #40419 (MCP profile lock), #40027 (Chrome 144 inspect toggle)

**Chrome platform** — developer.chrome.com/blog/remote-debugging-port (Chrome 136 restriction)

**Detection research** — datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/; blog.castle.io/how-to-detect-headless-chrome-bots-instrumented-with-playwright/; rebrowser.net/blog/how-to-fix-runtime-enable-cdp-detection...; scalebrowser.net/blog/webdriver-cdp-detection; github.com/daijro/camoufox (build-tester core.ts); scrapewise.ai/blogs/playwright-akamai-bot-manager-2026; proxyhat.com/blog/stealth-browser-benchmark-datacenter-residential; proxy-compare.com/blog/how-to-use-patchright/

**X-specific detection** — udp.re/blog/x-client-transaction-id; antibot.blog/posts/1741552163416; github.com/glizzykingdreko/twitter-generator/blob/main/LEARN.md; deepwiki.com/iSarabjitDhiman/XClientTransaction/3.1-transaction-id-generation; github.com/Lqm1/x-client-transaction-id/blob/main/transaction.ts; github.com/tjdwls101010/Agentic-X/blob/main/docs/wiki/Transaction-ID.md; gen9x.com/blog/how-to-decode-fingerprint-bda-of-funcaptcha; livemint (Feb 2026 automation announcement); tech.yahoo.com (Oct 2026 liveness checks)

**Selectors and recipes** — github.com/nirholas/XActions/blob/main/docs/agents/selectors.md; github.com/six-ddc/browser-cli/.../sites/x.com.md; github.com/xtea/auto-x/.../publisher/selectors.py; github.com/aden-hive/hive/.../x-automation/SKILL.md; github.com/taylorwalton/talon/.../post.ts; note.com/hinaworks/n/n1706801003cd; khorne.app/twitter-bot; zenn.dev/kakudenbuzo/scraps/928cfe9c44f120; github.com/prinsss/twitter-web-exporter

**Hybrid** — github.com/fa0311/twitter-api-safe-relay; github.com/fa0311/twitter_api_browser_python; michaelamendy.com/blog/google-searches-x-account; cdn.jsdelivr.net/npm/@zenalexa/unicli@1.2.1/src/adapters/twitter/post.ts

**Clients and failure logs** — docs.rs/agent-twitter-client (user_auth.rs); github.com/d60/twikit/blob/main/twikit/client/client.py; twikit#396 (Cloudflare 403), #288 (token revocation), #281, #251; github.com/vladkens/twscrape/issues/204; github.com/127/ixer

**Deployment** — ssdnodes.com/learn/headless-browser-for-agents-vps; mapvisualregression.org (pinning fonts/GPU); thebrowserlayer.com/posts/running-headless-browsers-inside-docker-containers

**Limits/policy/economics** — opentweet.io/help/twitter-posting-limits-2026; api.sorsa.io/blog/twitter-api-posting-limits; circleboom.com/blog/how-many-tweets-per-day-on-x; torchproxies.com/blog/x-twitter-proxy-guide-2026-api-tiers-account-automation-and-staying-under-the-limit; help.x.com/en/rules-and-policies/x-automation
