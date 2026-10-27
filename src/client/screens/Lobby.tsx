import { useState } from 'react';
import { Shell, Wordmark, Panel, Button, Label, PlayerRow } from '../components/ui';
import { send } from '../lib/session';
import type { GameView } from '../../shared/types';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../shared/constants';

/**
 * The waiting room. The only thing that matters here is the code: it is the
 * largest text on the screen, in a monospace-ish display face with wide tracking
 * so it is readable across a table, and it copies on tap.
 */
export function Lobby({ view }: { view: GameView }) {
  const [copied, setCopied] = useState(false);
  const me = view.players.find((p) => p.id === view.you);
  const isHost = me?.isHost ?? false;
  const canStart = view.players.length >= MIN_PLAYERS;

  async function copy() {
    const link = `${window.location.origin}/room/${view.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the code is visible either way, so this is a
      // convenience failure, not an error worth interrupting the player over.
      setCopied(false);
    }
  }

  return (
    <Shell>
      <Wordmark subtitle="The parlour, before the reading" />

      <Panel className="text-center">
        <Label>Room code</Label>
        <p className="mt-1 font-display text-5xl tracking-[0.3em] text-brass-300 sm:text-6xl">
          {view.code}
        </p>
        <Button variant="quiet" onClick={() => void copy()} className="mt-3 w-full sm:w-auto">
          {copied ? 'Link copied' : 'Copy invite link'}
        </Button>
      </Panel>

      <Panel className="mt-4">
        <div className="flex items-baseline justify-between">
          <Label>
            Heirs · {view.players.length}/{MAX_PLAYERS}
          </Label>
          {view.players.length < MIN_PLAYERS ? (
            <span className="text-[11px] text-parchment-600">Need at least {MIN_PLAYERS}</span>
          ) : null}
        </div>

        <ul className="mt-2 space-y-1.5">
          {view.players.map((player) => (
            <PlayerRow
              key={player.id}
              name={player.name}
              coins={player.coins}
              score={player.score}
              items={player.items.length}
              isYou={player.id === view.you}
              isHost={player.isHost}
              isBot={player.isBot}
              hasBid={false}
              connected={player.connected}
              collection={player.collection}
              revealCollection={false}
            />
          ))}
        </ul>

        {isHost ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button onClick={() => send({ t: 'addBot' })} variant="quiet">
              Seat a bot
            </Button>
            <Button onClick={() => send({ t: 'start' })} disabled={!canStart}>
              Begin the reading
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-center text-sm text-parchment-600">
            Waiting for the host to begin…
          </p>
        )}

        {isHost && view.players.some((p) => p.isBot) ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {view.players
              .filter((p) => p.isBot)
              .map((bot) => (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => send({ t: 'removeBot', id: bot.id })}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full border border-ink-700 px-2.5 text-[11px] text-parchment-600 hover:border-burnt-600 hover:text-burnt-400"
                >
                  Remove {bot.name}
                </button>
              ))}
          </div>
        ) : null}
      </Panel>

      <p className="mt-4 pb-8 text-center text-[11px] leading-relaxed text-parchment-800">
        Your collection is dealt when the reading begins. Keep it to yourself — what other heirs
        overpay for is the only clue you get.
      </p>
    </Shell>
  );
}
