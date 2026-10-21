#!/usr/bin/env node
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
  createRuntime,
  loadConfig,
  VERSION,
  XApiError,
  type OpContext,
} from '@xctl/core';
import { registry, type AnyOperation } from '@xctl/ops';

/**
 * Tools are registered eagerly so `tools/list` works without credentials, but
 * the runtime (and its token) is built on first call.
 */
/**
 * One runtime for the whole process. Built with allowMissingToken so
 * unofficial and dry-run tools work without OAuth; official tools check
 * `hasToken` themselves. This also avoids opening two SQLite connections.
 */
let cached: Promise<OpContext> | undefined;

function runtime(): Promise<OpContext> {
  cached ??= createRuntime({
    profile: process.env['X_PROFILE'] ?? 'default',
    ...(process.env['XCTL_SPEND_CAP'] ? { spendCapUsd: Number(process.env['XCTL_SPEND_CAP']) } : {}),
    allowMissingToken: true,
  });
  return cached;
}

async function withWeb(op: AnyOperation, allowMissingToken = false): Promise<OpContext> {
  const unofficial = op.transports.includes('unofficial');
  const ctx = await runtime();

  if (!unofficial && !allowMissingToken && !ctx.hasToken) {
    throw new Error(
      'No X credential found. Run `x auth login`, or set X_USER_TOKEN / X_BEARER_TOKEN.',
    );
  }

  if (unofficial) {
    const config = await loadConfig();
    if (!config.unofficial.enabled) {
      throw new Error(
        'The unofficial transport is disabled. Run `x config set-unofficial on --i-understand` and import cookies.',
      );
    }
    const mod = await import('@xctl/unofficial');
    const web = await mod.createWebClient(ctx.profile);
    return { ...ctx, web };
  }

  return ctx;
}

function isUnofficial(op: AnyOperation): boolean {
  return op.transports.includes('unofficial') && !op.transports.includes('official');
}

function toToolResult(out: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(out) }],
    structuredContent: (out && typeof out === 'object' ? out : { result: out }) as Record<string, unknown>,
  };
}

function toToolError(err: unknown) {
  const message =
    err instanceof XApiError
      ? `${err.message} (HTTP ${err.status}${err.code ? `, code ${err.code}` : ''})`
      : (err as Error).message;
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

async function loadOperations(): Promise<AnyOperation[]> {
  const config = await loadConfig();
  const ops: AnyOperation[] = [...(registry as readonly AnyOperation[])];
  if (config.unofficial.enabled) {
    const mod = await import('@xctl/unofficial');
    ops.push(...(mod.unofficialRegistry as readonly AnyOperation[]));
  }
  return ops;
}

function buildServer(ops: AnyOperation[]): McpServer {
  const server = new McpServer(
    { name: 'xctl', version: VERSION },
    { maxToolInputElements: 5_000 },
  );

  for (const op of ops) {
    server.registerTool(
      op.mcpName,
      {
        title: op.summary,
        description: op.description,
        inputSchema: op.input,
        outputSchema: op.output,
        annotations: op.annotations,
      },
      async (args: unknown) => {
        try {
          const dryRun = (args as { dry_run?: boolean } | null)?.dry_run === true;
          const ctx = await withWeb(op, dryRun);
          const out = await op.run(ctx, args as never);
          return toToolResult(out);
        } catch (err) {
          return toToolError(err);
        }
      },
    );
  }

  // A discovery pair for clients that would rather not load 40 schemas.
  server.registerTool(
    'operations_search',
    {
      title: 'Search available X operations',
      description:
        'Search the operation registry by id, summary or description. Returns id, MCP tool name, summary and input ' +
        'schema. Use this to discover long-tail actions, then call operations_invoke with the id and input.',
      inputSchema: z.object({
        query: z.string().default('').describe('Case-insensitive substring; empty returns everything'),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
      outputSchema: z.object({
        operations: z.array(
          z.object({
            id: z.string(),
            tool: z.string(),
            summary: z.string(),
            write: z.boolean(),
            transports: z.array(z.string()),
            input_schema: z.record(z.string(), z.unknown()),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit }: { query: string; limit: number }) => {
      const needle = query.toLowerCase();
      const matches = ops
        .filter(
          (op) =>
            !needle ||
            op.id.toLowerCase().includes(needle) ||
            op.mcpName.includes(needle) ||
            op.summary.toLowerCase().includes(needle) ||
            op.description.toLowerCase().includes(needle),
        )
        .slice(0, limit)
        .map((op) => ({
          id: op.id,
          tool: op.mcpName,
          summary: op.summary,
          write: !op.annotations.readOnlyHint,
          transports: [...op.transports],
          input_schema: z.toJSONSchema(op.input, { io: 'input' }) as Record<string, unknown>,
        }));
      return toToolResult({ operations: matches });
    },
  );

  server.registerTool(
    'operations_invoke',
    {
      title: 'Invoke an X operation by id',
      description:
        'Runs any registered operation by id, validating input against its schema. Use operations_search first to find ' +
        'the id and its input schema. Write operations are not idempotent: confirm the exact effect with the user.',
      inputSchema: z.object({
        id: z.string().describe('Operation id, e.g. posts.create'),
        input: z.record(z.string(), z.unknown()).default({}),
      }),
      outputSchema: z.object({ op_id: z.string(), result: z.unknown() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id, input }: { id: string; input: Record<string, unknown> }) => {
      const op = ops.find((candidate) => candidate.id === id || candidate.mcpName === id);
      if (!op) return toToolError(new Error(`Unknown operation: ${id}`));

      if (isUnofficial(op)) {
        const config = await loadConfig();
        if (!config.unofficial.enabled) {
          return toToolError(
            new Error(
              'The unofficial transport is disabled. Run `x config set-unofficial on --i-understand`.',
            ),
          );
        }
      }

      const parsed = op.input.safeParse(input);
      if (!parsed.success) return toToolError(new Error(z.prettifyError(parsed.error)));

      try {
        const ctx = await withWeb(op, (parsed.data as { dry_run?: boolean }).dry_run === true);
        const result = await op.run(ctx, parsed.data);
        return toToolResult({ op_id: op.id, result });
      } catch (err) {
        return toToolError(err);
      }
    },
  );

  return server;
}

const operations = await loadOperations();
const handle = serveStdio(() => buildServer(operations));
process.stderr.write(`xctl MCP server listening on stdio (${operations.length} operations)\n`);

process.on('SIGINT', () => {
  void handle.close();
});
