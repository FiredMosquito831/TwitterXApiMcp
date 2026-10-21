// Core primitives: PKCE, pricing, rate limiting, state, cookies, materials.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import {
  BucketLimiter,
  codeChallenge,
  openState,
  postCreatePrice,
  SpendMeter,
  PRICE,
} from '../packages/core/dist/index.js';
import {
  parseCookies,
  userIdFromCookies,
  extractMaterials,
  parseFramePath,
  createTransactionGenerator,
  parseOperations,
} from '../packages/unofficial/dist/index.js';

// --- PKCE: RFC 7636 appendix B vector ---------------------------------------
assert.equal(
  codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  'PKCE S256 challenge must match the RFC vector',
);

// --- pricing ---------------------------------------------------------------
assert.equal(postCreatePrice('hello'), PRICE['post.create']);
assert.equal(postCreatePrice('see https://example.com'), PRICE['post.create_url']);
assert.equal(postCreatePrice('a reply', true), PRICE['post.reply_summoned']);
assert.ok(PRICE['post.create_url'] / PRICE['post.create'] > 13, 'links must cost ~13x');

// --- spend cap -------------------------------------------------------------
const meter = new SpendMeter({ capUsd: 0.02 });
meter.assertWithinCap(0.015);
meter.record(0.015, 'test');
assert.equal(meter.total(), 0.015);
assert.throws(() => meter.assertWithinCap(0.015), /Spend cap would be exceeded/);

// --- rate limiter seeds from headers ---------------------------------------
let slept = 0;
const limiter = new BucketLimiter({ sleep: async (ms) => { slept += ms; } });
limiter.observe('tweets', new Headers({
  'x-rate-limit-limit': '2',
  'x-rate-limit-remaining': '1',
  'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 60),
}));
await limiter.acquire('tweets'); // uses remaining
await limiter.acquire('tweets'); // must wait for the reset
assert.ok(slept > 1000, 'limiter should wait when the bucket is empty');
assert.equal(limiter.snapshot()['tweets'].limit, 2);

// --- persistent state ------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'xctl-test-'));
const state = await openState(join(dir, 'state.db'));
assert.equal(await state.claimDedupe('k', 60_000), true);
assert.equal(await state.claimDedupe('k', 60_000), false, 'second claim must be rejected');
await state.recordSpend('p', 0.5, 'x');
assert.equal(await state.spendTotal('p', 0), 0.5);
await state.setBucket('p', 'tweets', { limit: 10, remaining: 9, resetAt: Date.now() + 1000 });
assert.equal((await state.getBucket('p', 'tweets')).remaining, 9);
const id = await state.queueAdd('p', 'posts.create', { text: 'hi' }, Date.now() - 1);
const due = await state.queueDue(Date.now());
assert.equal(due.length, 1);
await state.queueMark(id, 'done', '{}');
assert.equal((await state.queueDue(Date.now())).length, 0);
await state.close();

// --- cookie parsing --------------------------------------------------------
const editor = parseCookies(JSON.stringify([
  { name: 'auth_token', value: 'a' },
  { name: 'ct0', value: 'c' },
  { name: 'twid', value: 'u%3D42' },
]));
assert.equal(editor.auth_token, 'a');
assert.equal(userIdFromCookies(editor), '42');

const header = parseCookies('auth_token=a; ct0=c; kdt=k');
assert.equal(header.ct0, 'c');
assert.equal(header.kdt, 'k');

const storage = parseCookies({ cookies: [{ name: 'auth_token', value: 'a' }, { name: 'ct0', value: 'c' }] });
assert.equal(storage.auth_token, 'a');

assert.throws(() => parseCookies('auth_token=a'), /missing auth_token and\/or ct0/);

// --- transaction materials and id generation ------------------------------
const key = Buffer.from(Array.from({ length: 48 }, (_, i) => i)).toString('base64');
const segment = '1 2 3 4 5 6 7 8 9 10 11 12';
const path = 'M10 20C' + Array.from({ length: 8 }, () => segment).join('C');
const frames = Array.from(
  { length: 4 },
  (_, i) => `<svg id="loading-x-anim-${i}"><g><path d="${path}"/><path d="${path}"/></g></svg>`,
).join('');
const html = `<html><head><meta name="twitter-site-verification" content="${key}">
<script src="https://abs.twimg.com/responsive-web/client-web/ondemand.s.test.js"></script></head>
<body>${frames}</body></html>`;
const { document } = parseHTML(html);
const materials = extractMaterials(html, document);
assert.equal(materials.key, key);
assert.equal(materials.keyBytes.length, 48);
assert.equal(materials.framePaths.length, 4);
const rows = parseFramePath(materials.framePaths[0]);
assert.ok(rows.length >= 8, 'each C segment must become a row');
assert.ok(rows[0].length >= 8, 'a row must carry the curve values');

const fakeFetch = async (url) => ({
  ok: true,
  headers: new Headers(),
  text: async () =>
    String(url).endsWith('.js') ? '(a[5], 16); (a[9], 16); (a[3], 16);' : '',
});
const generator = await createTransactionGenerator(html, {
  fetchImpl: fakeFetch,
  cookieHeader: 'auth_token=a; ct0=c',
});
const tid = generator.generate('POST', '/i/api/graphql/x/CreateTweet', 1_700_000_000);
assert.match(tid, /^[A-Za-z0-9+/]+$/, 'transaction id must be unpadded base64');
assert.equal(tid.length, 94, '48-byte key must produce a 94-char transaction id');
assert.notEqual(
  generator.generate('POST', '/i/api/graphql/x/CreateTweet', 1_700_000_000),
  tid,
  'each transaction id must include fresh randomness',
);

// --- operation-id discovery regexes ---------------------------------------
{
  const found = new Map();
  parseOperations(
    '{queryId:"abc12345", operationName:"CreateTweet", operationType:"mutation", metadata:{}}',
    found,
  );
  assert.equal(found.get('CreateTweet').queryId, 'abc12345');
  assert.equal(found.get('CreateTweet').operationType, 'mutation');

  const params = new Map();
  parseOperations('params:{id:"zzz99999",name:"FavoriteTweet",operationKind:"mutation"}', params);
  assert.equal(params.get('FavoriteTweet').queryId, 'zzz99999');
}

console.log('core tests ok');
