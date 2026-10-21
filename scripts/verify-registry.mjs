// Structural checks on the operation registry. No network, no credentials.
import { registry } from '../packages/ops/dist/index.js';
import { unofficialRegistry } from '../packages/unofficial/dist/index.js';

const ops = [...registry, ...unofficialRegistry];
const problems = [];

const ids = new Set();
const mcpNames = new Set();

for (const op of ops) {
  if (ids.has(op.id)) problems.push(`duplicate id: ${op.id}`);
  ids.add(op.id);

  if (mcpNames.has(op.mcpName)) problems.push(`duplicate mcpName: ${op.mcpName}`);
  mcpNames.add(op.mcpName);

  if (!/^[a-z][a-z0-9_]*$/.test(op.mcpName)) problems.push(`mcpName not snake_case: ${op.mcpName}`);
  if (!op.summary || op.summary.length > 160) problems.push(`${op.id}: summary missing or too long`);
  if (!op.description || op.description.length < 40) problems.push(`${op.id}: description too short for an LLM`);
  if (typeof op.cost !== 'function') problems.push(`${op.id}: no cost function`);
  if (!op.transports.length) problems.push(`${op.id}: no transports`);

  const isWrite = !op.annotations.readOnlyHint;
  if (!isWrite && op.annotations.destructiveHint) problems.push(`${op.id}: read op marked destructive`);
  if (isWrite && !op.transports.includes('unofficial') && typeof op.cost !== 'function') {
    problems.push(`${op.id}: official write has no cost function`);
  }
  if (op.transports.includes('unofficial') && !op.description.includes('UNOFFICIAL')) {
    problems.push(`${op.id}: unofficial op must warn in its description`);
  }

  // Every schema must reject an unknown-only object unless it is intentionally empty.
  const empty = op.input.safeParse({});
  const acceptsUnknown = op.input.safeParse({ __nope: 1 }).success;
  if (acceptsUnknown && !empty.success) {
    problems.push(`${op.id}: accepts unknown input but rejects empty input`);
  }
}

if (problems.length) {
  console.error('registry check failed:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

console.log(
  `registry ok: ${registry.length} official + ${unofficialRegistry.length} unofficial = ${ops.length} operations`,
);
