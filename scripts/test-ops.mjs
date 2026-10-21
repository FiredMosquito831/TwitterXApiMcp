// Operation behavior with a fake transport. No network.
import assert from 'node:assert/strict';
import { registry } from '../packages/ops/dist/index.js';
import { SpendMeter, PRICE } from '../packages/core/dist/index.js';

const byId = Object.fromEntries(registry.map((op) => [op.id, op]));

function makeCtx({ cap = 5, handler } = {}) {
  const calls = [];
  const ctx = {
    profile: 'test',
    transport: {
      kind: 'official',
      async call(req) {
        calls.push(req);
        if (handler) return handler(req);
        return { status: 200, data: { data: { id: '1', text: 'ok' } }, headers: new Headers() };
      },
    },
    limiter: {
      async acquire() {},
      observe() {},
      snapshot() {
        return {};
      },
    },
    spend: new SpendMeter({ capUsd: cap }),
    signal: new AbortController().signal,
    log: () => {},
  };
  return { ctx, calls };
}

async function run(id, input, options) {
  const { ctx, calls } = makeCtx(options);
  const parsed = byId[id].input.parse(input);
  const result = await byId[id].run(ctx, parsed);
  return { result, calls, ctx };
}

// --- posts.create request shape -------------------------------------------
{
  const { result, calls, ctx } = await run('posts.create', { text: 'hello world' });
  assert.equal(result.id, '1');
  assert.equal(result.cost_usd, PRICE['post.create']);
  assert.equal(ctx.spend.total(), PRICE['post.create']);
  const call = calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.path, '/2/tweets');
  assert.deepEqual(call.body, { text: 'hello world' });
}

// --- link post pricing -----------------------------------------------------
{
  const { result } = await run('posts.create', { text: 'read https://example.com' });
  assert.equal(result.cost_usd, PRICE['post.create_url']);
}

// --- dry run performs no request ------------------------------------------
{
  const { result, calls } = await run('posts.create', { text: 'hello', dry_run: true });
  assert.equal(result.dry_run, true);
  assert.equal(calls.length, 0);
}

// --- spend cap blocks the write -------------------------------------------
{
  await assert.rejects(
    run('posts.create', { text: 'expensive' }, { cap: 0.001 }),
    /Spend cap would be exceeded/,
  );
}

// --- reply and poll body ---------------------------------------------------
{
  const { calls } = await run('posts.create', {
    text: 'answer',
    reply_to: '42',
    poll: { options: ['a', 'b'], duration_minutes: 60 },
  });
  assert.deepEqual(calls[0].body.reply, { in_reply_to_tweet_id: '42' });
  assert.deepEqual(calls[0].body.poll, { options: ['a', 'b'], duration_minutes: 60 });
}

// --- thread rollback deletes published segments ----------------------------
{
  let posts = 0;
  const { calls } = await run(
    'posts.thread',
    { segments: ['one', 'two', 'three'] },
    {
      handler(req) {
        if (req.method === 'POST') {
          posts += 1;
          if (posts === 2) throw new Error('boom');
          return { status: 201, data: { data: { id: `id${posts}` } }, headers: new Headers() };
        }
        return { status: 200, data: { data: { deleted: true } }, headers: new Headers() };
      },
    },
  ).then(
    () => {
      throw new Error('thread should have failed');
    },
    (err) => {
      assert.match(err.message, /boom/);
      return { calls: null };
    },
  );

  // Re-run to inspect the calls after the rejection.
  const recorded = [];
  let n = 0;
  const ctxRun = makeCtx({
    handler(req) {
      recorded.push(req);
      if (req.method === 'POST') {
        n += 1;
        if (n === 2) throw new Error('boom');
        return { status: 201, data: { data: { id: `id${n}` } }, headers: new Headers() };
      }
      return { status: 200, data: { data: { deleted: true } }, headers: new Headers() };
    },
  });
  await assert.rejects(
    byId['posts.thread'].run(ctxRun.ctx, byId['posts.thread'].input.parse({ segments: ['one', 'two'] })),
  );
  const deletes = recorded.filter((req) => req.method === 'DELETE');
  assert.equal(deletes.length, 1, 'one published segment must be rolled back');
  assert.equal(deletes[0].path, '/2/tweets/id1');
  assert.ok(calls === null);
}

// --- search query parameters ----------------------------------------------
{
  const { result } = await run(
    'posts.search_recent',
    { query: 'from:jack mcp', max_results: 10 },
    {
      handler(req) {
        assert.equal(req.query.query, 'from:jack mcp');
        assert.equal(req.query.max_results, 10);
        return {
          status: 200,
          data: { data: [{ id: '9', text: 'hit' }], meta: { result_count: 1 } },
          headers: new Headers(),
        };
      },
    },
  );
  assert.equal(result.posts.length, 1);
  assert.equal(result.next_token, null);
}

// --- analytics aggregation -------------------------------------------------
{
  const { result } = await run(
    'analytics.account',
    { max_posts: 10 },
    {
      handler(req) {
        if (req.path.endsWith('/tweets')) {
          return {
            status: 200,
            data: {
              data: [
                { id: '1', text: 'a', public_metrics: { like_count: 10, retweet_count: 5, reply_count: 2, quote_count: 1 } },
                { id: '2', text: 'b', public_metrics: { like_count: 1, retweet_count: 1, reply_count: 1, quote_count: 0 } },
              ],
            },
            headers: new Headers(),
          };
        }
        return { status: 200, data: { data: { id: 'me', username: 'tester', name: 'Tester' } }, headers: new Headers() };
      },
    },
  );
  assert.equal(result.totals.posts, 2);
  assert.equal(result.totals.likes, 11);
  assert.equal(result.totals.reposts, 6);
  assert.equal(result.totals.replies, 3);
  assert.equal(result.engagement_rate, null);
}

console.log('operation tests ok');
