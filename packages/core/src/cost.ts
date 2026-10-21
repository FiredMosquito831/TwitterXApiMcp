/**
 * X API pay-per-use price card, verified 2026-10-21.
 * Source: docs.x.com/x-api/getting-started/pricing
 */

export const PRICE = {
  'post.read': 0.005,
  'owned.read': 0.001,
  'user.read': 0.01,
  'dm.read': 0.01,
  'follower.read': 0.01,
  'list.read': 0.005,
  'space.read': 0.005,
  'community.read': 0.005,
  'note.read': 0.005,
  'interaction.read': 0.001,
  'post.create': 0.015,
  'post.create_url': 0.2,
  'post.reply_summoned': 0.01,
  'post.delete': 0.01,
  'interaction.delete': 0.01,
  'mute.delete': 0.005,
  'dm.create': 0.015,
  'user.interaction': 0.015,
  'content.manage': 0.005,
  'list.create': 0.01,
  'list.manage': 0.005,
  'bookmark': 0.005,
  'media.metadata': 0.005,
  'trends': 0.01,
  webhook: 0.005,
} as const;

export type PriceKey = keyof typeof PRICE;

export interface SpendOptions {
  /** Hard cap in USD for this process/profile. */
  capUsd: number;
  /** Spend already recorded for this profile in the current period. */
  initialTotal?: number;
  /** Called for every recorded charge, for logging and persistence. */
  onCharge?: (amount: number, label: string, total: number) => void;
}

export class SpendMeter {
  #total: number;
  readonly #cap: number;
  readonly #onCharge: SpendOptions['onCharge'];

  constructor(opts: SpendOptions) {
    this.#cap = opts.capUsd;
    this.#total = opts.initialTotal ?? 0;
    this.#onCharge = opts.onCharge;
  }

  estimate(amount: number): number {
    return Math.round(amount * 1e6) / 1e6;
  }

  assertWithinCap(amount: number): void {
    if (this.#total + amount > this.#cap) {
      throw new Error(
        `Spend cap would be exceeded: $${this.#total.toFixed(4)} spent + $${amount.toFixed(
          4,
        )} > $${this.#cap.toFixed(2)}. Raise XCTL_SPEND_CAP or top up.`,
      );
    }
  }

  record(amount: number, label: string): void {
    this.#total += amount;
    this.#onCharge?.(amount, label, this.#total);
  }

  total(): number {
    return this.#total;
  }
}

/** Cost of creating a post, accounting for the 13x penalty on links. */
export function postCreatePrice(text: string, isReply = false): number {
  const hasUrl = /https?:\/\/\S+/i.test(text);
  if (hasUrl) return PRICE['post.create_url'];
  return isReply ? PRICE['post.reply_summoned'] : PRICE['post.create'];
}
