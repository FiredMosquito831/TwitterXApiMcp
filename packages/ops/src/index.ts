export { registry, type Registry, type OpId } from './registry.js';
export {
  defineOperation,
  type AnyOperation,
  type Operation,
  type ToolAnnotations,
} from './types.js';

import { registry } from './registry.js';
import type { AnyOperation } from './types.js';

/** Look up an operation by `group.verb` or by MCP name. */
export function findOperation(id: string): AnyOperation | undefined {
  return registry.find((op) => op.id === id || op.mcpName === id);
}

/** Operations grouped by their `group` segment, preserving registry order. */
export function groupOperations(): Map<string, AnyOperation[]> {
  const groups = new Map<string, AnyOperation[]>();
  for (const op of registry as readonly AnyOperation[]) {
    const [group = op.id] = op.id.split('.');
    const list = groups.get(group) ?? [];
    list.push(op);
    groups.set(group, list);
  }
  return groups;
}
