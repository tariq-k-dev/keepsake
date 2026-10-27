/**
 * Routing without a router.
 *
 * Two URLs matter: `/` and `/room/CODE`. A real router would be ~40KB to serve
 * two routes, and this app has no nested navigation need. The room code lives in
 * the path so a refresh — or a link pasted into a group chat — lands in the same
 * seat, which is the single most important URL property for a party game.
 *
 * Kept out of `App.tsx` so that file exports only components: mixing component
 * and plain-function exports from one module breaks React Fast Refresh.
 */

import { leave } from './session';

export interface Route {
  room: string | null;
}

export function readRoute(): Route {
  const match = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{4})/);
  return { room: match?.[1]?.toUpperCase() ?? null };
}

export function navigateToRoom(code: string): void {
  window.history.pushState({}, '', `/room/${code}`);
}

export function navigateHome(): void {
  leave();
  window.history.pushState({}, '', '/');
  // `pushState` does not fire `popstate`, so announce it ourselves.
  window.dispatchEvent(new Event('popstate'));
}
