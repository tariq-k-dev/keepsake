import { useState } from 'react';
import { Shell, Wordmark, Panel, Button, Label } from '../components/ui';
import { joinRoom, send } from '../lib/session';
import { navigateToRoom } from '../lib/router';

/**
 * The front door. Three jobs, in priority order:
 *  1. let a solo visitor start a game against bots in two taps (the recruiter path)
 *  2. let a group create a room and share a code
 *  3. let someone with a code join
 *
 * The rules are stated here rather than behind a "How to play" link, because a
 * party game that needs a rules page has already lost the first-time player.
 */
export function Landing({ initialCode }: { initialCode: string | null }) {
  const [name, setName] = useState(() => readStoredName());
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const trimmedName = name.trim();

  function rememberName(value: string) {
    setName(value);
    try {
      window.localStorage.setItem('keepsake.name', value);
    } catch {
      // storage unavailable; the name just will not persist
    }
  }

  async function createRoom(bots: number) {
    if (!trimmedName) {
      setProblem('Tell us what to call you first.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch('/api/room', { method: 'POST' });
      if (!response.ok) throw new Error('Could not open a room. Try again.');
      const { code: minted } = (await response.json()) as { code: string };
      navigateToRoom(minted);
      joinRoom(minted, trimmedName);
      // Bots are seated after the socket opens; the host request is idempotent
      // and the server rejects it if we are not the host, so retrying is safe.
      // "Play now" must actually play: seat the bots, then deal. Landing a solo
      // visitor in a lobby that needs a second click defeats the whole point.
      if (bots > 0) seatBotsThenStart(bots);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function join() {
    const clean = code.trim().toUpperCase();
    if (clean.length !== 4) {
      setProblem('Room codes are four characters.');
      return;
    }
    if (!trimmedName) {
      setProblem('Tell us what to call you first.');
      return;
    }
    setProblem(null);
    navigateToRoom(clean);
    joinRoom(clean, trimmedName);
  }

  return (
    <div className="min-h-dvh bg-ink-950 text-parchment-50">
      <Shell>
        <Wordmark />

        <Panel className="mt-2">
          <p className="font-display text-lg leading-snug text-parchment-200 sm:text-xl">
            Grandmother left everything. Six heirlooms, six sealed bids, and nobody shows their hand
            until the gavel falls.
          </p>

          <ol className="mt-4 space-y-2 text-sm text-parchment-400">
            <Rule n="1">
              You start with <strong className="text-parchment-200">100 coins</strong> and a{' '}
              <strong className="text-parchment-200">secret collection</strong> only you can see.
            </Rule>
            <Rule n="2">
              Each lot is worth <strong className="text-parchment-200">triple</strong> to whoever
              holds its collection.
            </Rule>
            <Rule n="3">
              Everyone bids at once, in secret. Highest bid wins and pays what they bid.
            </Rule>
            <Rule n="4">
              A <strong className="text-burnt-400">tie destroys the lot</strong> — nobody scores,
              nobody pays.
            </Rule>
            <Rule n="5">
              At the end, lots plus leftover coins decide the estate. Richest heir wins.
            </Rule>
          </ol>
        </Panel>

        <Panel className="mt-4">
          <label htmlFor="name" className="block">
            <Label>Your name</Label>
          </label>
          <input
            id="name"
            value={name}
            onChange={(event) => rememberName(event.target.value.slice(0, 16))}
            placeholder="Heir"
            autoComplete="nickname"
            maxLength={16}
            className="mt-1.5 min-h-11 w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-base text-parchment-50 placeholder:text-parchment-800 focus:border-brass-500 focus:outline-none"
          />

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button onClick={() => void createRoom(0)} disabled={busy}>
              Create a room
            </Button>
            <Button variant="primary" onClick={() => void createRoom(3)} disabled={busy}>
              Play now vs. bots
            </Button>
          </div>

          <div className="mt-5 border-t border-ink-800 pt-4">
            <Label>Have a code?</Label>
            <div className="mt-1.5 flex gap-2">
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 4))}
                placeholder="ABCD"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-label="Room code"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-850 px-3 text-center font-display text-xl tracking-[0.4em] text-parchment-50 placeholder:text-parchment-800 focus:border-brass-500 focus:outline-none"
              />
              <Button onClick={join} disabled={busy} className="px-5">
                Join
              </Button>
            </div>
          </div>

          {problem ? (
            <p role="alert" className="mt-3 text-sm text-burnt-400">
              {problem}
            </p>
          ) : null}
        </Panel>

        <footer className="mt-6 pb-8 text-center text-[11px] text-parchment-800">
          No accounts. No installs. Share a code, play on any phone.
        </footer>
      </Shell>
    </div>
  );
}

function Rule({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brass-600/40 text-[11px] font-semibold text-brass-400">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function readStoredName(): string {
  try {
    return window.localStorage.getItem('keepsake.name') ?? '';
  } catch {
    return '';
  }
}

/**
 * Seats `count` bots, then starts the reading.
 *
 * The socket handshake is async and a host request sent before the welcome frame
 * is rejected as "not the host", so this steps rather than assuming the socket
 * is ready. The start is retried a couple of times for the same reason: the
 * seats must exist before the deal is accepted.
 */
function seatBotsThenStart(count: number): void {
  let seated = 0;
  const seatNext = () => {
    if (seated < count) {
      send({ t: 'addBot' });
      seated += 1;
      setTimeout(seatNext, 240);
      return;
    }
    // Give the last addBot a beat to commit before dealing.
    setTimeout(() => {
      send({ t: 'start' });
      setTimeout(() => send({ t: 'start' }), 500);
    }, 320);
  };
  setTimeout(seatNext, 450);
}
