import type { CollectionId } from './catalog';

export type Phase = 'lobby' | 'bidding' | 'reveal' | 'recap';

export type RoundOutcome = 'sold' | 'burned' | 'unsold';

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  /** Secret until the recap. */
  collection: CollectionId | null;
  coins: number;
  items: string[];
  connected: boolean;
  /** Has submitted a bid for the current round. */
  hasBid: boolean;
  bid: number | null;
}

export interface RoundResult {
  round: number;
  itemId: string;
  /** Every bid, revealed at resolution. */
  bids: Record<string, number>;
  outcome: RoundOutcome;
  winner: string | null;
  price: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  phase: Phase;
  /** 0 while in the lobby, 1..ROUNDS during play. */
  round: number;
  players: Record<string, Player>;
  /** Ordered player ids, stable for display. */
  order: string[];
  /** Item ids, one per round. Built when the host starts. */
  deck: string[];
  history: RoundResult[];
  /** Epoch ms at which the current phase auto-advances. */
  deadline: number | null;
  /** Monotonic counter so clients can discard stale frames. */
  version: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'bid'; amount: number }
  | { t: 'start' }
  | { t: 'addBot' }
  | { t: 'removeBot'; id: string }
  | { t: 'rematch' }
  | { t: 'ping' };

export interface PublicPlayer {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  isHost: boolean;
  coins: number;
  items: string[];
  /** Points from items at this player's own valuation. */
  itemScore: number;
  score: number;
  hasBid: boolean;
  /** Only present once the round is revealed for this player. */
  bid: number | null;
  /** Only present for yourself, or for everyone at the recap. */
  collection: CollectionId | null;
}

export interface RoundView {
  round: number;
  itemId: string;
  bids: Record<string, number>;
  outcome: RoundOutcome;
  winner: string | null;
  price: number;
}

export interface GameView {
  code: string;
  phase: Phase;
  round: number;
  rounds: number;
  you: string | null;
  hostId: string;
  players: PublicPlayer[];
  deck: string[];
  /** The lot currently on the block. */
  itemId: string | null;
  /** Remaining ms on the current phase, measured server-side. */
  msLeft: number | null;
  deadline: number | null;
  history: RoundView[];
  version: number;
}

export type ServerMessage =
  | { t: 'state'; view: GameView; serverNow: number }
  | { t: 'welcome'; playerId: string; token: string }
  | { t: 'error'; message: string };
