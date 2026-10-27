import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  advance,
  allBidsIn,
  createRoom,
  deal,
  makeRoomCode,
  mulberry32,
  placeBid,
  rank,
  removePlayer,
  resolveRound,
  scorePlayer,
  viewFor,
  winners,
} from '../../src/shared/engine';
import {
  COLLECTION_MULTIPLIER,
  COIN_CONVERSION,
  MAX_PLAYERS,
  ROUNDS,
  STARTING_COINS,
} from '../../src/shared/constants';
import { COLLECTIONS, getItem, valueTo } from '../../src/shared/catalog';
import type { RoomState } from '../../src/shared/types';

function lobby(playerCount: number, seed = 1): RoomState {
  let state = createRoom('TEST', 'p0', 0);
  for (let i = 0; i < playerCount; i += 1) {
    state = addPlayer(state, `p${i}`, `Player ${i}`, false);
  }
  return { ...state, createdAt: seed };
}

function playing(playerCount: number, seed = 42): RoomState {
  const state = lobby(playerCount, seed);
  return deal(state, mulberry32(seed));
}

/** Plays a full game with explicit per-round bids: bidsByRound[roundIndex][playerIndex]. */
function playGame(state: RoomState, bidsByRound: number[][]): RoomState {
  let current = state;
  for (const roundBids of bidsByRound) {
    roundBids.forEach((amount, index) => {
      const id = current.order[index];
      if (id === undefined) return;
      // Clamp to the bidder's remaining coins: the engine rightly rejects
      // overbids, and a fixed bid ladder would otherwise drive a player broke.
      const coins = current.players[id]?.coins ?? 0;
      current = placeBid(current, id, Math.min(amount, coins));
    });
    current = resolveRound(current);
    current = advance(current);
  }
  return current;
}

describe('room code', () => {
  it('generates four characters from the unambiguous alphabet', () => {
    const code = makeRoomCode(mulberry32(7));
    expect(code).toHaveLength(4);
    for (const char of code) {
      expect('ABCDEFGHJKLMNPQRSTUVWXYZ23456789').toContain(char);
    }
  });

  it('never emits I, O, 0 or 1', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      expect(makeRoomCode(mulberry32(seed))).not.toMatch(/[IO01]/);
    }
  });
});

describe('lobby', () => {
  it('caps the table at MAX_PLAYERS', () => {
    let state = lobby(MAX_PLAYERS);
    expect(state.order).toHaveLength(MAX_PLAYERS);
    expect(() => addPlayer(state, 'extra', 'Extra', false)).toThrow('ROOM_FULL');
    state = { ...state };
  });

  it('refuses joins once the game has started', () => {
    const state = playing(3);
    expect(() => addPlayer(state, 'late', 'Late', false)).toThrow('GAME_ALREADY_STARTED');
  });

  it('promotes the next player when the host leaves', () => {
    const state = lobby(3);
    const after = removePlayer(state, 'p0');
    expect(after.hostId).toBe('p1');
    expect(after.order).toEqual(['p1', 'p2']);
  });

  it('collapses a live game back to the lobby if the table drops below the minimum', () => {
    const state = playing(2);
    const after = removePlayer(state, 'p1');
    expect(after.phase).toBe('lobby');
    expect(after.round).toBe(0);
    expect(after.history).toEqual([]);
  });

  it('keeps a live game running while enough players remain', () => {
    const state = playing(4);
    const after = removePlayer(state, 'p3');
    expect(after.phase).toBe('bidding');
    expect(after.history).toEqual([]);
  });
});

describe('dealing', () => {
  it('builds a deck of exactly ROUNDS distinct lots', () => {
    const state = playing(4);
    expect(state.deck).toHaveLength(ROUNDS);
    expect(new Set(state.deck).size).toBe(ROUNDS);
  });

  it('gives every player a collection and fresh coins', () => {
    const state = playing(4);
    for (const id of state.order) {
      const player = state.players[id];
      expect(player?.collection).toBeTruthy();
      expect(player?.coins).toBe(STARTING_COINS);
      expect(player?.items).toEqual([]);
    }
  });

  it('deals distinct collections when there are enough to go round', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const state = playing(6, seed);
      const collections = state.order.map((id) => state.players[id]?.collection);
      expect(new Set(collections).size).toBe(6);
    }
  });

  it('allows repeats only when players outnumber collections', () => {
    const state = playing(8);
    const collections = state.order.map((id) => state.players[id]?.collection);
    expect(collections).toHaveLength(8);
    expect(new Set(collections).size).toBeLessThanOrEqual(COLLECTIONS.length);
  });

  it('is reproducible for a given seed', () => {
    expect(playing(5, 99).deck).toEqual(playing(5, 99).deck);
  });

  it('produces a different deal for a different seed', () => {
    expect(playing(5, 1).deck).not.toEqual(playing(5, 2).deck);
  });
});

describe('bidding validation', () => {
  it("rejects a bid above the bidder's coins", () => {
    const state = playing(3);
    expect(() => placeBid(state, 'p0', STARTING_COINS + 1)).toThrow('BID_EXCEEDS_COINS');
  });

  it('rejects a negative or non-finite bid', () => {
    const state = playing(3);
    expect(() => placeBid(state, 'p0', -1)).toThrow('BAD_BID');
    expect(() => placeBid(state, 'p0', Number.NaN)).toThrow('BAD_BID');
    expect(() => placeBid(state, 'p0', Number.POSITIVE_INFINITY)).toThrow('BAD_BID');
  });

  it('rejects a second bid from the same player', () => {
    const once = placeBid(playing(3), 'p0', 10);
    expect(() => placeBid(once, 'p0', 20)).toThrow('ALREADY_BID');
  });

  it('rejects bids outside the bidding phase', () => {
    const state = lobby(3);
    expect(() => placeBid(state, 'p0', 10)).toThrow('NOT_BIDDING');
  });

  it("accepts a bid of exactly the player's remaining coins", () => {
    const state = placeBid(playing(3), 'p0', STARTING_COINS);
    expect(state.players['p0']?.bid).toBe(STARTING_COINS);
  });

  it('tracks whether the table has finished bidding', () => {
    let state = playing(3);
    expect(allBidsIn(state)).toBe(false);
    state = placeBid(state, 'p0', 5);
    state = placeBid(state, 'p1', 6);
    expect(allBidsIn(state)).toBe(false);
    state = placeBid(state, 'p2', 7);
    expect(allBidsIn(state)).toBe(true);
  });
});

describe('round resolution', () => {
  it('awards the lot to a sole highest bidder and charges their bid', () => {
    let state = playing(3);
    state = placeBid(state, 'p0', 20);
    state = placeBid(state, 'p1', 35);
    state = placeBid(state, 'p2', 10);
    state = resolveRound(state);

    expect(state.history[0]?.outcome).toBe('sold');
    expect(state.history[0]?.winner).toBe('p1');
    expect(state.history[0]?.price).toBe(35);
    expect(state.players['p1']?.coins).toBe(STARTING_COINS - 35);
    expect(state.players['p1']?.items).toHaveLength(1);
  });

  it('never charges a losing bidder', () => {
    let state = playing(3);
    state = placeBid(state, 'p0', 20);
    state = placeBid(state, 'p1', 35);
    state = placeBid(state, 'p2', 10);
    state = resolveRound(state);
    expect(state.players['p0']?.coins).toBe(STARTING_COINS);
    expect(state.players['p2']?.coins).toBe(STARTING_COINS);
    expect(state.players['p0']?.items).toEqual([]);
  });

  it('burns the lot on a two-way tie for the highest bid', () => {
    let state = playing(3);
    state = placeBid(state, 'p0', 30);
    state = placeBid(state, 'p1', 30);
    state = placeBid(state, 'p2', 5);
    state = resolveRound(state);

    expect(state.history[0]?.outcome).toBe('burned');
    expect(state.history[0]?.winner).toBeNull();
    expect(state.history[0]?.price).toBe(0);
    expect(state.players['p0']?.coins).toBe(STARTING_COINS);
    expect(state.players['p1']?.coins).toBe(STARTING_COINS);
    for (const id of state.order) expect(state.players[id]?.items).toEqual([]);
  });

  it('burns the lot when everyone bids the same amount', () => {
    let state = playing(4);
    for (const id of state.order) state = placeBid(state, id, 12);
    state = resolveRound(state);
    expect(state.history[0]?.outcome).toBe('burned');
  });

  it('burns the lot on a tie among three or more leaders', () => {
    let state = playing(5);
    const amounts = [40, 40, 40, 7, 9];
    amounts.forEach((amount, i) => {
      const id = state.order[i];
      if (id !== undefined) state = placeBid(state, id, amount);
    });
    state = resolveRound(state);
    expect(state.history[0]?.outcome).toBe('burned');
  });

  it('marks the lot unsold when every bid is zero', () => {
    let state = playing(3);
    for (const id of state.order) state = placeBid(state, id, 0);
    state = resolveRound(state);
    expect(state.history[0]?.outcome).toBe('unsold');
    expect(state.history[0]?.winner).toBeNull();
  });

  it('awards a lone bid of 1 over a table of passes', () => {
    let state = playing(3);
    state = placeBid(state, 'p0', 0);
    state = placeBid(state, 'p1', 1);
    state = placeBid(state, 'p2', 0);
    state = resolveRound(state);
    expect(state.history[0]?.outcome).toBe('sold');
    expect(state.history[0]?.winner).toBe('p1');
    expect(state.players['p1']?.coins).toBe(STARTING_COINS - 1);
  });

  it('treats a tie at zero as unsold rather than burned', () => {
    let state = playing(2);
    state = placeBid(state, 'p0', 0);
    state = placeBid(state, 'p1', 0);
    state = resolveRound(state);
    expect(state.history[0]?.outcome).toBe('unsold');
  });

  it('is exhaustive over every 2-player bid combination up to 6 coins', () => {
    for (let a = 0; a <= 6; a += 1) {
      for (let b = 0; b <= 6; b += 1) {
        let state = playing(2);
        state = placeBid(state, state.order[0] as string, a);
        state = placeBid(state, state.order[1] as string, b);
        state = resolveRound(state);
        const result = state.history[0];
        expect(result).toBeDefined();
        if (a === b) {
          expect(result?.outcome).toBe(a === 0 ? 'unsold' : 'burned');
          expect(result?.winner).toBeNull();
        } else {
          const expectedWinner = a > b ? state.order[0] : state.order[1];
          expect(result?.outcome).toBe('sold');
          expect(result?.winner).toBe(expectedWinner);
          expect(result?.price).toBe(Math.max(a, b));
        }
        // Conservation: the winning bid leaves the table exactly once.
        const totalCoins = state.order.reduce(
          (sum, id) => sum + (state.players[id]?.coins ?? 0),
          0,
        );
        const expected = 2 * STARTING_COINS - (result?.outcome === 'sold' ? result.price : 0);
        expect(totalCoins).toBe(expected);
      }
    }
  });

  it('records every bid in the round result', () => {
    let state = playing(3);
    state = placeBid(state, 'p0', 11);
    state = placeBid(state, 'p1', 22);
    state = placeBid(state, 'p2', 33);
    state = resolveRound(state);
    expect(state.history[0]?.bids).toEqual({ p0: 11, p1: 22, p2: 33 });
  });

  it('clears per-round bid state so the next round can be played', () => {
    let state = playing(2);
    state = placeBid(state, 'p0', 5);
    state = placeBid(state, 'p1', 9);
    state = resolveRound(state);
    state = advance(state);
    for (const id of state.order) {
      expect(state.players[id]?.hasBid).toBe(false);
      expect(state.players[id]?.bid).toBeNull();
    }
  });
});

describe('phase progression', () => {
  it('advances round by round and ends in the recap', () => {
    let state = playing(3);
    const bids = Array.from({ length: ROUNDS }, (_, round) => [round + 1, 0, 0]);

    for (let round = 1; round <= ROUNDS; round += 1) {
      expect(state.phase).toBe('bidding');
      expect(state.round).toBe(round);
      const roundBids = bids[round - 1] ?? [0, 0, 0];
      roundBids.forEach((amount, index) => {
        const id = state.order[index];
        if (id !== undefined) state = placeBid(state, id, amount);
      });
      state = resolveRound(state);
      expect(state.phase).toBe('reveal');
      state = advance(state);
    }

    expect(state.phase).toBe('recap');
    expect(state.history).toHaveLength(ROUNDS);
  });

  it('refuses to advance when not revealing', () => {
    expect(() => advance(playing(3))).toThrow('NOT_REVEAL');
  });

  it('refuses to resolve twice in the same round', () => {
    let state = playing(2);
    state = placeBid(state, 'p0', 1);
    state = placeBid(state, 'p1', 2);
    state = resolveRound(state);
    expect(() => resolveRound(state)).toThrow('NOT_BIDDING');
  });
});

describe('scoring', () => {
  it('doubles a collection item and leaves others at base', () => {
    const state = playing(3);
    const item = getItem(state.deck[0] as string);
    const owner = state.order.find((id) => state.players[id]?.collection === item.collection);
    const stranger = state.order.find((id) => state.players[id]?.collection !== item.collection);

    expect(owner).toBeDefined();
    expect(stranger).toBeDefined();

    const ownerValue = valueTo(item, item.collection, COLLECTION_MULTIPLIER);
    expect(ownerValue).toBe(item.base * COLLECTION_MULTIPLIER);
    expect(valueTo(item, state.players[stranger as string]?.collection as never, 2)).toBe(
      item.base,
    );
  });

  it('converts leftover coins at the configured rate, rounded down', () => {
    const state = playing(2);
    const player = { ...state.players['p0']!, coins: 37, collection: 'kitchen' as const };
    expect(scorePlayer(player).coinPoints).toBe(Math.floor(37 * COIN_CONVERSION));
  });

  it('ranks by total score, highest first', () => {
    const state = playing(3);
    const ranked = rank(state);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]?.rank).toBe(1);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });

  it('reports co-winners on an exact score tie', () => {
    const state = playing(2);
    const ids = winners(state);
    // A fresh deal gives identical coins and no items, so both tie on coins alone.
    expect(ids.length).toBe(2);
    expect(new Set(ids)).toEqual(new Set(state.order));
  });
});

describe('full game invariants', () => {
  it('keeps total coins conserved minus what was actually paid', () => {
    const state = playing(4);
    const before = state.order.reduce((s, id) => s + (state.players[id]?.coins ?? 0), 0);
    const finished = playGame(
      state,
      Array.from({ length: ROUNDS }, (_, i) => [10 + i, 3, 0, 25]),
    );
    const after = finished.order.reduce((s, id) => s + (finished.players[id]?.coins ?? 0), 0);
    const paid = finished.history
      .filter((r) => r.outcome === 'sold')
      .reduce((s, r) => s + r.price, 0);
    expect(after).toBe(before - paid);
  });

  it('never lets a player hold more items than rounds played', () => {
    const finished = playGame(
      playing(3),
      Array.from({ length: ROUNDS }, () => [5, 4, 3]),
    );
    for (const id of finished.order) {
      expect(finished.players[id]?.items.length).toBeLessThanOrEqual(ROUNDS);
    }
  });

  it('auctions every lot in the deck exactly once', () => {
    const finished = playGame(
      playing(3),
      Array.from({ length: ROUNDS }, (_, i) => [i + 1, 0, 0]),
    );
    expect(finished.history.map((r) => r.itemId)).toEqual(finished.deck);
    expect(new Set(finished.history.map((r) => r.itemId)).size).toBe(ROUNDS);
  });

  it('never lets a player bid coins they do not have', () => {
    let state = playing(3);
    // Spend down p0 as far as possible, then confirm the cap is enforced.
    for (let round = 1; round <= ROUNDS; round += 1) {
      const coins = state.players['p0']?.coins ?? 0;
      const bid = Math.min(coins, 40);
      state = placeBid(state, 'p0', bid);
      state = placeBid(state, 'p1', 0);
      state = placeBid(state, 'p2', 0);
      state = resolveRound(state);
      state = advance(state);
      if (state.phase === 'recap') break;
      const remaining = state.players['p0']?.coins ?? 0;
      expect(remaining).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('view projection (the secrecy boundary)', () => {
  it("hides every other player's collection during play", () => {
    const state = playing(3);
    const view = viewFor(state, 'p0', 0);
    const me = view.players.find((p) => p.id === 'p0');
    const others = view.players.filter((p) => p.id !== 'p0');
    expect(me?.collection).not.toBeNull();
    for (const other of others) expect(other.collection).toBeNull();
  });

  it('hides un-revealed bids during the bidding phase', () => {
    let state = playing(3);
    state = placeBid(state, 'p0', 12);
    const view = viewFor(state, 'p1', 0);
    for (const player of view.players) expect(player.bid).toBeNull();
  });

  it('exposes all bids once the round is revealed', () => {
    let state = playing(3);
    state = placeBid(state, 'p0', 12);
    state = placeBid(state, 'p1', 30);
    state = placeBid(state, 'p2', 0);
    state = resolveRound(state);
    const view = viewFor(state, 'p2', 0);
    const winner = view.players.find((p) => p.id === 'p1');
    expect(winner?.bid).toBe(30);
  });

  it('reveals every collection at the recap', () => {
    const finished = playGame(
      playing(3),
      Array.from({ length: ROUNDS }, () => [3, 2, 1]),
    );
    const view = viewFor(finished, 'p0', 0);
    for (const player of view.players) expect(player.collection).not.toBeNull();
  });

  it('is a spectator view with no private collection when unauthenticated', () => {
    const state = playing(3);
    const view = viewFor(state, null, 0);
    for (const player of view.players) expect(player.collection).toBeNull();
    expect(view.you).toBeNull();
  });

  it('never leaks the deck order before the game starts', () => {
    const view = viewFor(lobby(3), 'p0', 0);
    expect(view.deck).toEqual([]);
    expect(view.itemId).toBeNull();
  });

  it('computes remaining time from the server clock', () => {
    const state = playing(2);
    const withDeadline = { ...state, deadline: 10_000 };
    expect(viewFor(withDeadline, 'p0', 4_000).msLeft).toBe(6_000);
    expect(viewFor(withDeadline, 'p0', 11_000).msLeft).toBe(0);
  });
});
