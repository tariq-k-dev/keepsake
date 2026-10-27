import { useMemo, useState } from 'react';
import { Shell, Panel, Button, Label, LotCard, Timer, PlayerRow } from '../components/ui';
import { send, useCountdown, useSession } from '../lib/session';
import { getCollection, ITEMS } from '../../shared/catalog';
import type { GameView } from '../../shared/types';
import { STARTING_COINS } from '../../shared/constants';

const ITEM_CACHE = Object.fromEntries(ITEMS.map((item) => [item.id, item]));

/**
 * The bid screen — the only screen where the player acts, so it gets the whole
 * thumb zone. The dial is deliberately coarse (steps of 5): precise bids are
 * impossible to make quickly on a phone, and a coarse dial keeps every player's
 * decision time within the 30-second window.
 */
export function Bidding({ view }: { view: GameView }) {
  const { skew } = useSession();
  const me = view.players.find((p) => p.id === view.you);
  const msLeft = useCountdown(view.deadline, skew);
  const maxBid = me?.coins ?? 0;

  /**
   * The dial's value is DERIVED, not synced through an effect.
   *
   * `amount` is the player's explicit choice for the current lot; when they have
   * not touched it, the bid is the suggestion for that lot. Storing the choice
   * against a `key` (round + lot) means a new lot automatically falls back to the
   * suggestion, with no effect, no cascading render, and no window where the
   * slider briefly shows the previous lot's number.
   */
  const lotKey = `${view.round}:${view.itemId}`;
  const [choice, setChoice] = useState<{ key: string; value: number } | null>(null);
  const explicit = choice?.key === lotKey ? choice.value : null;

  const suggested = useMemo(
    () => suggestBid(maxBid, view.itemId, me?.collection ?? null),
    [maxBid, view.itemId, me?.collection],
  );

  const amount = explicit ?? suggested;
  const touched = explicit !== null;

  function choose(value: number) {
    setChoice({ key: lotKey, value });
  }

  const waiting = useMemo(
    () => view.players.filter((p) => !p.hasBid && p.id !== view.you),
    [view.players, view.you],
  );

  if (!me || !view.itemId) return null;

  const bid = Math.max(0, Math.min(amount, maxBid));
  const submitted = me.hasBid;
  const collection = me.collection ? getCollection(me.collection) : null;

  return (
    <Shell>
      <div className="flex items-center justify-between pt-4 pb-3">
        <div>
          <Label>
            Round {view.round} of {view.rounds}
          </Label>
          <p className="font-display text-sm text-parchment-400">Room {view.code}</p>
        </div>
        <div className="text-right">
          <Label>Time</Label>
          <Timer ms={msLeft} />
        </div>
      </div>

      <LotCard
        itemId={view.itemId}
        round={view.round}
        rounds={view.rounds}
        yourCollection={me.collection}
      />

      {collection ? (
        <p className="mt-2 px-1 text-[11px] text-parchment-600">
          You hold <span className="text-brass-400">{collection.name}</span> — {collection.blurb}
        </p>
      ) : null}

      <Panel className="mt-4">
        {submitted ? (
          <div className="py-4 text-center">
            <p className="font-display text-lg text-parchment-200">Bid sealed.</p>
            <p className="mt-1 text-sm text-parchment-600">
              {waiting.length === 0
                ? 'All bids in. Opening the envelopes…'
                : `Waiting on ${waiting.length} ${waiting.length === 1 ? 'heir' : 'heirs'}…`}
            </p>
            <p className="mt-3 font-display text-4xl tabular-nums text-brass-300">{bid} coins</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-parchment-800">
              Your bid is hidden until everyone has committed
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <Label>Your bid</Label>
              <span className="text-[11px] text-parchment-600">
                {me.coins} of {STARTING_COINS} coins left
              </span>
            </div>

            <p className="mt-1 text-center font-display text-5xl tabular-nums text-brass-300">
              {bid}
            </p>

            {maxBid > 0 ? (
              <input
                type="range"
                min={0}
                max={maxBid}
                step={5}
                value={bid}
                onChange={(event) => choose(Number(event.target.value))}
                aria-label="Bid amount"
                className="mt-2 h-11 w-full cursor-pointer accent-brass-500"
              />
            ) : null}

            <div className={`mt-1 grid grid-cols-4 gap-1.5 ${maxBid === 0 ? 'opacity-40' : ''}`}>
              {/*
                Labelled as fractions OF YOUR COINS, and the resulting amount is
                printed under each button. A bare "½" is ambiguous — half the lot
                value? half your stack? — and players should never have to guess
                what a button will do to their money.
              */}
              {(
                [
                  { label: 'Zero', share: 0 },
                  { label: 'Quarter', share: 0.25 },
                  { label: 'Half', share: 0.5 },
                  { label: 'All in', share: 1 },
                ] as const
              ).map(({ label, share }) => {
                // Quantise to the slider's step so the thumb lands exactly where
                // the button says it will. Labels are fractions, not amounts:
                // "100" on a player holding 20 coins is a lie.
                const value = Math.round((maxBid * share) / 5) * 5;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => choose(value)}
                    aria-label={
                      share === 0 ? 'Set your bid to zero' : `${label} of your coins — ${value}`
                    }
                    className="flex min-h-11 flex-col items-center justify-center rounded-lg border border-ink-700 bg-ink-850 px-1 text-[11px] font-medium leading-tight text-parchment-400 hover:border-brass-600 hover:text-brass-300"
                  >
                    <span>{label}</span>
                    <span className="text-[10px] tabular-nums text-parchment-800">{value}</span>
                  </button>
                );
              })}
            </div>

            {/*
              Never disable this. A player with no coins left can still only
              pass, but passing IS a bid — and the server resolves the round as
              soon as everyone has committed. Disabling the button for a broke
              player left them unable to act at all, so the table sat on the
              30-second timer waiting on someone who could not click.
            */}
            <Button onClick={() => send({ t: 'bid', amount: bid })} className="mt-3 w-full">
              {bid === 0 ? 'Pass on this lot' : `Bid ${bid} coins`}
            </Button>
            {maxBid === 0 ? (
              <p className="mt-2 text-center text-[11px] text-parchment-600">
                You are out of coins. You can still pass.
              </p>
            ) : null}

            {!touched && bid > 0 ? (
              <p className="mt-2 text-center text-[11px] text-parchment-800">
                Suggested from the lot&apos;s value to your collection. Adjust freely.
              </p>
            ) : null}
          </>
        )}
      </Panel>

      <Panel className="mt-4">
        <Label>Table</Label>
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
              hasBid={player.hasBid}
              connected={player.connected}
              collection={player.collection}
              revealCollection={false}
            />
          ))}
        </ul>
      </Panel>

      <div className="h-6" />
      <p className="pb-6 text-center text-[11px] leading-relaxed text-parchment-800">
        Everyone bids at once. Highest wins and pays. A tie destroys the lot.
      </p>
    </Shell>
  );
}

/**
 * A first bid the player can accept without thinking. Anchoring near the lot's
 * value to *their* collection teaches the mechanic (mine is worth more) while
 * still leaving the decision theirs. Clamped to what they hold.
 */
function suggestBid(coins: number, itemId: string | null, collection: string | null): number {
  if (!itemId || coins <= 0) return 0;
  const item = ITEM_CACHE[itemId];
  if (!item) return 0;
  const worth = item.collection === collection ? item.base * 3 : item.base;
  const target = Math.min(coins, Math.round(worth * 0.6));
  return Math.max(0, Math.round(target / 5) * 5);
}
