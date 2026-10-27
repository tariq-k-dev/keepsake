import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Single source of truth for room + connection state, shared by every screen.
 *
 * Deliberately a hand-rolled store rather than a context provider with reducers:
 * there is exactly one socket and one view, and the components that need it are
 * few. A 40-line store is easier to reason about than a state machine library,
 * and it keeps the transport (which owns the socket) out of React's render path.
 */

import { RoomSocket, clearToken, type ConnectionStatus } from './socket';
import type { ClientMessage, GameView } from '../../shared/types';

interface SessionState {
  status: ConnectionStatus;
  view: GameView | null;
  playerId: string | null;
  error: string | null;
  /** Clock skew in ms: serverNow - clientNow, measured per frame. */
  skew: number;
}

let state: SessionState = {
  status: 'idle',
  view: null,
  playerId: null,
  error: null,
  skew: 0,
};
let socket: RoomSocket | null = null;
let roomCode: string | null = null;
const listeners = new Set<() => void>();

function emit(next: Partial<SessionState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): SessionState {
  return state;
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function joinRoom(code: string, name: string): void {
  leave();
  roomCode = code.toUpperCase();
  socket = new RoomSocket(roomCode, name, {
    onStatus: (status) => emit({ status }),
    onWelcome: (playerId) => emit({ playerId }),
    onError: (message) => emit({ error: message }),
    onView: (view, serverNow) =>
      emit({
        view,
        // Anchor the countdown to the server clock so a client with a skewed
        // system time does not show a deadline that already passed.
        skew: serverNow - Date.now(),
        error: null,
      }),
  });
  socket.connect();
}

export function leave(): void {
  socket?.close();
  socket = null;
  roomCode = null;
  state = { status: 'idle', view: null, playerId: null, error: null, skew: 0 };
  for (const listener of listeners) listener();
}

export function send(message: ClientMessage): void {
  socket?.send(message);
}

export function forgetRoom(code: string): void {
  clearToken(code);
}

export function currentRoom(): string | null {
  return roomCode;
}

export function dismissError(): void {
  emit({ error: null });
}

/**
 * A displayed countdown that ticks locally but resyncs to the server deadline.
 * Deriving from `deadline - (Date.now() + skew)` means the number is correct even
 * if the browser throttles timers in a background tab.
 */
export function useCountdown(deadline: number | null, skew: number): number | null {
  // `now` is state, not a render-time `Date.now()` call: reading the clock during
  // render makes the component impure and its output unreproducible. The interval
  // is the only thing that advances it, so a re-render for any other reason shows
  // the same number rather than a silently different one.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    // Only the timer writes `now`; no synchronous setState on mount.
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadline]);

  if (deadline === null) return null;
  return Math.max(0, deadline - (now + skew));
}
