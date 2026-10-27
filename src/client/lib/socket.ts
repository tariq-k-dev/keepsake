/**
 * WebSocket transport for the client.
 *
 * Responsibilities, deliberately narrow:
 *  - one socket, automatic reconnect with exponential backoff
 *  - resume via the token the server issued, so a refresh keeps your seat
 *  - re-sync on `visibilitychange`, because phones suspend sockets when the
 *    screen locks and the browser does not always tell you the socket died
 *
 * It holds no game state: it emits frames and the React layer decides what to
 * render. Keeping the transport dumb is what makes it testable.
 */

import type { ClientMessage, GameView, ServerMessage } from '../../shared/types';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface TransportHandlers {
  onView: (view: GameView, serverNow: number) => void;
  onStatus: (status: ConnectionStatus) => void;
  onError: (message: string) => void;
  onWelcome: (playerId: string, token: string) => void;
}

const TOKEN_KEY = 'keepsake.token';

export class RoomSocket {
  private ws: WebSocket | null = null;
  private code: string;
  private name: string;
  private token: string | null;
  private handlers: TransportHandlers;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;
  private visibilityBound = false;

  constructor(code: string, name: string, handlers: TransportHandlers) {
    this.code = code;
    this.name = name;
    this.handlers = handlers;
    this.token = readToken(code);
  }

  connect(): void {
    this.closedByUs = false;
    this.open();
    this.bindVisibility();
  }

  private bindVisibility(): void {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      // A backgrounded phone drops the socket without an error event. If the
      // socket is not open on return, reconnect immediately rather than waiting
      // for the backoff timer — the player is looking at the screen right now.
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.attempt = 0;
        this.open();
      } else {
        this.send({ t: 'ping' });
      }
    });
  }

  private open(): void {
    this.handlers.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const url = new URL('/ws', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('code', this.code);
    url.searchParams.set('name', this.name);
    if (this.token) url.searchParams.set('token', this.token);

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.handlers.onStatus('error');
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.handlers.onStatus('open');
    });

    socket.addEventListener('message', (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (message.t === 'state') this.handlers.onView(message.view, message.serverNow);
      else if (message.t === 'welcome') {
        this.token = message.token;
        writeToken(this.code, message.token);
        this.handlers.onWelcome(message.playerId, message.token);
      } else if (message.t === 'error') this.handlers.onError(message.message);
    });

    socket.addEventListener('close', () => {
      if (this.closedByUs) {
        this.handlers.onStatus('closed');
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // `close` always follows; let it own the reconnect so we do not double up.
      this.handlers.onStatus('reconnecting');
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.attempt += 1;
    // 0.4s, 0.8s, 1.6s, 3.2s, then hold at 5s. A party game reconnects in
    // seconds, so the cap only matters for a genuinely dead room.
    const delay = Math.min(400 * 2 ** (this.attempt - 1), 5_000);
    this.handlers.onStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// Token persistence, keyed by room code so one browser can hold several rooms.
// ---------------------------------------------------------------------------

function storageKey(code: string): string {
  return `${TOKEN_KEY}.${code}`;
}

function readToken(code: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(code));
  } catch {
    return null;
  }
}

function writeToken(code: string, token: string): void {
  try {
    window.localStorage.setItem(storageKey(code), token);
  } catch {
    // Private browsing with storage disabled: reconnect still works within the
    // session, it just cannot survive a reload.
  }
}

export function clearToken(code: string): void {
  try {
    window.localStorage.removeItem(storageKey(code));
  } catch {
    // ignore
  }
}
