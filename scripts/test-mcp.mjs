// MCP end-to-end: handshake, tools/list, operations_search, operations_invoke.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const entry = process.env.MCP_ENTRY ?? 'packages/mcp/dist/index.js';

const child = spawn(process.execPath, [entry], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, XCTL_HOME: process.env.XCTL_HOME ?? '' },
});

let buffer = '';
let nextId = 1;
const pending = new Map();

function call(method, params) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return promise;
}

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  }
});

const timeout = setTimeout(() => {
  console.error('MCP test timed out');
  child.kill();
  process.exit(1);
}, 20_000);

const init = await call('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'xctl-test', version: '0.1.0' },
});
assert.equal(init.serverInfo.name, 'xctl');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

const tools = await call('tools/list', {});
const names = tools.tools.map((t) => t.name);
assert.ok(names.includes('posts_create'), 'posts_create must be registered');
assert.ok(names.includes('operations_search'), 'operations_search must be registered');
assert.ok(!names.includes('likes_add'), 'unofficial tools must stay hidden by default');

const search = await call('tools/call', {
  name: 'operations_search',
  arguments: { query: 'posts', limit: 5 },
});
assert.ok(search.structuredContent.operations.length > 0);
assert.ok(search.structuredContent.operations.every((op) => op.id.startsWith('posts.')));

const dry = await call('tools/call', {
  name: 'operations_invoke',
  arguments: { id: 'posts.create', input: { text: 'hello from mcp', dry_run: true } },
});
assert.equal(dry.structuredContent.result.dry_run, true);
assert.equal(dry.structuredContent.result.cost_usd, 0.015);

const missing = await call('tools/call', {
  name: 'operations_invoke',
  arguments: { id: 'posts.create', input: { text: 'x'.repeat(30_000) } },
});
assert.equal(missing.isError, true, 'oversized input must be rejected before any request');

clearTimeout(timeout);
child.kill();
console.log(`mcp tests ok (${tools.tools.length} tools)`);
process.exit(0);
