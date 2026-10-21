// Smoke test: drive the MCP server over stdio, exactly as a host would.
import { spawn } from 'node:child_process';

const entry = process.env.MCP_ENTRY ?? 'packages/mcp/dist/index.js';

const child = spawn(process.execPath, [entry], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer = '';
let step = 0;

function send(message) {
  child.stdin.write(JSON.stringify(message) + '\n');
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

    if (msg.id === 1) {
      const info = msg.result?.serverInfo ?? {};
      console.log(`initialize ok: ${info.name ?? '?'} ${info.version ?? ''} protocol=${msg.result?.protocolVersion ?? '?'}`);
      send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      step = 2;
    } else if (msg.id === 2) {
      const tools = msg.result?.tools ?? [];
      console.log(`tools/list ok: ${tools.length} tools`);
      for (const tool of tools) {
        console.log(`  - ${tool.name}  [${tool.annotations?.readOnlyHint ? 'read' : 'write'}]`);
      }
      child.kill();
      process.exit(tools.length > 0 ? 0 : 1);
    } else if (msg.error) {
      console.error('error:', JSON.stringify(msg.error));
      child.kill();
      process.exit(1);
    }
  }
});

child.on('exit', (code) => {
  if (step < 2) {
    console.error(`server exited early with code ${code}`);
    process.exit(1);
  }
});

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'xctl-smoke', version: '0.0.1' },
  },
});

setTimeout(() => {
  console.error('timeout waiting for MCP handshake');
  child.kill();
  process.exit(1);
}, 10_000).unref();
