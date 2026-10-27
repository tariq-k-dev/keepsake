import { Shell, Panel, Label, Timer, PlayerRow } from '../components/ui';
import { useCountdown, useSession } from '../lib/session';
import { getItem, getCollection } from '../../shared/catalog';
import type { GameView } from '../../shared/types';

/**
 * The reveal. This is the emotional centre of the game and the only place the
 * design has to do real work: three outcomes must read instantly, without a
 * paragraph, on a phone held at arm's length.
 *
 *   sold   → brass, the winner's name, what they paid
 *   burned → burnt red, "destroyed", the tie is the punchline
 *   unsold → quiet, "no bids"
 */
export function Reveal({ view }: { view: GameView }) {
  const { skew } = useSession();
  const msLeft = useCountdown(view.deadline, skew);
  const result = view.history.at(-1);
  const me = view.players.find((p) => p.id === view.you);
  if (!result || !view.itemId) return null;

  const item = getItem(result.itemId);
  const collection = getCollection(item.collection);
  const winner = view.players.find((p) => p.id === result.winner);
  const iWon = result.winner === view.you;

  // Rival bids, sorted high to low — the information that makes the next round a
  // decision rather than a guess.
  const ranked = Object.entries(result.bids)
    .map(([id, amount]) => ({ player: view.players.find((p) => p.id === id), amount }))
    .filter((entry): entry is { player: NonNullable<typeof entry.player>; amount: number } =>
      Boolean(entry.player),
    )
    .sort((a, b) => b.amount - a.amount);

  const outcome = result.outcome;
  const tone =
    outcome === 'sold'
      ? { border: 'border-brass-500/60', bg: 'bg-brass-600/10', text: 'text-brass-300' }
      : outcome === 'burned'
        ? { border: 'border-burnt-500/60', bg: 'bg-burnt-600/10', text: 'text-burnt-400' }
        : { border: 'border-ink-700', bg: 'bg-ink-900', text: 'text-parchment-400' };

  return (
    <Shell>
      <div className="flex items-center justify-between pt-4 pb-3">
        <Label>
          Round {view.round} of {view.rounds}
        </Label>
        <div className="text-right">
          <Label>Next lot in</Label>
          <Timer ms={msLeft} />
        </div>
      </div>

      <section
        className={`animate-rise rounded-xl border p-4 text-center sm:p-6 ${tone.border} ${tone.bg}`}
      >
        {outcome === 'sold' ? (
          <>
            <p className="text-[11px] uppercase tracking-[0.22em] text-parchment-600">Sold</p>
            <h2 className="mt-2 font-display text-2xl leading-tight text-parchment-50 sm:text-3xl">
              {winner?.name ?? 'Someone'} takes the {item.name.toLowerCase()}
            </h2>
            <p className={`mt-1 font-display text-4xl tabular-nums ${tone.text}`}>
              {result.price}
              <span className="ml-1 text-base text-parchment-600">coins</span>
            </p>
            {iWon ? (
              <p className="mt-2 inline-block rounded-full bg-brass-500/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brass-300">
                Yours now
              </p>
            ) : null}
          </>
        ) : outcome === 'burned' ? (
          <>
            <p className="text-[11px] uppercase tracking-[0.22em] text-burnt-500">Destroyed</p>
            <h2 className="mt-2 font-display text-2xl leading-tight text-parchment-50 sm:text-3xl">
              A tie — the {item.name.toLowerCase()} is broken
            </h2>
            <p className="mt-2 text-sm text-parchment-400">
              Nobody pays. Nobody scores.{' '}
              {result.bids && topTiers(result.bids).length > 1
                ? `${topTiers(result.bids)
                    .map((id) => view.players.find((p) => p.id === id)?.name)
                    .filter(Boolean)
                    .join(' and ')} both bid ${result.price || topAmount(result.bids)}.`
                : ''}
            </p>
          </>
        ) : (
          <>
            <p className="text-[11px] uppercase tracking-[0.22em] text-parchment-600">Passed in</p>
            <h2 className="mt-2 font-display text-2xl leading-tight text-parchment-50 sm:text-3xl">
              Nobody bid on the {item.name.toLowerCase()}
            </h2>
            <p className="mt-2 text-sm text-parchment-400">It stays in the attic.</p>
          </>
        )}
      </section>

      <Panel className="mt-4">
        <div className="flex items-baseline justify-between">
          <Label>The bids</Label>
          <span className="text-[11px] text-parchment-600">
            Base value {item.base} · {collection.name}
          </span>
        </div>
        <ul className="mt-2 space-y-1">
          {ranked.map(({ player, amount }) => {
            const isWinner = player.id === result.winner;
            const isTied = outcome === 'burned' && amount === topAmount(result.bids);
            return (
              <li
                key={player.id}
                className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
                  isWinner
                    ? 'bg-brass-600/15 text-brass-300'
                    : isTied
                      ? 'bg-burnt-600/10 text-burnt-400'
                      : 'text-parchment-400'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate text-sm">
                  <span className="truncate">{player.name}</span>
                  {player.id === view.you ? (
                    <span className="text-[10px] uppercase tracking-wider text-parchment-600">
                      you
                    </span>
                  ) : null}
                  {player.isBot ? (
                    <span className="text-[10px] uppercase tracking-wider text-parchment-800">
                      bot
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-display text-lg tabular-nums">
                  {amount}
                  {isWinner ? <span className="ml-1 text-[10px] uppercase">paid</span> : null}
                  {isTied && !isWinner ? (
                    <span className="ml-1 text-[10px] uppercase">tie</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel className="mt-4">
        <Label>Standings</Label>
        <ul className="mt-2 space-y-1.5">
          {[...view.players]
            .sort((a, b) => b.score - a.score)
            .map((player) => (
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
        {me?.collection ? (
          <p className="mt-3 text-[11px] text-parchment-600">
            You hold {getCollection(me.collection).name}. You have {me.coins} coins left.
          </p>
        ) : null}
      </Panel>

      <p className="mt-4 pb-8 text-center text-[11px] text-parchment-800">
        Bid histories are public. What a rival overpays for tells you their collection.
      </p>
    </Shell>
  );
}

function topAmount(bids: Record<string, number>): number {
  return Math.max(0, ...Object.values(bids));
}

function topTiers(bids: Record<string, number>): string[] {
  const highest = topAmount(bids);
  return Object.entries(bids)
    .filter(([, amount]) => amount === highest && amount > 0)
    .map(([id]) => id);
}
