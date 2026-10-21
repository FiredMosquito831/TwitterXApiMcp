import type * as z from 'zod/v4';
import type { OpContext, RateClass, TransportKind } from '@xctl/core';

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/**
 * One operation, projected into a CLI command, an MCP tool and an SDK method.
 *
 * `run` must not import commander, the MCP SDK or a transport implementation —
 * that separation is what keeps the three projections honest.
 */
export interface Operation<In extends z.ZodObject<z.ZodRawShape>, Out extends z.ZodType> {
  /** Stable id, `group.verb`, e.g. `posts.create`. */
  readonly id: string;
  /** MCP tool name; defaults to id with `.` -> `_`. */
  readonly mcpName: string;
  /** One line, used as CLI help and MCP title. */
  readonly summary: string;
  /** Long form; MCP description and `--help` body. */
  readonly description: string;
  readonly input: In;
  readonly output: Out;
  readonly rateClass: RateClass;
  /** Which transports may execute this operation. */
  readonly transports: readonly TransportKind[];
  readonly annotations: ToolAnnotations;
  /** Estimated USD cost for this invocation. */
  readonly cost: (input: z.output<In>) => number;
  readonly run: (ctx: OpContext, input: z.output<In>) => Promise<z.output<Out>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyOperation = Operation<any, any>;

export function defineOperation<In extends z.ZodObject<z.ZodRawShape>, Out extends z.ZodType>(def: {
  id: string;
  mcpName?: string;
  summary: string;
  description: string;
  input: In;
  output: Out;
  rateClass: RateClass;
  transports?: readonly TransportKind[];
  annotations: ToolAnnotations;
  cost?: (input: z.output<In>) => number;
  run: (ctx: OpContext, input: z.output<In>) => Promise<z.output<Out>>;
}): Operation<In, Out> {
  return {
    id: def.id,
    mcpName: def.mcpName ?? def.id.replaceAll('.', '_'),
    summary: def.summary,
    description: def.description,
    input: def.input,
    output: def.output,
    rateClass: def.rateClass,
    transports: def.transports ?? ['official'],
    annotations: def.annotations,
    cost: def.cost ?? (() => 0),
    run: def.run,
  };
}
