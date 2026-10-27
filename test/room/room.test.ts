/**
 * Integration tests for the room Durable Object.
 *
 * These run inside workerd via @cloudflare/vitest-plugin, so they exercise the
 * real thing: real WebSocketPair, real hibernation attachments, real alarms,
 * real DO storage. A mocked socket would prove nothing about screen sync.
 */

import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { RoomDO } from '../../src/worker/room';
import type { GameView, ServerMessage } from '../../src/shared/types';
import { ROUNDS } from '../../src/shared/constants';

function stubFor(code: string) {
  const id = env.ROOMS.idFromName(code);
  return env.ROOMS.get(id);
}

/** Connects a client and buffers every frame until closed. */
async function connect(
  code: string,
  name: string,
  token?: string,
): Promise<{
  ws: WebSocket;
  frames: ServerMessage[];
  next: () => Promise<ServerMessage>;
  close: () => void;
}> {
  const url = new URL(`https://room/ws?code=${code}&name=${encodeURIComponent(name)}`);
  if (token) url.searchParams.set('token', token);
  const response = await stubFor(code).fetch(
    new Request(url, { headers: { Upgrade: 'websocket' } }),
  );
  const ws = response.webSocket;
  if (!ws) throw new Error('No webSocket on upgrade response');
  ws.accept();

  const frames: ServerMessage[] = [];
  const waiters: Array<(m: ServerMessage) => void> = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else frames.push(message);
  });

  return {
    ws,
    frames,
    next: () =>
      new Promise<ServerMessage>((resolve) => {
        const queued = frames.shift();
        if (queued) return resolve(queued);
        waiters.push(resolve);
      }),
    close: () => ws.close(),
  };
}

/** Waits for the next `state` frame that satisfies `predicate`. */
async function waitForState(
  client: Awaited<ReturnType<typeof connect>>,
  predicate: (view: GameView) => boolean,
  attempts = 40,
): Promise<GameView> {
  for (let i = 0; i < attempts; i += 1) {
    const message = await client.next();
    if (message.t === 'state' && predicate(message.view)) return message.view;
  }
  throw new Error('Timed out waiting for a matching state frame');
}

function viewForId(view: GameView, id: string) {
  const player = view.players.find((p) => p.id === id);
  if (!player) throw new Error(`No player ${id} in view`);
  return player;
}

describe('room lifecycle', () => {
  it('mints a room and reports it as existing', async () => {
    const response = await stubFor('MINT').fetch('https://room/info');
    const info = (await response.json()) as { exists: boolean };
    expect(info.exists).toBe(false);
  });

  it('welcomes a new player with an id and a resume token', async () => {
    const client = await connect('WELC', 'Tariq');
    const welcome = await client.next();
    expect(welcome.t).toBe('welcome');
    if (welcome.t !== 'welcome') throw new Error('expected welcome');
    expect(welcome.playerId).toHaveLength(12);
    expect(welcome.token).toHaveLength(12);
    client.close();
  });

  it('rejects a fifth-character code at the worker edge', async () => {
    const response = await SELF.fetch('https://example.com/ws?code=TOOLONG', {
      headers: { Upgrade: 'websocket' },
    });
    expect(response.status).toBe(400);
  });

  it('seats the first player as host', async () => {
    const client = await connect('HOST', 'Alice');
    const welcome = await client.next();
    if (welcome.t !== 'welcome') throw new Error('expected welcome');
    const view = await waitForState(client, (v) => v.players.length === 1);
    expect(view.hostId).toBe(welcome.playerId);
    client.close();
  });

  it('keeps every client in sync on join', async () => {
    const alice = await connect('SYNC', 'Alice');
    await alice.next();
    await waitForState(alice, (v) => v.players.length === 1);

    const bob = await connect('SYNC', 'Bob');
    await bob.next();

    const aliceView = await waitForState(alice, (v) => v.players.length === 2);
    const bobView = await waitForState(bob, (v) => v.players.length === 2);
    expect(aliceView.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
    expect(bobView.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);

    alice.close();
    bob.close();
  });

  it('sanitises display names and caps their length', async () => {
    const client = await connect('NAME', 'Control\u0000Chars'.repeat(4));
    const welcome = await client.next();
    if (welcome.t !== 'welcome') throw new Error('expected welcome');
    const view = await waitForState(client, (v) => v.players.length === 1);
    const me = viewForId(view, welcome.playerId);
    expect(me.name).not.toContain('\u0000');
    expect(me.name.length).toBeLessThanOrEqual(16);
    client.close();
  });

  it('resumes a seat with a valid token instead of creating a new one', async () => {
    const first = await connect('RESM', 'Alice');
    const welcome = await first.next();
    if (welcome.t !== 'welcome') throw new Error('expected welcome');
    first.close();

    const second = await connect('RESM', 'Alice', welcome.token);
    const again = await second.next();
    if (again.t !== 'welcome') throw new Error('expected welcome');
    expect(again.playerId).toBe(welcome.playerId);
    second.close();
  });
});

describe('playing a game', () => {
  it('refuses to start with fewer than two players', async () => {
    const alice = await connect('SOLO', 'Alice');
    await alice.next();
    await waitForState(alice, (v) => v.players.length === 1);
    alice.ws.send(JSON.stringify({ t: 'start' }));
    const message = await alice.next();
    expect(message.t).toBe('error');
    if (message.t === 'error') expect(message.message).toMatch(/at least/i);
    alice.close();
  });

  it('deals a game and keeps both screens in sync through resolution', async () => {
    const alice = await connect('GAME', 'Alice');
    const aliceWelcome = await alice.next();
    if (aliceWelcome.t !== 'welcome') throw new Error('expected welcome');
    await waitForState(alice, (v) => v.players.length === 1);

    const bob = await connect('GAME', 'Bob');
    const bobWelcome = await bob.next();
    if (bobWelcome.t !== 'welcome') throw new Error('expected welcome');
    await waitForState(alice, (v) => v.players.length === 2);
    await waitForState(bob, (v) => v.players.length === 2);

    // Host starts the reading.
    alice.ws.send(JSON.stringify({ t: 'start' }));
    const aliceBidding = await waitForState(alice, (v) => v.phase === 'bidding');
    const bobBidding = await waitForState(bob, (v) => v.phase === 'bidding');
    expect(aliceBidding.itemId).toBeTruthy();
    expect(aliceBidding.itemId).toBe(bobBidding.itemId);
    expect(aliceBidding.deck).toEqual(bobBidding.deck);

    // Both bid; the round resolves as soon as the table is complete.
    alice.ws.send(JSON.stringify({ t: 'bid', amount: 40 }));
    bob.ws.send(JSON.stringify({ t: 'bid', amount: 10 }));

    const aliceReveal = await waitForState(alice, (v) => v.phase === 'reveal');
    const bobReveal = await waitForState(bob, (v) => v.phase === 'reveal');

    expect(aliceReveal.history.at(-1)?.winner).toBe(aliceWelcome.playerId);
    expect(bobReveal.history.at(-1)?.winner).toBe(aliceWelcome.playerId);
    expect(aliceReveal.history.at(-1)?.price).toBe(40);

    alice.close();
    bob.close();
  });

  it("hides the opponent's secret collection and un-revealed bid before the gavel", async () => {
    const alice = await connect('SCRT', 'Alice');
    const aw = await alice.next();
    if (aw.t !== 'welcome') throw new Error('expected welcome');
    await waitForState(alice, (v) => v.players.length === 1);

    const bob = await connect('SCRT', 'Bob');
    const bw = await bob.next();
    if (bw.t !== 'welcome') throw new Error('expected welcome');
    await waitForState(alice, (v) => v.players.length === 2);
    await waitForState(bob, (v) => v.players.length === 2);

    alice.ws.send(JSON.stringify({ t: 'start' }));
    const view = await waitForState(alice, (v) => v.phase === 'bidding');

    // My own collection is visible to me...
    expect(viewForId(view, aw.playerId).collection).not.toBeNull();
    // ...and Bob's is not.
    expect(viewForId(view, bw.playerId).collection).toBeNull();
    // Nobody's bid is visible yet, even though Alice has now bid.
    alice.ws.send(JSON.stringify({ t: 'bid', amount: 25 }));
    const afterBid = await waitForState(alice, (v) => vFor(v, aw.playerId).hasBid);
    expect(vFor(afterBid, aw.playerId).bid).toBeNull();
    expect(vFor(afterBid, bw.playerId).bid).toBeNull();

    alice.close();
    bob.close();
  });

  it('rejects an overbid without disturbing the other player', async () => {
    const alice = await connect('OVER', 'Alice');
    await alice.next();
    await waitForState(alice, (v) => v.players.length === 1);
    const bob = await connect('OVER', 'Bob');
    await bob.next();
    await waitForState(alice, (v) => v.players.length === 2);
    await waitForState(bob, (v) => v.players.length === 2);

    alice.ws.send(JSON.stringify({ t: 'start' }));
    await waitForState(alice, (v) => v.phase === 'bidding');

    alice.ws.send(JSON.stringify({ t: 'bid', amount: 9999 }));
    const message = await alice.next();
    expect(message.t).toBe('error');
    if (message.t === 'error') expect(message.message).toMatch(/more coins/i);

    alice.close();
    bob.close();
  });

  it('burns a lot when both players bid the same amount', async () => {
    const alice = await connect('TIE', 'Alice');
    await alice.next();
    await waitForState(alice, (v) => v.players.length === 1);
    const bob = await connect('TIE', 'Bob');
    await bob.next();
    await waitForState(alice, (v) => v.players.length === 2);
    await waitForState(bob, (v) => v.players.length === 2);

    alice.ws.send(JSON.stringify({ t: 'start' }));
    await waitForState(alice, (v) => v.phase === 'bidding');
    alice.ws.send(JSON.stringify({ t: 'bid', amount: 30 }));
    bob.ws.send(JSON.stringify({ t: 'bid', amount: 30 }));

    const reveal = await waitForState(alice, (v) => v.phase === 'reveal');
    expect(reveal.history.at(-1)?.outcome).toBe('burned');
    expect(reveal.history.at(-1)?.winner).toBeNull();

    alice.close();
    bob.close();
  });

  it('seats bots, removes them, and plays a full reading against one', async () => {
    const alice = await connect('BOTS', 'Alice');
    const aw = await alice.next();
    if (aw.t !== 'welcome') throw new Error('expected welcome');
    await waitForState(alice, (v) => v.players.length === 1);

    // Seat a bot, then remove it, then seat another — the host controls both.
    alice.ws.send(JSON.stringify({ t: 'addBot' }));
    const withBot = await waitForState(alice, (v) => v.players.length === 2);
    const firstBot = withBot.players.find((p) => p.isBot);
    expect(firstBot).toBeDefined();

    alice.ws.send(JSON.stringify({ t: 'removeBot', id: firstBot?.id }));
    await waitForState(alice, (v) => v.players.length === 1);

    alice.ws.send(JSON.stringify({ t: 'addBot' }));
    await waitForState(alice, (v) => v.players.length === 2);

    alice.ws.send(JSON.stringify({ t: 'start' }));
    await waitForState(alice, (v) => v.phase === 'bidding' && v.round === 1);
    let view: GameView;

    // Play every lot. Bots answer as soon as the last human has bid, so the only
    // thing that needs driving is the reveal -> next-lot transition, which is a
    // real 7s alarm in production. Firing it directly keeps the suite fast
    // without pretending the timer does not exist.
    for (let round = 1; round <= ROUNDS; round += 1) {
      await waitForState(alice, (v) => v.phase === 'bidding' && v.round === round);
      alice.ws.send(JSON.stringify({ t: 'bid', amount: 10 }));
      view = await waitForState(alice, (v) => v.phase === 'reveal' && v.round === round);
      expect(view.history.at(-1)?.bids[aw.playerId]).toBe(10);
      await fireAlarm('BOTS');
    }

    view = await waitForState(alice, (v) => v.phase === 'recap');
    expect(view.history).toHaveLength(ROUNDS);

    // The recap reveals every collection — that is the payoff screen.
    for (const player of view.players) expect(player.collection).not.toBeNull();

    alice.close();
  }, 30_000);
});

/** Fires the room's alarm, which is how production advances past a reveal. */
async function fireAlarm(code: string): Promise<void> {
  await runInDurableObject(stubFor(code), async (instance: RoomDO) => {
    await instance.alarm();
  });
}

function vFor(view: GameView, id: string) {
  const player = view.players.find((p) => p.id === id);
  if (!player) throw new Error(`No player ${id}`);
  return player;
}

describe('durable object internals', () => {
  it('persists the room to storage so it survives eviction', async () => {
    const alice = await connect('PERS', 'Alice');
    await alice.next();
    await waitForState(alice, (v) => v.players.length === 1);

    const stored = await runInDurableObject(stubFor('PERS'), async (_instance: RoomDO, state) => {
      return state.storage.get<{ state: { order: string[] } }>('room');
    });
    expect(stored?.state.order).toHaveLength(1);
    alice.close();
  });

  it('arms an alarm for the bidding deadline', async () => {
    const alice = await connect('ALRM', 'Alice');
    await alice.next();
    await waitForState(alice, (v) => v.players.length === 1);
    const bob = await connect('ALRM', 'Bob');
    await bob.next();
    await waitForState(alice, (v) => v.players.length === 2);
    await waitForState(bob, (v) => v.players.length === 2);

    alice.ws.send(JSON.stringify({ t: 'start' }));
    await waitForState(alice, (v) => v.phase === 'bidding');

    const alarm = await runInDurableObject(stubFor('ALRM'), async (_i: RoomDO, state) => {
      return state.storage.getAlarm();
    });
    expect(alarm).toBeTypeOf('number');
    expect(alarm).toBeGreaterThan(Date.now());

    alice.close();
    bob.close();
  });

  it('treats non-bidders as passing when the deadline fires', async () => {
    const alice = await connect('TIME', 'Alice');
    const aw = await alice.next();
    if (aw.t !== 'welcome') throw new Error('expected welcome');
    await waitForState(alice, (v) => v.players.length === 1);
    const bob = await connect('TIME', 'Bob');
    await bob.next();
    await waitForState(alice, (v) => v.players.length === 2);
    await waitForState(bob, (v) => v.players.length === 2);

    alice.ws.send(JSON.stringify({ t: 'start' }));
    await waitForState(alice, (v) => v.phase === 'bidding');

    // Only Alice bids; force the alarm rather than waiting 30 real seconds.
    alice.ws.send(JSON.stringify({ t: 'bid', amount: 7 }));
    await waitForState(alice, (v) => vFor(v, aw.playerId).hasBid);

    await runInDurableObject(stubFor('TIME'), async (instance: RoomDO) => {
      await instance.alarm();
    });

    const reveal = await waitForState(alice, (v) => v.phase === 'reveal' || v.phase === 'recap');
    const last = reveal.history.at(-1);
    expect(last?.bids[aw.playerId]).toBe(7);
    const bobId = reveal.players.find((p) => p.name === 'Bob')?.id as string;
    expect(last?.bids[bobId]).toBe(0);

    alice.close();
    bob.close();
  });
});
