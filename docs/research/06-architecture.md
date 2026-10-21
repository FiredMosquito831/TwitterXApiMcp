# Node/TypeScript Monorepo for CLI + SDK + MCP Server (X/Twitter) — 2026-10

All versions read from the npm registry on **2026-10-21** unless marked otherwise.

---

## 0. Executive summary — recommended stack

| Layer | Choice | Why |
|---|---|---|
| MCP SDK | **`@modelcontextprotocol/server` 2.3.1** (+ `/client` for tests) | v2 is the stable line since 2026-07-27; v1 `@modelcontextprotocol/sdk` is legacy |
| Schema | **`zod` 4.6.7** (`import * as z from 'zod/v4'`) | v2 requires Standard Schema + `~standard.jsonSchema`, i.e. zod ≥ 4.2 |
| Transports | `serveStdio(factory)` for CLI-spawned MCP; `createMcpHandler` + `toNodeHandler` for hosted HTTP | Same factory serves 2025 and 2026-07-28 eras |
| CLI framework | **`commander` 15.0.0** (or `node:util` `parseArgs` for the thin path) | Mature, Node ≥ 22.12, best help output; Clipanion still `4.0.0-rc.4` |
| Build | **`tsc` 7.0.2 for typecheck + `.d.ts`**, **`tsup` 9.0.0** for the JS bundle | TS 7 is the Go port (8–12× faster) |
| Module format | **ESM-only**, `engines.node >= 24` | Node 22.18+ runs `.ts` natively; dual builds are dead weight for CLIs |
| Workspaces | **pnpm 12.14.0** + **`@changesets/cli` 3.0.3** | Strict isolation, catalogs; changesets needs pnpm ≥ 10 |
| Secrets | **`@napi-rs/keyring` 2.1.2**, file fallback with `0600` | `keytar` archived since 2022 |
| Queue/state | **`node:sqlite`** behind an adapter (swap to `better-sqlite3` 13.0.3 if you need `.transaction()`) | Zero install friction for `npx` |
| HTTP | **`undici` 8.12.3** (or global `fetch`) | Node-native |
| Tests | **`vitest` 5.0.5**, **`msw` 3.0.3**, **`@playwright/test` 1.64.1** | MCP in-process via `handler.fetch` |
| Distribution | npm `bin` + GitHub Releases + `npx @scope/x` | See §10 |

**The single most important finding:** the MCP TypeScript SDK **split into v2 packages with different names** in July 2026. Any tutorial telling you to `npm i @modelcontextprotocol/sdk` and `server.tool(...)` describes the legacy line.

---

## 1. MCP TypeScript SDK — current state

### 1.1 Packages

| Package | Version | Published | Role |
|---|---|---|---|
| `@modelcontextprotocol/server` | **2.3.1** | 2026-10-05 | `McpServer`, `createMcpHandler`, web-standard transports |
| `@modelcontextprotocol/client` | **2.3.1** | 2026-10-05 | `Client`, `StreamableHTTPClientTransport`, `InMemoryTransport` |
| `@modelcontextprotocol/core` | **2.3.1** | | public Zod `*Schema` constants |
| `@modelcontextprotocol/node` | **2.1.1** | | `NodeStreamableHTTPServerTransport`, `toNodeHandler`, host/origin guards |
| `@modelcontextprotocol/express` / `fastify` / `hono` | 2.0.2 / 2.0.1 / 2.0.2 | | framework adapters (framework is a peer dep) |
| `@modelcontextprotocol/sdk` | **1.32.1** | 2026-10-05 | **legacy v1**; bug/security fixes only |

`@modelcontextprotocol/core-internal` is private — never import it. Downloads: `sdk` ≈ 39.4M/wk vs `server` ≈ 8.2M/wk (mid-migration).

### 1.2 `McpServer` + `registerTool`

- v2 **removed** variadic `.tool()/.prompt()/.resource()`. Use `registerTool(name, config, handler)`, `registerPrompt`, `registerResource` (now takes explicit `metadata` — pass `{}`).
- `inputSchema`/`outputSchema` are **Standard Schema** objects (zod v4, Valibot, ArkType). Raw shapes work via deprecated overloads but get wrapped by the SDK's *bundled* zod — a foreign zod instance breaks at `tools/list`.
- **Zod v3 is not supported.** With zod 3 you typecheck cleanly and fail at the first `tools/list`.
- `outputSchema` + `structuredContent` are supported: the SDK validates `structuredContent` against `outputSchema` **before the result leaves the server**. Per spec, also serialize the same JSON into a `TextContent` block for older clients.
- New in v2: `maxToolInputElements` (off by default) caps array elements + object members in `arguments` — worth setting for an LLM-facing server.

### 1.3 Transports

| Scenario | v2 entry point |
|---|---|
| stdio (Claude Code/Desktop spawns you) | `serveStdio(() => McpServer)` from `@modelcontextprotocol/server/stdio` |
| HTTP, Node frameworks | `createMcpHandler(factory)` then `toNodeHandler(handler)` |
| HTTP, web-standard runtimes | `export default handler` |
| Legacy SSE | removed; frozen at `@modelcontextprotocol/server-legacy/sse` |

Two era facts:
- `2026-07-28` made MCP **stateless**: no `initialize`, no `Mcp-Session-Id`, a `server/discover` advertisement and a `_meta` envelope per request. `createMcpHandler` builds a **fresh server per request** — register tools inside the factory, never on a shared instance.
- `serveStdio` serves 2025-era clients by default. For a spawn-per-invocation CLI, do **not** default `versionNegotiation: 'auto'` — on stdio it spawns a sibling process and can stall for the full probe timeout.

### 1.4 Minimal correct stdio server with 3 tools

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const Tweet = z.object({
  id: z.string(), text: z.string(), created_at: z.string(),
  author_username: z.string(),
  metrics: z.object({ like_count: z.number(), repost_count: z.number(), reply_count: z.number() })
});

function buildServer() {
  const server = new McpServer({ name: 'x-tools', version: '0.1.0' }, { maxToolInputElements: 5_000 });

  server.registerTool('users_get', {
    title: 'Get an X user',
    description: 'Look up one X (Twitter) user by @username or numeric id. Returns profile fields and follower counts. ' +
                 'Use this before any tool that needs a user id. Read-only, cheap, cacheable for 60s.',
    inputSchema: z.object({
      username: z.string().describe('Handle without the leading @, e.g. "jack"'),
      include_metrics: z.boolean().default(true).describe('Include follower/following counts')
    }),
    outputSchema: z.object({ user: z.object({ id: z.string(), username: z.string(), followers: z.number().int() }) }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ username }) => {
    const user = await x.users.getByUsername(username);
    const out = { user };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  });

  server.registerTool('tweets_search_recent', {
    title: 'Search recent posts',
    description: 'Search X posts from the last 7 days. Supports X search operators (from:, -is:retweet, has:media). ' +
                 'Returns at most `max_results` posts plus `next_token`; pass next_token to page. Token-expensive.',
    inputSchema: z.object({
      query: z.string().min(1).describe('X search query, e.g. "from:jack mcp -is:retweet"'),
      max_results: z.number().int().min(10).max(100).default(10),
      next_token: z.string().optional().describe('Opaque cursor from a previous call')
    }),
    outputSchema: z.object({
      tweets: z.array(Tweet), next_token: z.string().nullable(), result_count: z.number().int()
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ query, max_results, next_token }) => {
    const page = await x.tweets.searchRecent({ query, maxResults: max_results, nextToken: next_token });
    const out = { tweets: page.tweets, next_token: page.nextToken ?? null, result_count: page.tweets.length };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  });

  server.registerTool('tweets_create', {
    title: 'Post a tweet',
    description: 'Publish a new post as the authenticated account. Side-effecting and NOT idempotent: never retry on timeout, ' +
                 'tell the user the exact text before calling. Max 280 characters unless the account is premium.',
    inputSchema: z.object({
      text: z.string().min(1).describe('Post body, <= 280 chars'),
      reply_to: z.string().optional().describe('Tweet id to reply to'),
      quote_tweet_id: z.string().optional()
    }),
    outputSchema: z.object({ id: z.string(), text: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async ({ text, reply_to, quote_tweet_id }) => {
    const tweet = await x.tweets.create({ text, replyTo: reply_to, quoteTweetId: quote_tweet_id });
    const out = { id: tweet.id, text: tweet.text };
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  });

  return server;
}

const handle = serveStdio(buildServer);
console.error('x-tools MCP server listening on stdio'); // stderr ONLY
process.on('SIGINT', () => void handle.close());
```

Rules that bite:
- **stdout is the JSON-RPC channel.** One `console.log` corrupts the stream.
- Schema failures return `{ isError: true }`; the handler never runs.
- Return `resource_link` for big payloads, not megabytes of base64.

---

## 2. Alternatives: FastMCP, mcp-framework, xmcp

| | `fastmcp` **4.23.5** | `mcp-framework` **0.2.22** | `xmcp` **1.7.2** | official v2 |
|---|---|---|---|---|
| Built on | `@modelcontextprotocol/sdk ^1.24.3` (**legacy**) | official SDK (v1) | `@modelcontextprotocol/server ^2.0.0` | — |
| Protocol eras | **2025 only** — README says it does not support `2026-07-28` | 2025 only | v2-era (peers on v2) | both |
| Ergonomics | `addTool`, sessions, CLI | class-based auto-discovery | file-system routing, hot reload | `registerTool` + zod |
| Downloads / last publish | 351k/wk, 2026-10-20 | 34k/wk, 2026-04-16 | 7.5k/wk, 2026-10-14 | 8.2M/wk |
| Verdict | Great DX, **wrong protocol generation** — README redirects to ViteMCP | stale since April | nicest "many tools" story, but opinionated hosting | **Default** |

**Recommendation: official v2 SDK.** The tool surface is generated from an operations registry, so file-system routing fights the design.

---

## 3. Tool design for LLM agents

### 3.1 What Anthropic actually says

From *Writing effective tools for agents* (Sep 2025), *advanced tool use* (Nov 2025), *Code execution with MCP* (Nov 2025):

- **Naming**: all examples are **snake_case**. No stated casing rule — pick snake_case. **Namespace by service/resource**; prefix vs suffix has effects that "vary by LLM" — test it.
- **Descriptions are prompts.** "Think of how you would describe your tool to a new hire." Prefer `user_id` over `user`. "Even small refinements to tool descriptions can yield dramatic improvements."
- **Granularity**: "More tools don't always lead to better outcomes"; don't wrap every endpoint; "build a few thoughtful tools targeting specific high-impact workflows"; each needs "a clear, distinct purpose"; consolidate chains.
- **Token efficiency**: return high-signal fields, drop UUIDs/MIME types/raw URLs; expose a **`response_format` enum** (`concise` vs `detailed`); Claude Code caps tool responses at **25,000 tokens** by default.
- **Errors are instructions**: say what went wrong and what to try next.
- **Tool explosion**: Anthropic advocates selective design + namespacing + consolidation, **not** a meta-tool. Their platform answer is **deferral**: `defer_loading: true` + `tool_search_tool_regex_20251119`, and `allowed_callers: ["code_execution_20250825"]` (beta header `advanced-tool-use-2025-11-20`).
- From code-execution: exposing an MCP server as a **directory of typed TS modules** the agent imports on demand (progressive disclosure) collapsed 150k→2k tokens. **Ship a generated typed SDK alongside the MCP server.**

### 3.2 Concrete rules for an X/Twitter server

| Decision | Recommendation |
|---|---|
| Casing | `snake_case`, `resource_verb`: `tweets_search_recent`, `users_get`, `tweets_create`, `lists_add_member` |
| Granularity | **12–18 tools**, task-shaped. Never 1:1 with X's 100+ endpoints |
| Response shape | `response_format: 'concise' \| 'detailed'`, default `concise` |
| Pagination | `pagination_token` → `next_token: string \| null` in `structuredContent`, with "pass next_token to page" in the description |
| Long text | Return `resource_link` + 2–3 sentence summary; register `x://tweets/{id}` resource |
| Media | `image` blocks with base64 only for small thumbnails; otherwise file path/URL + mime, never inline video |
| Structured output | Always `outputSchema` + duplicate JSON in a text block |
| Writes | `destructiveHint: true`, `idempotentHint: false`; description says "show the text to the user before calling" |
| Error text | `{ isError: true, content: [{type:'text', text: 'Rate limited until 2026-10-21T14:03:00Z (x-rate-limit-reset). Retry after that, or narrow the query.' }] }` |

### 3.3 Avoiding tool explosion

Three layered techniques:
1. **Curate.** An agent doing X work needs ~15 verbs, not 100.
2. **Meta-tool / operations registry** (recommended): `operations_search({ query, limit })` returns `{ operations: [{ id, summary, input_schema }] }` (~400 tokens, never loads 100 schemas); `operations_invoke({ id, input })` dispatches. Ship the 8–12 hottest ops as **first-class tools**. Downside: two-hop latency and weaker typed contract.
3. **Client-side deferral.** With Claude, `defer_loading: true` + Tool Search Tool; with MCP-native hosts, emit `notifications/tools/list_changed` and gate sets behind a `profile` env var so a read-only server advertises 6 tools, not 40.

Opinionated call: **first-class curated tools + one `operations_search`/`operations_invoke` pair**, and the same registry generates the SDK for code-execution clients. Do not build 100 tools and hope `defer_loading` saves you — most hosts don't implement it yet.

---

## 4. CLI design in Node 2026

### 4.1 Parser choice

| Library | Latest | Notes |
|---|---|---|
| `util.parseArgs` | built-in | `strict`, `allowPositionals`, `allowNegative` (v22.4+), `multiple`, `short`, `default`, `tokens`. Zero deps, perfect for a **generated** flag set |
| `commander` | **15.0.0** | Node ≥ 22.12; best help/subcommand UX |
| `citty` | **0.2.2** | UnJS, tiny, lazy subcommands; still 0.x |
| `clipanion` | **4.0.0-rc.4** | RC since 2023–24 — don't start here |

**Recommendation:** `commander` 15 with a **generated option layer** from the registry. Keep `parseArgs` for a `--json` fast path and for tests.

### 4.2 Build tooling

- **`typescript` 7.0.2** — native Go port, GA 2026-07-08, 8–12× faster; `strict`/`esnext` now defaults; 7.1 beta (2026-10-20) restores a **stable programmatic API**.
- **`tsup` 9.0.0** — esbuild bundling, shebang preservation. Caveat: reports say `rollup-plugin-dts` crashes against the TS 7 API; workaround `dts: false` + `tsc --emitDeclarationOnly` + postbuild `.js` extension pass. **UNVERIFIED for tsup 9** (report was on 8.5.1) — verify before adopting.
- **ESM-only.** `require(esm)` is stable in Node 24.15+. Set `"type": "module"`, single `import` export condition, `engines.node: ">=24"`.
- **`node --experimental-strip-types`** not needed on Node ≥ 22.18. Constraints: **erasable syntax only** (no `enum`, no parameter properties, no runtime namespaces; `import type` required; `.ts` extensions in relative imports), and stripping does not apply under `node_modules` — dev convenience, never the publish strategy. Set `"erasableSyntaxOnly": true`.

### 4.3 Workspaces and releases

- **pnpm 12.14.0** — strict `node_modules`, `catalog:`, `workspace:*`.
- **`@changesets/cli` 3.0.3** — needs npm ≥ 10.9, node `^22.11 || ^24 || >=26`, pnpm ≥ 10. Use `changesets/action` for a release PR.
- `publint` + `@arethetypeswrong/cli` in CI to catch `exports`/`types` mistakes.

### 4.4 `npx`-friendly packaging

```json
{
  "name": "@scope/x",
  "type": "module",
  "bin": { "x": "./dist/cli.js" },
  "files": ["dist"],
  "engines": { "node": ">=24" },
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }
}
```

- Shebang `#!/usr/bin/env node`, executable bit set at build time.
- **No `postinstall`**, no native compile step — strongest argument for `node:sqlite` and `@napi-rs/keyring` (ships prebuilds for win32-x64/ia32/arm64, darwin-x64/arm64, linux gnu/musl incl. riscv64).
- Lazy-import heavy modules inside command handlers to keep cold start low.

---

## 5. The operations registry: one definition → CLI + SDK + MCP

### 5.1 Design

Everything derived at **runtime** from one array. No codegen, no drift.

```ts
// packages/ops/src/types.ts
import type * as z from 'zod/v4';

export type RateClass = 'read' | 'search' | 'write' | 'media';

export interface OpContext {
  readonly profile: string;
  readonly signal: AbortSignal;
  readonly log: (msg: string, fields?: Record<string, unknown>) => void;
}

export interface Operation<Id extends string, In extends z.ZodObject<z.ZodRawShape>, Out extends z.ZodType> {
  readonly id: Id;                       // 'tweets.search_recent' — stable SDK key
  readonly mcpName?: string;             // defaults to id with '.' -> '_'
  readonly summary: string;              // one line: CLI help + MCP title
  readonly description: string;          // long form: MCP description only
  readonly input: In;
  readonly output: Out;
  readonly rateClass: RateClass;
  readonly annotations: {
    readOnlyHint: boolean; destructiveHint: boolean;
    idempotentHint: boolean; openWorldHint: boolean;
  };
  readonly run: (ctx: OpContext, input: z.output<In>) => Promise<z.output<Out>>;
}

export function defineOperation<const Id extends string, const In extends z.ZodObject<z.ZodRawShape>, const Out extends z.ZodType>(
  def: Operation<Id, In, Out>
): Operation<Id, In, Out> { return def; }
```

```ts
// packages/ops/src/registry.ts
export const registry = [
  defineOperation({
    id: 'tweets.search_recent',
    summary: 'Search X posts from the last 7 days',
    description: 'Search X posts ... supports operators from:, -is:retweet ... returns next_token for paging.',
    input: z.object({
      query: z.string().min(1).describe('X search query'),
      max_results: z.coerce.number().int().min(10).max(100).default(10),
      next_token: z.string().optional()
    }),
    output: z.object({
      tweets: z.array(z.object({ id: z.string(), text: z.string(), created_at: z.string() })),
      next_token: z.string().nullable(),
      result_count: z.number().int()
    }),
    rateClass: 'search',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run(ctx, { query, max_results, next_token }) {
      const page = await ctx.x.tweets.searchRecent({ query, maxResults: max_results, nextToken: next_token }, ctx);
      return { tweets: page.tweets, next_token: page.nextToken ?? null, result_count: page.tweets.length };
    }
  })
] as const;

export type Registry = (typeof registry)[number];
export type OpId = Registry['id'];
```

### 5.2 MCP projection

```ts
const mcpName = (op: Registry) => op.mcpName ?? op.id.replaceAll('.', '_'); // tweets_search_recent

export function registerOps(server: McpServer, ctx: OpContext, ops: readonly Registry[] = registry) {
  for (const op of ops) {
    server.registerTool(mcpName(op), {
      title: op.summary, description: op.description,
      inputSchema: op.input, outputSchema: op.output, annotations: op.annotations
    }, async (args) => {
      const out = await op.run(ctx, args as never);
      return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
    });
  }
}
```

### 5.3 CLI projection (zod → JSON Schema → flags)

```ts
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

export function addFlagsFromSchema(cmd: Command, schema: z.ZodObject<z.ZodRawShape>) {
  const js = z.toJSONSchema(schema, { io: 'input' }) as JsonSchema;
  for (const [key, prop] of Object.entries(js.properties ?? {})) {
    const flag = kebab(key);
    const required = js.required?.includes(key) ?? false;
    const desc = prop.description ?? '';
    switch (prop.type) {
      case 'boolean': cmd.option(`--${flag}`, desc); break;
      case 'array':   cmd.option(`--${flag} <value...>`, desc); break;
      case 'object':  cmd.option(`--${flag} <json>`, `${desc} (JSON)`); break;
      default:
        if (prop.enum) cmd.option(`--${flag} <${prop.enum.join('|')}>`, desc);
        else cmd.option(`--${flag} ${required ? '<value>' : '[value]'}`, desc);
    }
  }
}

export function commandFromOp(op: Registry): Command {
  const [group, verb] = op.id.split('.');
  return new Command(group).command(verb)
    .description(op.summary)
    .configureHelp({ showGlobalOptions: true })
    .action(async (opts, cmd) => {
      const parsed = op.input.safeParse(opts);
      if (!parsed.success) cmd.error(parsed.error.message);
      const out = await op.run(makeCtx(cmd), parsed.data as never);
      process.stdout.write(JSON.stringify(out, null, cmd.opts().json ? 2 : 0) + '\n');
    });
}
```

`x tweets search-recent --query "from:jack mcp" --max-results 20 --json` — camel→kebab falls out of the rule.

### 5.4 `parseArgs` variant

```ts
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: flagsFromSchema(op.input),
  strict: true, allowPositionals: true,
  allowNegative: true            // --no-include-metrics
});
```

Caveat: both projections lose **nested object** ergonomics. For any op with nesting, expose `--input <json>` / `--input -` (stdin) and let zod do the work.

### 5.5 SDK projection

```ts
type CallOptions = { signal?: AbortSignal; profile?: string };
type Method<O extends Registry> = (input: z.input<O['input']>, opts?: CallOptions) => Promise<z.output<O['output']>>;
export type XSdk = { [O in Registry as O['id']]: Method<O> };

export function createSdk(ctx: OpContext): XSdk {
  return Object.fromEntries(registry.map((op) => [
    op.id,
    (input: unknown, opts?: CallOptions) =>
      op.run({ ...ctx, profile: opts?.profile ?? ctx.profile, signal: opts?.signal ?? ctx.signal }, input as never)
  ])) as XSdk;
}
// await x['tweets.search_recent']({ query: 'mcp' })
```

A `Proxy` that splits on `.`/camelCase gives `x.tweets.searchRecent(...)` — 15 lines, cosmetic, and pleasant from a code-execution sandbox.

**Tests that keep this honest:** snapshot `JSON.stringify(await client.listTools())` and the full `--help` of the root CLI. Any registry change shows up as a reviewable diff.

---

## 6. Credential storage

### 6.1 Options

| Option | Status (2026-10) |
|---|---|
| `keytar` 7.9.0 | **Archived** (Atom sunset); unmaintained since Dec 2022. 1.7M weekly downloads are inertia. Do not use |
| `@napi-rs/keyring` **2.1.2** (2026-10-19) | **Recommended.** `keyring-rs` via napi-rs; prebuilds for win32-x64/ia32/arm64, darwin-x64/arm64, linux x64/arm64/riscv64/armhf (gnu + musl) |
| Windows Credential Manager / DPAPI | Reached *through* keyring; don't P/Invoke DPAPI yourself |
| macOS Keychain via `security` CLI | Works but leaks secrets in `argv` (visible in `ps`). Fallback only |
| Linux libsecret / Secret Service | keyring's default; falls back to **kernel keyutils**, which is in-memory and does not survive reboot — force `{ linux: { store: 'secret-service' } }` |
| `conf` / plain files | Config only — never tokens |

What `gh` does: token in the **system credential store** by default; if unavailable, plaintext file (visible in `gh auth status`); `--insecure-storage` opts in explicitly; `GH_TOKEN`/`GITHUB_TOKEN` env takes precedence. That's the template: keyring → explicit plaintext fallback with a loud warning → env override.

### 6.2 Recommended store

```ts
import { Entry } from '@napi-rs/keyring';
import { chmod, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  readonly kind: 'keyring' | 'file';
}

const SERVICE = 'x-cli';

export function keyringStore(): SecretStore {
  const entry = (k: string) => new Entry(SERVICE, k, { linux: { store: 'secret-service' } });
  return {
    kind: 'keyring',
    async get(k) { try { return entry(k).getPassword() ?? null; } catch { return null; } },
    async set(k, v) { entry(k).setPassword(v); },
    async delete(k) { try { entry(k).deletePassword(); } catch {} }
  };
}

export function fileStore(dir: string): SecretStore {
  const path = (k: string) => join(dir, `cred-${k.replace(/[^\w.-]/g, '_')}.json`);
  return {
    kind: 'file',
    async get(k) { try { return JSON.parse(await readFile(path(k), 'utf8')).secret ?? null; } catch { return null; } },
    async set(k, v) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(path(k), JSON.stringify({ secret: v }), { mode: 0o600 });
      await chmod(path(k), 0o600).catch(() => {});
    },
    async delete(k) { await unlink(path(k)).catch(() => {}); }
  };
}

export async function openStore(dir: string): Promise<SecretStore> {
  try {
    const s = keyringStore();
    const probe = `__probe_${process.pid}`;
    s.set(probe, '1'); s.delete(probe);
    return s;
  } catch {
    process.stderr.write('warning: OS keychain unavailable; storing credentials in a 0600 file\n');
    return fileStore(dir);
  }
}
```

Honest caveats:
- On **Windows, `fs.chmod` only toggles the read-only bit** — `0600` gives no ACL isolation. Need DPAPI (through keyring) or `icacls`. A self-encrypted file whose key sits next to it is obfuscation, not security — say so in docs.
- **WSL / headless Linux / CI**: keyring throws or lands in keyutils. Detect, fall back, support `X_TOKEN` env.
- Store **refresh tokens**, not just access tokens; X OAuth2 tokens rotate.

---

## 7. Rate limiting, queueing, retry

### 7.1 What X gives you

Every response carries `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset` (**Unix seconds**, not a duration). On exhaustion: **HTTP 429**, error `code: 88`. Limits are **per endpoint group per user/App**, so the bucket key is `(profile, endpointGroup)`.

### 7.2 Architecture

```
op call ──► dedupe cache ──► persistent queue (SQLite) ──► scheduler ──► token bucket (profile, bucket) ──► undici
                  │                    │                          │
             hit: return        survives Ctrl-C / crashes    global concurrency semaphore (default 4)
```

**Token bucket, seeded from headers:**

```ts
interface Bucket { limit: number; remaining: number; resetAt: number }

function acquire(b: Bucket, now = Date.now()): number {
  if (now >= b.resetAt) { b.remaining = b.limit; b.resetAt = now + 15 * 60_000; }
  if (b.remaining > 0) { b.remaining--; return 0; }
  return b.resetAt - now;
}
```

Overwrite the bucket from headers after every response — never trust your own arithmetic across processes.

**Persistent queue** (`node:sqlite`, WAL, one writer):

```sql
CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY,
  profile TEXT NOT NULL,
  op TEXT NOT NULL,
  bucket TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',  -- pending|inflight|done|dead
  attempts INTEGER NOT NULL DEFAULT 0,
  not_before INTEGER NOT NULL DEFAULT 0,  -- epoch ms
  dedupe_key TEXT UNIQUE
) STRICT;
CREATE INDEX IF NOT EXISTS queue_ready ON queue(state, not_before);
```

Claims: `UPDATE queue SET state='inflight' WHERE id=(SELECT id FROM queue WHERE state='pending' AND not_before<? ORDER BY not_before LIMIT 1) RETURNING *` — single writer, safe without a broker.

**Retry with full jitter + reset awareness:**

```ts
const base = 500, cap = 60_000;
function backoff(attempt: number, resetAt?: number, now = Date.now()) {
  if (resetAt && resetAt > now) return resetAt - now + 250;
  const ceiling = Math.min(cap, base * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}
```

Retry on `429`, `5xx`, `ECONNRESET`, `UND_ERR_HEADERS_TIMEOUT`. **Never retry non-idempotent writes** on timeout or 5xx — the tweet may already exist. Retry writes only on 429, where the request provably didn't execute.

**Concurrency:** `p-queue` 10.0.0 with `concurrency: 4`, plus a per-bucket semaphore of 1 for writes.

**Dedupe / caching for reads:**
- Cache key `sha256(op.id + canonicalJson(input) + profile)`; canonicalize by sorting keys.
- In-flight map: identical concurrent reads share one promise.
- TTL by `rateClass` (`read` → 60s, `search` → 30s); `cache` table with `expires_at`; sweep on startup.
- Respect `ETag`/`If-None-Match`; a `304` refreshes TTL free.
- Never cache writes; invalidate dependent reads after `tweets.create`.

### 7.3 `node:sqlite` vs `better-sqlite3`

| | `node:sqlite` (RC) | `better-sqlite3` 13.0.3 |
|---|---|---|
| Install | none | prebuilt native addon |
| API | `DatabaseSync` (Node 26.11 renames to `Database`) | `Database` |
| Transactions | **no `.transaction()`** — write a BEGIN/COMMIT wrapper | `.transaction()` incl. savepoints |
| Perf | ~0.8–0.95× reads; large result sets 1.4–2.2× slower | fastest |
| Risk | API still RC; class renamed in 26.11 | ABI/rebuild friction, `npx` weight |

**Recommendation:** `node:sqlite` behind a 6-method adapter (`open/migrate/claim/done/fail/cacheGet`) — an `npx`-first CLI must not ship a native addon. Pin `engines`; add adapter tests so swapping is a 40-line change.

---

## 8. Multi-account design

| Tool | Model |
|---|---|
| `gh` | Accounts **per host**; token in OS credential store; `gh auth switch --hostname H --user U`; env overrides |
| `aws` | `~/.aws/credentials` + `config` profiles; `AWS_PROFILE`; `--profile` |
| `gcloud` | Named **configurations**, each with its own project/account |

Design for `x`:

```
~/.config/x/                         # XDG-aware; %APPDATA%\x on Windows
├── config.json                      # active_profile, defaults, output format
└── profiles/
    ├── work/profile.json            # { handle, userId, authType: 'oauth2', scopes, createdAt }
    └── personal/profile.json
```

- **Secrets in the keyring**, keyed `x-cli` / `oauth2:<profile>` — never in `profile.json`. The file holds non-secret metadata so `x auth list` is fast and offline.
- Resolution: `--profile` flag → `X_PROFILE` env → `config.json:active_profile` → `"default"`.
- Commands: `x auth login [--profile work]`, `x auth switch <profile>`, `x auth list`, `x auth logout`.
- **Per-profile rate buckets and queues** — independent quotas; one exhausted account must not stall another.
- **MCP mapping:** one server instance per profile, configured separately:
  ```json
  { "mcpServers": {
      "x-work":     { "type": "stdio", "command": "npx", "args": ["-y", "@scope/x-mcp"], "env": { "X_PROFILE": "work" } },
      "x-personal": { "type": "stdio", "command": "npx", "args": ["-y", "@scope/x-mcp"], "env": { "X_PROFILE": "personal" } }
  } }
  ```
  Do **not** add a `profile` parameter to every tool — it costs tokens on every definition and the model picks wrong. If needed, expose it only on `operations_invoke` and `x_accounts_list`.

---

## 9. Testing

### 9.1 MCP server

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';

const handler = createMcpHandler(() => buildServer());
const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
  fetch: (url, init) => handler.fetch(new Request(url, init))
});
const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
await client.connect(transport);

const res = await client.callTool({ name: 'tweets_search_recent', arguments: { query: 'mcp' } });
expect(res.structuredContent).toMatchObject({ result_count: 1 });
await client.close(); await handler.close();
```

- **Legacy-era pair:** `InMemoryTransport.createLinkedPair()` — both halves and server must come from the **same package's** import.
- **stdio coverage:** `new StdioClientTransport({ command: 'node', args: ['dist/mcp.js'] })` — assert nothing pollutes stdout.
- **Snapshot `tools/list`** — catches schema/name/description drift, the #1 silent regression in agent tooling.
- **Error paths:** assert `isError: true` + message text for schema violations, 429, 404 — the message *is* the product.
- `npx @modelcontextprotocol/inspector` for manual exploration.

### 9.2 Core/HTTP layer

- **`msw` 3.0.3** — intercepts `fetch`/undici, works for SDK and CLI; prefer over `nock` (hooks `http`/`https`, awkward with `fetch`).
- **Recorded fixtures**: capture real payloads once into `fixtures/<op>/<case>.json`; one `contract` test per op validates the fixture against `op.output`.
- **Queue/time**: inject `now()` and a fake clock; assert `not_before` for a 429 with `x-rate-limit-reset`, and that non-idempotent writes are *not* retried.
- **CLI**: `execa` against `dist/cli.js`; snapshot `--help`, `--version`, `--json`; assert exit codes (`cmd.error` → 1, validation → 2).
- **Type tests**: `expectTypeOf` on `XSdk` so the registry→SDK mapping can't silently widen to `any`.

### 9.3 Browser path (Playwright)

- `@playwright/test` 1.64.1; `storageState` saved once by `auth.setup.ts`, reused via `use: { storageState }`.
- Keep it in a **separate workspace** (`packages/browser`) — Playwright must never become a runtime dep of the CLI or MCP server.
- Run nightly, not per PR; browser paths break on UI churn.

---

## 10. Distribution

### 10.1 npm

```bash
pnpm build && pnpm changeset version && pnpm -r publish --access public --provenance
```

- `--provenance` requires GitHub Actions OIDC; add `"publishConfig": { "access": "public", "provenance": true }`.
- Verify `npx` before release: `npm pack && npx ./scope-x-0.1.0.tgz --help`, plus `publint` and `attw --pack`.
- **Two bins**: `x` (CLI) and `x-mcp` (MCP server), or one bin with an `mcp` subcommand. Ship both.
- **GitHub Releases**: changesets/action opens "Version Packages"; on merge it publishes and tags.

### 10.2 Installing the MCP server into hosts

**Claude Code:**

```bash
# stdio, user scope
claude mcp add --transport stdio x --scope user -- npx -y @scope/x-mcp

# with env (e.g. profile)
claude mcp add --env X_PROFILE=work --transport stdio x -- npx -y @scope/x-mcp

# remote
claude mcp add --transport http x https://x.example.com/mcp --header "Authorization: Bearer …"

# from raw JSON
claude mcp add-json x '{"type":"stdio","command":"npx","args":["-y","@scope/x-mcp"]}' --scope user
```

`--` is mandatory; everything after goes to the server untouched. Scopes: `local` (default), `project` (`.mcp.json`), `user`. Verify with `claude mcp list` / `claude mcp get x`.

**`.mcp.json` shape:**

```json
{
  "mcpServers": {
    "x": { "type": "stdio", "command": "npx", "args": ["-y", "@scope/x-mcp"], "env": { "X_PROFILE": "default" } },
    "x-hosted": { "type": "http", "url": "https://x.example.com/mcp", "headers": { "Authorization": "Bearer ${X_TOKEN}" } }
  }
}
```

Gotchas: an entry with `url` but **no `type`** is a config error (no-`type` means stdio); `"streamable-http"` is an alias for `"http"`; `${VAR}` and `${VAR:-default}` expand in `command`, `args`, `env`, `url`, `headers`.

**Claude Desktop**: same `mcpServers` object in `claude_desktop_config.json` — `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Desktop launches with a minimal PATH — use the absolute path to `npx.cmd` if needed.

**`npx` cold start** is the main UX risk — the host's startup timeout can fire while npm resolves. Mitigations: tiny dependency tree, lazy imports, document a global-install alternative.

---

## 11. Recommended monorepo layout

```
twitterxapimcp/
├── pnpm-workspace.yaml            # catalog: zod, typescript, commander, ...
├── packages/
│   ├── core/                      # HTTP client, auth, rate limiter, queue, multi-account
│   ├── ops/                       # <- the registry: schemas + run() + metadata (§5)
│   ├── sdk/                       # createSdk() over ops
│   ├── cli/                       # commander over ops -> bin: x
│   ├── mcp/                       # McpServer over ops -> bin: x-mcp
│   └── browser/                   # optional Playwright-only helpers (never a runtime dep)
├── examples/
└── .changeset/
```

Dependency direction strictly `core ← ops ← {sdk, cli, mcp}`. `ops` must not import `commander`, `@modelcontextprotocol/*`, or `undici` — that's what keeps one definition projecting into three surfaces.

---

## 12. Final recommendation

**MCP SDK v2 (`@modelcontextprotocol/server` 2.3.1) with zod 4.6.7, an ESM-only pnpm 12 monorepo, an operations registry as the single source of truth, `commander` 15 + generated flags, `tsc` 7.0.2 for types, `tsup` 9 for the bundle, `@napi-rs/keyring` with a `0600` fallback, and a `node:sqlite`-backed queue with header-seeded token buckets.**

Watch next quarter:
1. **Node 26 becomes Active LTS 2026-10-28**; Node 24 moved to maintenance 2026-10-20. Set `engines.node: ">=24"` now. Note `DatabaseSync` → `Database` rename in 26.11.
2. **TypeScript 7.1** (beta 2026-10-20) restores the programmatic API.

### UNVERIFIED / needs a local check
- Whether `tsup` **9.0.0**'s dts pipeline works against the TS 7 API (crash report was on 8.5.1).
- `xmcp`'s exact support for `2026-07-28` (inferred from peer range).
- ViteMCP's npm package name/version.
- Node 26 removing `--experimental-transform-types` (third-party commit message).
- Windows `fs.chmod` ACL semantics (well-established, but verify).

### Sources
- MCP SDK: github.com/modelcontextprotocol/typescript-sdk (README, docs/servers/tools.md, docs/serving/stdio.md, docs/serving/http.md, docs/testing.md, docs/protocol-versions.md, docs/migration/upgrade-to-v2.md)
- Anthropic: anthropic.com/engineering/writing-tools-for-agents · /code-execution-with-mcp · /advanced-tool-use · simonwillison.net/2025/Nov/4/code-execution-with-mcp/
- Frameworks: github.com/punkpeye/fastmcp · QuantGeekDev/mcp-framework · basementstudio/xmcp · vitemcp/server
- Node: nodejs.org/learn/typescript/run-natively · nodejs.org/api/util.html#utilparseargsconfig · nodejs.org/docs/latest-v24.x/api/sqlite.html
- TypeScript: devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- Credentials: github.com/atom/node-keytar (archived) · npm @napi-rs/keyring · cli.github.com/manual/gh_auth_login · gh_auth_switch
- X API: docs.x.com/x-api/fundamentals/rate-limits
- Hosts: code.claude.com/docs/en/mcp
- SQLite: whoooop.co.uk/blog/node-sqlite-vs-better-sqlite3 · photostructure.github.io/node-sqlite/media/README.md
