/**
 * Worker entry point.
 *
 * One deployable: static assets + the WebSocket endpoint. Durable Objects cannot
 * be created inside a Pages project, so this ships as a Worker with static
 * assets (`wrangler deploy`) rather than Pages Functions. Same free tier, one
 * deploy, and `/ws` is same-origin — no CORS, no second domain.
 */

import { RoomDO } from './room';
import { CODE_ALPHABET, CODE_LENGTH } from '../shared/constants';

export { RoomDO };

interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') return connect(request, env, url);

    if (url.pathname === '/api/room' && request.method === 'POST') {
      return mintRoom(env);
    }

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'keepsake' });
    }

    // Everything else is the SPA.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/**
 * Mints a room code and touches the Durable Object once so the code is claimed.
 * Codes are random from a 32-character alphabet (no I/O/0/1, so they survive
 * being read aloud across a room), giving 32^4 ≈ 1.05M combinations.
 */
async function mintRoom(env: Env): Promise<Response> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const probe = await stub.fetch(`https://room/info`);
    const info = (await probe.json()) as { exists: boolean };
    if (info.exists) continue;

    const claimed = await stub.fetch(
      new Request(`https://room/claim?code=${code}`, { method: 'POST' }),
    );
    if (claimed.ok) {
      return Response.json({ code }, { headers: { 'cache-control': 'no-store' } });
    }
  }
  return Response.json({ error: 'Could not allocate a room. Try again.' }, { status: 503 });
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Proxies the WebSocket upgrade to the room's Durable Object. The code travels
 * in the path so the DO can report its own code back to clients.
 */
async function connect(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected a WebSocket upgrade.', { status: 426 });
  }
  const code = (url.searchParams.get('code') ?? '').toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    return new Response('Invalid room code.', { status: 400 });
  }
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  const target = new URL('https://room/ws');
  target.search = url.search;
  target.searchParams.set('code', code);
  return stub.fetch(new Request(target, request));
}
