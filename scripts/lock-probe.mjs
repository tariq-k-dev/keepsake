/**
 * Reproduces the SQLITE_BUSY on the Durable Object state.
 *
 * Hypothesis: two `wrangler dev` processes pointed at the same `.wrangler/state`
 * directory (the default) will both open the same per-room SQLite file, and one
 * will fail with "database is locked". This is a *local dev* hazard only —
 * production DOs are single-owner — but it happens automatically on the day you
 * run `pnpm dev` while a `wrangler dev` from a previous session is still alive.
 *
 * Runs N full games as fast as possible against whatever server it is given, so
 * the writes overlap.
 */
const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:5173';
const GAMES = Number(process.env.PROBE_GAMES ?? 6);

async function playOne(index) {
  // Create a room through the real API.
  const created = await fetch(`${BASE}/api/room`, { method: 'POST' });
  if (!created.ok) return { index, ok: false, stage: 'mint', detail: created.status };
  const { code } = await created.json();

  const base = BASE.replace('http://', '');
  const ws = new WebSocket(`ws://${base}/ws?code=${code}&name=P${index}`);
  const frames = [];
  ws.addEventListener('message', (e) => frames.push(JSON.parse(e.data)));

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('ws error')));
    setTimeout(() => reject(new Error('ws timeout')), 8000);
  });

  // Wait for the welcome + first state.
  await waitFor(frames, (m) => m.t === 'welcome', 8000);
  ws.send(JSON.stringify({ t: 'addBot' }));
  ws.send(JSON.stringify({ t: 'addBot' }));
  await sleep(300);
  ws.send(JSON.stringify({ t: 'start' }));

  for (let round = 1; round <= 6; round += 1) {
    const settled = await waitFor(
      frames,
      (m) => m.t === 'state' && m.view.phase === 'bidding' && m.view.round === round,
      15000,
    ).catch(() => null);
    if (!settled) break;
    ws.send(JSON.stringify({ t: 'bid', amount: 15 }));
    await waitFor(
      frames,
      (m) => m.t === 'state' && (m.view.phase === 'reveal' || m.view.phase === 'recap'),
      15000,
    ).catch(() => null);
  }

  const errors = frames.filter((m) => m.t === 'error').map((m) => m.message);
  ws.close();
  return { index, ok: true, code, frames: frames.length, errors };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(frames, predicate, timeout) {
  const start = Date.now();
  let cursor = 0;
  while (Date.now() - start < timeout) {
    while (cursor < frames.length) {
      if (predicate(frames[cursor])) return frames[cursor];
      cursor += 1;
    }
    await sleep(50);
  }
  throw new Error('waitFor timeout');
}

const results = await Promise.all(
  Array.from({ length: GAMES }, (_, i) =>
    playOne(i).catch((e) => ({ index: i, ok: false, detail: e.message })),
  ),
);
console.log(JSON.stringify(results, null, 1));
