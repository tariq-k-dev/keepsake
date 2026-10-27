/**
 * Rules engine. Pure functions over RoomState — no timers, no I/O, no clock.
 * Every mutation returns a NEW state object so the Durable Object can persist a
 * snapshot and tests can hold a previous state for comparison.
 */

import {
  CODE_ALPHABET,
  COLLECTION_MULTIPLIER,
  COIN_CONVERSION,
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROUNDS,
  STARTING_COINS,
} from './constants';
import { COLLECTIONS, ITEMS, getItem, valueTo, type CollectionId } from './catalog';
import type { GameView, Player, PublicPlayer, RoomState, RoundOutcome, RoundResult } from './types';

/** Injectable RNG so games are reproducible in tests and in the balance simulation. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createRoom(code: string, hostId: string, now: number): RoomState {
  return {
    code,
    hostId,
    phase: 'lobby',
    round: 0,
    players: {},
    order: [],
    deck: [],
    history: [],
    deadline: null,
    version: 0,
    createdAt: now,
  };
}

export function makeRoomCode(rng: Rng): string {
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return out;
}

export function addPlayer(state: RoomState, id: string, name: string, isBot: boolean): RoomState {
  if (state.order.length >= MAX_PLAYERS) throw new Error('ROOM_FULL');
  if (state.phase !== 'lobby') throw new Error('GAME_ALREADY_STARTED');

  const player: Player = {
    id,
    name,
    isBot,
    collection: null,
    coins: STARTING_COINS,
    items: [],
    connected: true,
    hasBid: false,
    bid: null,
  };

  return {
    ...state,
    players: { ...state.players, [id]: player },
    order: [...state.order, id],
    version: state.version + 1,
  };
}

export function removePlayer(state: RoomState, id: string): RoomState {
  if (!state.players[id]) return state;

  const players = { ...state.players };
  delete players[id];
  const order = state.order.filter((p) => p !== id);

  // A game cannot continue below the minimum table size: fall back to the lobby.
  const collapsed = state.phase !== 'lobby' && order.length < MIN_PLAYERS;

  return {
    ...state,
    players,
    order,
    hostId: state.hostId === id ? (order[0] ?? '') : state.hostId,
    ...(collapsed ? resetToLobby() : {}),
    version: state.version + 1,
  };
}

function resetToLobby(): Partial<RoomState> {
  return { phase: 'lobby', round: 0, deck: [], history: [], deadline: null };
}

// ---------------------------------------------------------------------------
// Dealing
// ---------------------------------------------------------------------------

/**
 * Assigns one collection per player and builds the round deck.
 * Collections are dealt so no two players share one while there are enough to
 * go round; with 7-8 players the final players draw at random from the full set.
 */
export function deal(state: RoomState, rng: Rng): RoomState {
  const order = state.order;

  const collectionPool = shuffle(
    COLLECTIONS.map((c) => c.id),
    rng,
  );
  const collectionByPlayer = new Map<string, CollectionId>();
  order.forEach((playerId, index) => {
    const picked = collectionPool[index % collectionPool.length];
    if (picked) collectionByPlayer.set(playerId, picked);
  });

  const players: Record<string, Player> = {};
  for (const id of order) {
    const p = state.players[id];
    if (!p) continue;
    players[id] = {
      ...p,
      collection: collectionByPlayer.get(id) ?? null,
      coins: STARTING_COINS,
      items: [],
      hasBid: false,
      bid: null,
    };
  }

  // Every lot is distinct, and the deck is ordered so that a collection's items
  // never cluster — otherwise a player could tell their collection from the deck.
  const deck = shuffle(
    ITEMS.map((i) => i.id),
    rng,
  ).slice(0, ROUNDS);

  return {
    ...state,
    players,
    deck,
    history: [],
    round: 1,
    phase: 'bidding',
    version: state.version + 1,
  };
}

function shuffle<T>(input: readonly T[], rng: Rng): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a === undefined || b === undefined) continue;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

export function placeBid(state: RoomState, playerId: string, rawAmount: number): RoomState {
  if (state.phase !== 'bidding') throw new Error('NOT_BIDDING');
  const player = state.players[playerId];
  if (!player) throw new Error('NO_SUCH_PLAYER');
  if (player.hasBid) throw new Error('ALREADY_BID');

  const amount = Math.floor(rawAmount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('BAD_BID');
  if (amount > player.coins) throw new Error('BID_EXCEEDS_COINS');

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: { ...player, hasBid: true, bid: amount },
    },
    version: state.version + 1,
  };
}

export function allBidsIn(state: RoomState): boolean {
  return state.order.every((id) => state.players[id]?.hasBid);
}

/**
 * Resolves the current lot.
 *
 * Rules:
 *  - Highest bid wins and pays exactly what it bid.
 *  - A tie for the highest bid destroys the lot: nobody scores, nobody pays.
 *  - A highest bid of 0 means nobody bid anything: the lot is unsold, and it
 *    does NOT go to anyone. (Distinct from a 0/0 tie, which is also unsold —
 *    the outcome label differs so the reveal can explain it.)
 */
export function resolveRound(state: RoomState): RoomState {
  if (state.phase !== 'bidding') throw new Error('NOT_BIDDING');

  const itemId = state.deck[state.round - 1];
  if (!itemId) throw new Error('NO_ITEM_FOR_ROUND');

  const bids: Record<string, number> = {};
  for (const id of state.order) {
    bids[id] = state.players[id]?.bid ?? 0;
  }

  const amounts = state.order.map((id) => bids[id] ?? 0);
  const highest = Math.max(...amounts);
  const leaders = state.order.filter((id) => (bids[id] ?? 0) === highest);

  let outcome: RoundOutcome;
  let winner: string | null = null;
  let price = 0;

  if (highest === 0) {
    outcome = 'unsold';
  } else if (leaders.length > 1) {
    outcome = 'burned';
  } else {
    outcome = 'sold';
    winner = leaders[0] ?? null;
    price = highest;
  }

  const players: Record<string, Player> = {};
  for (const id of state.order) {
    const p = state.players[id];
    if (!p) continue;
    const won = winner === id;
    players[id] = {
      ...p,
      coins: won ? p.coins - price : p.coins,
      items: won ? [...p.items, itemId] : p.items,
      hasBid: false,
      bid: null,
    };
  }

  const result: RoundResult = { round: state.round, itemId, bids, outcome, winner, price };

  return {
    ...state,
    players,
    history: [...state.history, result],
    phase: 'reveal',
    deadline: null,
    version: state.version + 1,
  };
}

/** Advances from reveal to the next lot, or to the recap after the last one. */
export function advance(state: RoomState): RoomState {
  if (state.phase !== 'reveal') throw new Error('NOT_REVEAL');

  if (state.round >= state.deck.length) {
    return { ...state, phase: 'recap', deadline: null, version: state.version + 1 };
  }

  return {
    ...state,
    phase: 'bidding',
    round: state.round + 1,
    deadline: null,
    version: state.version + 1,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  itemPoints: number;
  coinPoints: number;
  total: number;
}

export function scorePlayer(player: Player, coinRate: number = COIN_CONVERSION): ScoreBreakdown {
  const collection = player.collection;
  const itemPoints = collection
    ? player.items.reduce(
        (sum, id) => sum + valueTo(getItem(id), collection, COLLECTION_MULTIPLIER),
        0,
      )
    : 0;
  const coinPoints = Math.floor(player.coins * coinRate);
  return { itemPoints, coinPoints, total: itemPoints + coinPoints };
}

/** Rankings, highest first. Ties break on coins, then on items won, then on name. */
export function rank(state: RoomState): Array<{ id: string; score: number; rank: number }> {
  const scored = state.order.map((id) => {
    const p = state.players[id];
    const score = p ? scorePlayer(p).total : 0;
    return { id, score, coins: p?.coins ?? 0, items: p?.items.length ?? 0, name: p?.name ?? '' };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score || b.coins - a.coins || b.items - a.items || a.name.localeCompare(b.name),
  );

  return scored.map((s, index) => ({ id: s.id, score: s.score, rank: index + 1 }));
}

export function winners(state: RoomState): string[] {
  const ranked = rank(state);
  const top = ranked[0];
  if (!top) return [];
  return ranked.filter((r) => r.score === top.score).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Views — the only thing that ever leaves the server
// ---------------------------------------------------------------------------

/**
 * Builds the client projection. This is the secrecy boundary: a player's
 * collection is included only for themselves (or for everyone at the recap),
 * and bid amounts appear only once the round has resolved.
 */
export function viewFor(state: RoomState, viewerId: string | null, now: number): GameView {
  const revealed = state.phase === 'reveal' || state.phase === 'recap';
  const showCollections = state.phase === 'recap';

  const players: PublicPlayer[] = state.order.map((id) => {
    const p = state.players[id];
    if (!p) throw new Error(`Missing player ${id}`);
    const breakdown = scorePlayer(p);
    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      connected: p.connected,
      isHost: p.id === state.hostId,
      coins: p.coins,
      items: p.items,
      itemScore: breakdown.itemPoints,
      score: breakdown.total,
      hasBid: p.hasBid,
      bid: revealed ? (p.bid ?? state.history.at(-1)?.bids[id] ?? null) : null,
      collection: showCollections || p.id === viewerId ? p.collection : null,
    };
  });

  const currentItem =
    state.phase === 'bidding' || state.phase === 'reveal'
      ? (state.deck[state.round - 1] ?? null)
      : null;

  return {
    code: state.code,
    phase: state.phase,
    round: state.round,
    rounds: state.deck.length,
    you: viewerId,
    hostId: state.hostId,
    players,
    deck: state.deck,
    itemId: currentItem,
    msLeft: state.deadline === null ? null : Math.max(0, state.deadline - now),
    deadline: state.deadline,
    history: state.history,
    version: state.version,
  };
}
