/**
 * Bot bidding strategies. Lives in `shared/` so the balance simulation
 * (`scripts/simulate.ts`) and the live Durable Object run the exact same code —
 * a simulation that tunes a different bot than production ships is worthless.
 *
 * Every strategy sees only what a human at that seat could see: their own
 * collection and coins, the public lot, and the public history. They do NOT see
 * other players' collections or un-revealed bids.
 *
 * Design constraint found by `scripts/sweep.ts`: the three archetypes must be
 * COMPARABLE IN STRENGTH. An earlier version had `greedy` winning 86% of
 * two-player games because it alone evaluated every lot; it made bot mode
 * pointless and it poisoned the balance measurements. All three now share the
 * same value estimate and differ only in aggression, patience, and bid spread.
 */

import { COLLECTION_MULTIPLIER } from './constants';
import { getItem, valueTo } from './catalog';
import type { RoomState } from './types';
import type { Rng } from './engine';

export type BotStyle = 'steady' | 'raider' | 'patient';

export interface BotContext {
  state: RoomState;
  playerId: string;
  rng: Rng;
  /** Overrides COLLECTION_MULTIPLIER — used only by the balance sweep. */
  multiplier?: number;
}

export function decideBid(style: BotStyle, ctx: BotContext): number {
  const { state, playerId, rng, multiplier = COLLECTION_MULTIPLIER } = ctx;
  const player = state.players[playerId];
  if (!player || player.collection === null) return 0;

  const itemId = state.deck[state.round - 1];
  if (!itemId) return 0;

  const item = getItem(itemId);
  const mine = item.collection === player.collection;
  const trueValue = valueTo(item, player.collection, multiplier);
  const roundsLeft = Math.max(1, state.deck.length - state.round + 1);

  // Every strategy anchors on "what is this worth to me, minus a margin".
  // The margin is what makes bots beatable: none of them bids to true value.
  const margin = mine ? 0.85 : 0.7;

  // Fair share of the remaining budget, so nobody blows the stack on lot one.
  const perRound = player.coins / roundsLeft;

  let ceiling = Math.floor(trueValue * margin);
  let spread = 0.25; // how much of the ceiling the bot is willing to shave

  switch (style) {
    case 'steady':
      // Spends the budget evenly and bids near its ceiling every round.
      ceiling = Math.min(ceiling, Math.floor(perRound * 1.4));
      spread = 0.2;
      break;
    case 'raider':
      // Stretches for anything it likes, accepts going broke early.
      ceiling = Math.min(ceiling, Math.floor(perRound * 2.2));
      spread = 0.1;
      break;
    case 'patient':
      // Saves coins, then commits once the table is thinner.
      ceiling = Math.floor(ceiling * (0.65 + 0.35 * (state.round / state.deck.length)));
      ceiling = Math.min(ceiling, Math.floor(perRound * (mine ? 2.0 : 1.1)));
      spread = 0.3;
      break;
  }

  ceiling = Math.min(ceiling, player.coins);

  // Skip a lot that is not worth the trouble. A player who never passes is a
  // player who cannot be read, so passes are part of the game's texture.
  if (ceiling <= 0) return 0;
  if (rng() < (mine ? 0.04 : 0.18)) return 0;

  const jitter = 1 - rng() * spread;
  return Math.max(0, Math.min(player.coins, Math.round(ceiling * jitter)));
}

export const BOT_STYLES: readonly BotStyle[] = ['steady', 'raider', 'patient'] as const;

export const BOT_NAMES: readonly string[] = [
  'Aunt Verity',
  'Cousin Basil',
  'Uncle Rook',
  'Miss Havisham',
  'Nephew Pike',
  'Cousin Wren',
  'Dr. Thistle',
] as const;

export function styleForIndex(index: number): BotStyle {
  return BOT_STYLES[index % BOT_STYLES.length] ?? 'steady';
}

/** Deterministically assigns a style to a bot seat so a given room replays the same. */
export function botStyleFor(playerId: string): BotStyle {
  let hash = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return styleForIndex(hash);
}
