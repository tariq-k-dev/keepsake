/**
 * The room Durable Object.
 *
 * Why a DO: a party game needs ONE writer. All bids for a room land in a single
 * object, so "did everyone bid yet?" is a local check, not a distributed race.
 * Cloudflare guarantees a single active instance and serialised storage access
 * per DO, which is exactly the consistency model an auction needs.
 *
 * Why hibernation: `ctx.acceptWebSocket()` (the Hibernation API) lets the room
 * sleep between messages. A party game is idle most of the time — during
 * conversation, between sessions — but with plain `server.accept()` the object
 * would bill duration the entire time a socket is open. Hibernating means an
 * idle room costs effectively nothing, which fits the free tier.
 *
 * Server authority: clients never mutate state. They send intents
 * (`bid`, `start`, `addBot`) and receive projections built by
 * `viewFor()`, which is the secrecy boundary — a player literally cannot see
 * another player's un-revealed bid, because it was never serialised to them.
 */

import { DurableObject } from 'cloudflare:workers';
import {
  addPlayer,
  advance,
  allBidsIn,
  createRoom,
  deal,
  mulberry32,
  placeBid,
  removePlayer,
  resolveRound,
  viewFor,
} from '../shared/engine';
import { BOT_NAMES, botStyleFor, decideBid } from '../shared/bots';
import {
  BID_SECONDS,
  MAX_BOTS,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  RECAP_SECONDS,
  REVEAL_SECONDS,
} from '../shared/constants';
import type { ClientMessage, GameView, RoomState, ServerMessage } from '../shared/types';

interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
}

/** What we stash on the socket so a hibernated room can rebuild its table. */
interface Attachment {
  playerId: string;
  token: string;
}

interface PersistedRoom {
  state: RoomState;
  /** playerId -> resume token. Reconnect identity, no accounts. */
  tokens: Record<string, string>;
  /** playerId -> epoch ms after which a lobby seat may be reclaimed. */
  graceUntil?: Record<string, number>;
}

const STORAGE_KEY = 'room';

/**
 * How long a disconnected lobby seat is held before it is reclaimed. Long enough
 * to survive a page refresh or a phone lock; short enough that a room does not
 * silently fill up with ghosts from people who closed the tab.
 */
const LOBBY_GRACE_MS = 45_000;

export class RoomDO extends DurableObject<Env> {
  private state: RoomState | null = null;
  private tokens: Record<string, string> = {};
  private graceUntil: Record<string, number> = {};
  private rng = mulberry32(Date.now() ^ 0x9e3779b9);

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private async load(): Promise<PersistedRoom> {
    if (this.state) return { state: this.state, tokens: this.tokens };
    const stored = await this.ctx.storage.get<PersistedRoom>(STORAGE_KEY);
    if (stored) {
      this.state = stored.state;
      this.tokens = stored.tokens;
      this.graceUntil = stored.graceUntil ?? {};
    } else {
      this.state = null;
      this.tokens = {};
      this.graceUntil = {};
    }
    return { state: this.state as RoomState, tokens: this.tokens };
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put<PersistedRoom>(STORAGE_KEY, {
      state: this.state,
      tokens: this.tokens,
      graceUntil: this.graceUntil,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(url);
    }

    // Claims a freshly minted code so two rooms cannot be handed the same one.
    if (url.pathname === '/claim' && request.method === 'POST') {
      await this.load();
      if (this.state && this.state.order.length > 0) {
        return new Response('taken', { status: 409 });
      }
      const code = url.searchParams.get('code') ?? 'ROOM';
      this.state = createRoom(code, '', Date.now());
      await this.persist();
      return Response.json({ claimed: true, code });
    }

    // HTTP probe used by the client to validate a room code before connecting.
    if (url.pathname.endsWith('/info')) {
      const stored = await this.ctx.storage.get<PersistedRoom>(STORAGE_KEY);
      return Response.json({
        exists: Boolean(stored),
        phase: stored?.state.phase ?? null,
        players: stored ? stored.state.order.length : 0,
      });
    }

    return new Response('KEEPSAKE room. Connect over WebSocket.', { status: 426 });
  }

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  private async handleWebSocket(url: URL): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Hibernation API: the runtime can evict this object while the socket stays
    // open, and re-invoke us for the next message.
    this.ctx.acceptWebSocket(server);

    const name = sanitiseName(url.searchParams.get('name'));
    const resume = url.searchParams.get('token');
    await this.load();

    const resumedId = resume ? this.tokens[resume] : undefined;
    const existing = resumedId ? this.state?.players[resumedId] : undefined;

    if (existing && resumedId) {
      // Reconnect: reuse the seat, mark present, issue the same token.
      this.state = {
        ...(this.state as RoomState),
        players: {
          ...(this.state as RoomState).players,
          [resumedId]: { ...existing, connected: true, name: name || existing.name },
        },
        version: (this.state as RoomState).version + 1,
      };
      delete this.graceUntil[resumedId];
      server.serializeAttachment({
        playerId: resumedId,
        token: resume as string,
      } satisfies Attachment);
      await this.persist();
      this.send(server, { t: 'welcome', playerId: resumedId, token: resume as string });
      this.broadcast();
      return new Response(null, { status: 101, webSocket: client });
    }

    // New seat.
    if (!this.state) {
      this.state = createRoom(url.searchParams.get('code') ?? 'ROOM', '', Date.now());
    }
    if (this.state.order.length >= MAX_PLAYERS) {
      this.send(server, { t: 'error', message: 'This room is full.' });
      server.close(1013, 'room full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const playerId = newPlayerId();
    const token = newPlayerId();
    try {
      this.state = addPlayer(
        this.state,
        playerId,
        name || `Heir ${this.state.order.length + 1}`,
        false,
      );
    } catch (error) {
      this.send(server, { t: 'error', message: messageOf(error) });
      server.close(1013, 'cannot join');
      return new Response(null, { status: 101, webSocket: client });
    }

    if (!this.state.hostId) this.state = { ...this.state, hostId: playerId };
    this.tokens[token] = playerId;
    server.serializeAttachment({ playerId, token } satisfies Attachment);

    await this.persist();
    this.send(server, { t: 'welcome', playerId, token });
    this.broadcast();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.load();
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment || !this.state) return;

    let message: ClientMessage;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      this.send(ws, { t: 'error', message: 'Malformed message.' });
      return;
    }

    try {
      await this.handleMessage(ws, attachment.playerId, message);
    } catch (error) {
      this.send(ws, { t: 'error', message: messageOf(error) });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return;
    await this.load();
    if (!this.state) return;

    const player = this.state.players[attachment.playerId];
    if (!player) return;

    // Both phases hold the seat so a refresh or a phone lock keeps identity.
    // A lobby seat is reclaimed after LOBBY_GRACE_MS by the alarm; deleting it
    // here instead would invalidate the resume token and turn every page reload
    // into a brand-new heir with a new name.
    if (this.state.phase === 'lobby' && !player.isBot) {
      this.graceUntil[attachment.playerId] = Date.now() + LOBBY_GRACE_MS;
      this.state = {
        ...this.state,
        players: {
          ...this.state.players,
          [attachment.playerId]: { ...player, connected: false },
        },
        version: this.state.version + 1,
      };
      const due = Math.min(...Object.values(this.graceUntil));
      const existing = await this.ctx.storage.getAlarm();
      if (existing === null || due < existing) await this.ctx.storage.setAlarm(due);
    } else {
      this.state = {
        ...this.state,
        players: {
          ...this.state.players,
          [attachment.playerId]: { ...player, connected: false },
        },
        version: this.state.version + 1,
      };
    }
    await this.persist();
    this.broadcast();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // -------------------------------------------------------------------------
  // Intent handling
  // -------------------------------------------------------------------------

  private async handleMessage(
    ws: WebSocket,
    playerId: string,
    message: ClientMessage,
  ): Promise<void> {
    const state = this.state as RoomState;

    switch (message.t) {
      case 'ping': {
        this.send(ws, { t: 'state', view: this.viewFor(playerId), serverNow: Date.now() });
        return;
      }

      case 'bid': {
        this.state = placeBid(state, playerId, message.amount);
        if (allBidsIn(this.state)) {
          await this.finishRound();
        } else if (this.onlyBotsLeftToBid()) {
          // The last human has committed. Bots should answer the gavel
          // immediately rather than idling until an alarm — a person waiting on
          // a bot after they have already decided experiences it as lag.
          await this.resolveBotsNow();
        } else {
          await this.persist();
          this.broadcast();
        }
        return;
      }

      case 'start': {
        if (playerId !== state.hostId) throw new Error('HOST_ONLY');
        if (state.order.length < MIN_PLAYERS) {
          throw new Error('NEED_MORE_PLAYERS');
        }
        if (state.phase !== 'lobby' && state.phase !== 'recap') {
          throw new Error('ALREADY_STARTED');
        }
        this.state = deal(state, this.rng);
        await this.beginBidding();
        return;
      }

      case 'addBot': {
        if (playerId !== state.hostId) throw new Error('HOST_ONLY');
        if (state.phase !== 'lobby') throw new Error('BOTS_BEFORE_START');
        if (state.order.length >= MAX_PLAYERS) throw new Error('ROOM_FULL');
        if (state.order.filter((id) => state.players[id]?.isBot).length >= MAX_BOTS) {
          throw new Error('MAX_BOTS');
        }
        const botId = `bot-${newPlayerId()}`;
        const used = new Set(state.order.map((id) => state.players[id]?.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Heir ${state.order.length + 1}`;
        this.state = addPlayer(state, botId, name, true);
        await this.persist();
        this.broadcast();
        return;
      }

      case 'removeBot': {
        if (playerId !== state.hostId) throw new Error('HOST_ONLY');
        if (!state.players[message.id]?.isBot) throw new Error('NOT_A_BOT');
        this.state = removePlayer(state, message.id);
        await this.persist();
        this.broadcast();
        return;
      }

      case 'rematch': {
        if (state.phase !== 'recap') throw new Error('NOT_RECAP');
        if (playerId !== state.hostId) throw new Error('HOST_ONLY');
        // Restart in the lobby so disconnected seats can rejoin before the deal.
        this.state = {
          ...state,
          phase: 'lobby',
          round: 0,
          deck: [],
          history: [],
          deadline: null,
          version: state.version + 1,
          players: Object.fromEntries(
            Object.entries(state.players).map(([id, p]) => [
              id,
              { ...p, coins: 0, items: [], bid: null, hasBid: false },
            ]),
          ),
        };
        this.state = deal(this.state, this.rng);
        await this.beginBidding();
        return;
      }

      default: {
        throw new Error('UNKNOWN_ACTION');
      }
    }
  }

  /** Opens a bidding round: arms the bot timers and the round deadline. */
  private async beginBidding(): Promise<void> {
    const state = this.state as RoomState;
    const deadline = Date.now() + BID_SECONDS * 1000;
    this.state = { ...state, phase: 'bidding', deadline, version: state.version + 1 };
    await this.persist();
    await this.ctx.storage.setAlarm(deadline);
    this.broadcast();
    await this.scheduleNextBot();
  }

  /**
   * Bots bid on staggered delays so a table of humans sees them "thinking"
   * rather than five bids landing in the same millisecond.
   *
   * These are driven by the DO alarm, not `setTimeout`. A timer does not
   * survive hibernation or eviction: the object can be evicted while it is
   * idle, and any pending `setTimeout` is lost with it, which left bots that
   * never bid and rounds that stalled. The alarm is durable storage, so it
   * wakes the room exactly when the next bot is due.
   */
  private async scheduleNextBot(): Promise<void> {
    const state = this.state;
    if (!state || state.phase !== 'bidding') return;

    const pending = state.order.filter((id) => {
      const p = state.players[id];
      return p?.isBot && !p.hasBid;
    });
    if (pending.length === 0) {
      // Nothing left to do but wait for the humans or the round deadline.
      await this.ctx.storage.setAlarm(state.deadline ?? Date.now() + BID_SECONDS * 1000);
      return;
    }

    // Stagger: each pending bot gets its own wake-up, ~600-1600ms apart.
    const due = Date.now() + 600 + Math.floor(this.rng() * 1000);
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || due < existing) {
      await this.ctx.storage.setAlarm(due);
    }
  }

  private onlyBotsLeftToBid(): boolean {
    const state = this.state;
    if (!state) return false;
    const pending = state.order.filter((id) => !state.players[id]?.hasBid);
    return pending.length > 0 && pending.every((id) => state.players[id]?.isBot);
  }

  /** Bids every remaining bot in one pass, then resolves the lot. */
  private async resolveBotsNow(): Promise<void> {
    for (;;) {
      const state = this.state;
      if (!state || state.phase !== 'bidding') return;
      if (allBidsIn(state)) {
        await this.finishRound();
        return;
      }
      const bidPlaced = await this.bidForNextBot();
      if (!bidPlaced) return;
    }
  }

  /** Places a bid for one waiting bot. Called from `alarm()`. */
  private async bidForNextBot(): Promise<boolean> {
    const state = this.state;
    if (!state || state.phase !== 'bidding') return false;

    const next = state.order.find((id) => {
      const p = state.players[id];
      return p?.isBot && !p.hasBid;
    });
    if (!next) return false;

    const player = state.players[next];
    if (!player) return false;

    const amount = decideBid(botStyleFor(next), { state, playerId: next, rng: this.rng });
    this.state = placeBid(state, next, Math.max(0, Math.min(amount, player.coins)));

    if (allBidsIn(this.state)) {
      await this.finishRound();
    } else {
      await this.persist();
      this.broadcast();
      await this.scheduleNextBot();
    }
    return true;
  }

  /** Resolves the lot, reveals it, and arms the reveal timer. */
  private async finishRound(): Promise<void> {
    if (!this.state) return;
    this.state = resolveRound(this.state);
    const deadline = Date.now() + REVEAL_SECONDS * 1000;
    this.state = { ...this.state, deadline };
    await this.persist();
    await this.ctx.storage.setAlarm(deadline);
    this.broadcast();
  }

  /**
   * Single timer channel for the whole room. Every phase transition sets the
   * alarm to that phase's deadline, so a hibernated room wakes exactly when it
   * needs to and never polls.
   */
  async alarm(): Promise<void> {
    await this.load();
    const state = this.state;
    if (!state) return;

    if (state.phase === 'bidding') {
      // A pending bot wakes first; the round deadline passes everyone who never
      // bid. Checking the deadline (not just the phase) is what prevents a bot
      // wake-up from prematurely resolving a round the humans are still in.
      const pastDeadline = state.deadline !== null && Date.now() >= state.deadline;

      if (!pastDeadline) {
        const botBid = await this.bidForNextBot();
        if (botBid) return;
      }

      // Deadline hit (or no bots left and the clock is done): non-bidders pass.
      for (const id of state.order) {
        const player = this.state?.players[id];
        if (player && !player.hasBid) {
          this.state = placeBid(this.state as RoomState, id, 0);
        }
      }
      await this.finishRound();
      return;
    }

    if (state.phase === 'reveal') {
      this.state = advance(state);
      if (this.state.phase === 'bidding') {
        await this.beginBidding();
      } else {
        const deadline = Date.now() + RECAP_SECONDS * 1000;
        this.state = { ...this.state, deadline };
        await this.persist();
        await this.ctx.storage.setAlarm(deadline);
        this.broadcast();
      }
      return;
    }

    if (state.phase === 'lobby') {
      // Reclaim seats whose grace window lapsed.
      const now = Date.now();
      let changed = false;
      let nextDue: number | null = null;
      for (const [playerId, due] of Object.entries(this.graceUntil)) {
        if (due <= now) {
          const player = this.state?.players[playerId];
          if (player && !player.connected) {
            this.state = removePlayer(this.state as RoomState, playerId);
            const token = Object.keys(this.tokens).find((t) => this.tokens[t] === playerId);
            if (token) delete this.tokens[token];
            delete this.graceUntil[playerId];
            changed = true;
          } else {
            delete this.graceUntil[playerId];
          }
        } else if (nextDue === null || due < nextDue) {
          nextDue = due;
        }
      }
      if (nextDue !== null) await this.ctx.storage.setAlarm(nextDue);
      if (changed) {
        await this.persist();
        this.broadcast();
      }
      return;
    }

    if (state.phase === 'recap') {
      // Long-idle room: drop the seats but keep the object, so the code can be
      // reused by a fresh group instead of accumulating dead rooms forever.
      this.state = {
        ...state,
        phase: 'lobby',
        round: 0,
        deck: [],
        history: [],
        deadline: null,
        version: state.version + 1,
        order: [],
        players: {},
        hostId: '',
      };
      this.tokens = {};
      await this.persist();
      this.broadcast();
    }
  }

  // -------------------------------------------------------------------------
  // Broadcasting
  // -------------------------------------------------------------------------

  private viewFor(viewerId: string | null): GameView {
    return viewFor(this.state as RoomState, viewerId, Date.now());
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // The socket died between the broadcast and this frame; the close handler
      // will clean up the seat.
    }
  }

  /**
   * Each client gets its OWN projection, so two players connected to the same
   * room receive different payloads. That is what enforces secrecy — there is
   * no shared broadcast body that could leak a rival's bid.
   */
  private broadcast(): void {
    if (!this.state) return;
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (!attachment) continue;
      if (!this.state.players[attachment.playerId]) continue;
      const frame: ServerMessage = {
        t: 'state',
        view: viewFor(this.state, attachment.playerId, now),
        serverNow: now,
      };
      this.send(ws, frame);
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sanitiseName(raw: string | null): string {
  if (!raw) return '';
  // Strip C0 controls and DEL. Built from char codes rather than a literal
  // range so the source stays free of invisible characters.
  let clean = '';
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) clean += char;
  }
  return clean.trim().slice(0, MAX_NAME_LENGTH);
}

function newPlayerId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Strip the engine's SCREAMING_SNAKE codes into readable copy. Anything
  // unrecognised is genericised rather than echoed, so internal errors do not
  // become user-facing text.
  const known: Record<string, string> = {
    ROOM_FULL: 'This room is full.',
    GAME_ALREADY_STARTED: 'That game has already begun.',
    NOT_BIDDING: 'Bidding is closed for this lot.',
    NO_SUCH_PLAYER: 'You are not seated at this table.',
    ALREADY_BID: 'You have already bid this round.',
    BAD_BID: 'That is not a valid bid.',
    BID_EXCEEDS_COINS: 'You cannot bid more coins than you hold.',
    NOT_REVEAL: 'That action is not available yet.',
    NO_ITEM_FOR_ROUND: 'No lot is on the block.',
    HOST_ONLY: 'Only the host can do that.',
    NEED_MORE_PLAYERS: `You need at least ${MIN_PLAYERS} heirs to begin.`,
    ALREADY_STARTED: 'The reading is already under way.',
    BOTS_BEFORE_START: 'Bots can only be seated before the reading.',
    MAX_BOTS: 'No more bots at this table.',
    NOT_A_BOT: 'That heir is not a bot.',
    NOT_RECAP: 'Finish this reading first.',
    UNKNOWN_ACTION: 'Unknown action.',
  };
  return known[raw] ?? 'Something went wrong. Try again.';
}
