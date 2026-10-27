import { useMemo, useState } from 'react';
import { Shell, Wordmark, Panel, Button, Label } from '../components/ui';
import { send } from '../lib/session';
import { COLLECTION_MULTIPLIER, COIN_CONVERSION } from '../../shared/constants';
import { COLLECTIONS, getCollection, getItem, ITEMS } from '../../shared/catalog';
import type { GameView, PublicPlayer } from '../../shared/types';

/**
 * The recap. Two jobs: crown a winner, and show every player what their own
 * bidding actually cost them.
 *
 * The chart is the portfolio piece. It plots, for one player, what each lot was
 * worth *to them* against what they paid — so a player sees the two mistakes that
 * decide this game: overpaying for a lot outside your collection, and being
 * outbid on a lot that was tripled for you. No charting library: a game this
 * small cannot justify 40KB of Plotly, and hand-drawn SVG keeps the bundle lean.
 */
export function Recap({ view }: { view: GameView }) {
  const ranked = useMemo(() => [...view.players].sort((a, b) => b.score - a.score), [view.players]);
  const areWinners = ranked.filter((p) => p.score === ranked[0]?.score);
  const me = view.players.find((p) => p.id === view.you);
  const isHost = me?.isHost ?? false;

  return (
    <Shell>
      <Wordmark subtitle="The estate, settled" />

      <Panel className="text-center">
        <Label>{areWinners.length > 1 ? 'Joint heirs' : 'The estate goes to'}</Label>
        <h2 className="mt-1 font-display text-3xl leading-tight text-brass-300 sm:text-4xl">
          {areWinners.map((p) => p.name).join(' & ')}
        </h2>
        <p className="mt-2 font-display text-2xl tabular-nums text-parchment-200">
          {ranked[0]?.score ?? 0} <span className="text-sm text-parchment-600">points</span>
        </p>
      </Panel>

      <Panel className="mt-4">
        <Label>Final standings</Label>
        <ol className="mt-2 space-y-1.5">
          {ranked.map((player, index) => (
            <li
              key={player.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                player.id === view.you
                  ? 'border-brass-600/40 bg-brass-600/5'
                  : 'border-ink-800 bg-ink-900/60'
              }`}
            >
              <span className="w-5 shrink-0 font-display text-lg text-parchment-600">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-parchment-50">
                  {player.name}
                  {player.id === view.you ? (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider text-brass-400">
                      you
                    </span>
                  ) : null}
                </p>
                {player.collection ? (
                  <p className="truncate text-[11px] text-parchment-600">
                    held {getCollection(player.collection).name}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-brass-300">{player.score}</p>
                <p className="text-[10px] tabular-nums text-parchment-800">
                  {player.items.length} lot{player.items.length === 1 ? '' : 's'} ·{' '}
                  {player.itemScore} + {Math.floor(player.coins * COIN_CONVERSION)} coins
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {me ? <BidAudit view={view} me={me} /> : null}

      <Panel className="mt-4">
        <Label>The lots</Label>
        <ul className="mt-2 divide-y divide-ink-800">
          {view.history.map((round) => {
            const item = getItem(round.itemId);
            const winner = view.players.find((p) => p.id === round.winner);
            return (
              <li key={`${round.round}-${round.itemId}`} className="flex items-baseline gap-3 py-2">
                <span className="w-4 shrink-0 text-[11px] tabular-nums text-parchment-800">
                  {round.round}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-parchment-200">
                  {item.name}
                </span>
                <span className="shrink-0 text-right text-xs">
                  {round.outcome === 'sold' ? (
                    <span className="text-brass-400">
                      {winner?.name} · {round.price}
                    </span>
                  ) : round.outcome === 'burned' ? (
                    <span className="text-burnt-500">destroyed on a tie</span>
                  ) : (
                    <span className="text-parchment-800">passed in</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="mt-4 grid gap-2 pb-8 sm:grid-cols-2">
        {isHost ? (
          <Button onClick={() => send({ t: 'rematch' })}>Deal again</Button>
        ) : (
          <p className="flex items-center justify-center text-sm text-parchment-600">
            Waiting for the host to deal again…
          </p>
        )}
        <Button
          variant="quiet"
          onClick={() => {
            window.history.pushState({}, '', '/');
            window.location.reload();
          }}
        >
          New room
        </Button>
      </div>
    </Shell>
  );
}

/**
 * Per-player bid economics. `worth` is what the lot was worth to that specific
 * player (their collection multiplier applied); `paid` is what they actually
 * spent. A bar to the right of the zero line is value won; left is value burned.
 */
function BidAudit({ view, me }: { view: GameView; me: PublicPlayer }) {
  const [who, setWho] = useState(me.id);
  const subject = view.players.find((p) => p.id === who) ?? me;

  const rows = view.history.map((round) => {
    const item = getItem(round.itemId);
    const mine = item.collection === subject.collection;
    const worth = mine ? item.base * COLLECTION_MULTIPLIER : item.base;
    const bid = round.bids[subject.id] ?? 0;
    const won = round.winner === subject.id;
    return {
      round: round.round,
      name: item.name,
      worth,
      bid,
      won,
      lostTo:
        round.winner && round.winner !== subject.id
          ? view.players.find((p) => p.id === round.winner)?.name
          : null,
      burned: round.outcome === 'burned',
    };
  });

  // Net position: value of lots won, minus what was paid, plus what was saved by
  // not winning. Deliberately simple arithmetic a player can check by hand —
  // an opaque "score" would undercut the point of showing this at all.
  const valueWon = rows.filter((r) => r.won).reduce((sum, r) => sum + r.worth, 0);
  const paid = rows.filter((r) => r.won).reduce((sum, r) => sum + r.bid, 0);
  const overpaid = rows
    .filter((r) => r.won && r.bid > r.worth)
    .reduce((sum, r) => sum + (r.bid - r.worth), 0);
  const misses = rows.filter((r) => !r.won && r.worth > r.bid && r.worth > 0);
  const bestMiss = misses.length
    ? misses.reduce((best, r) => (r.worth - r.bid > best.worth - best.bid ? r : best))
    : null;

  const maxBar = Math.max(...rows.map((r) => Math.max(r.worth, r.bid)), 1);

  return (
    <Panel className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>Bid economics</Label>
        {view.players.length > 20 ? null : (
          <select
            value={who}
            onChange={(event) => setWho(event.target.value)}
            aria-label="Whose bidding to review"
            className="min-h-9 rounded-lg border border-ink-700 bg-ink-850 px-2 text-xs text-parchment-300 focus:border-brass-500 focus:outline-none"
          >
            {view.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-parchment-600">
        Each row is a lot. The <span className="text-brass-400">gold track</span> is what it was
        worth to {subject.id === me.id ? 'you' : subject.name}; the{' '}
        <span className="text-moss-400">inner bar</span> is what was bid.
      </p>

      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.round} className="text-[11px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-parchment-400">
                {row.round}. {row.name}
              </span>
              <span className="shrink-0 tabular-nums text-parchment-600">
                <span className="text-brass-400">{row.worth}</span>
                {' / '}
                <span className="text-parchment-300">{row.bid}</span>
              </span>
            </div>
            {/*
              Both quantities share ONE axis so the bar lengths are directly
              comparable: the brass track is what the lot was worth to this
              player, the overlay is what they bid. Two separate half-width bars
              were unreadable — every pair looked identically sized because each
              was normalised into its own 50% container.
            */}
            <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-ink-850">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-brass-500/60"
                style={{ width: `${(row.worth / maxBar) * 100}%` }}
                aria-hidden="true"
              />
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${
                  row.won ? 'bg-moss-400' : row.burned ? 'bg-burnt-500' : 'bg-parchment-600'
                }`}
                style={{ width: `${(row.bid / maxBar) * 100}%`, opacity: 0.9 }}
                aria-hidden="true"
              />
            </div>
            {row.won && row.bid > row.worth ? (
              <p className="mt-0.5 text-burnt-400">overpaid by {row.bid - row.worth}</p>
            ) : row.won ? (
              <p className="mt-0.5 text-moss-400">won under value by {row.worth - row.bid}</p>
            ) : row.lostTo ? (
              <p className="mt-0.5 text-parchment-800">outbid by {row.lostTo}</p>
            ) : row.burned ? (
              <p className="mt-0.5 text-parchment-800">tie destroyed it</p>
            ) : null}
          </div>
        ))}
      </div>

      {/*
        Four numbers, because three were misleading. "Overpaid by 14" sat next to
        "value won 126 / paid 100" and read as a loss, when the player was 26 up:
        the overpay stat only sums lots bought above value and ignores the
        savings on lots bought below it. Net makes the true position explicit,
        and the overpay figure is labelled as what it is — a per-lot total.
      */}
      <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-ink-800 pt-3 text-xs sm:grid-cols-4">
        <Stat label="Value won" value={valueWon} tone="brass" />
        <Stat label="Paid" value={paid} tone="plain" />
        <Stat
          label="Net"
          value={valueWon - paid}
          tone={valueWon >= paid ? 'moss' : 'burnt'}
          signed
        />
        <Stat label="Overpaid on lots" value={overpaid} tone={overpaid > 0 ? 'burnt' : 'plain'} />
      </dl>

      {bestMiss ? (
        <p className="mt-3 rounded-lg border border-ink-800 bg-ink-850 px-3 py-2 text-[11px] leading-relaxed text-parchment-400">
          Biggest miss: the <strong className="text-parchment-200">{bestMiss.name}</strong> was
          worth {bestMiss.worth} to {subject.id === me.id ? 'you' : subject.name}, and{' '}
          {subject.id === me.id ? 'you bid' : `${subject.name} bid`} only {bestMiss.bid}.
        </p>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-parchment-800">
        {ITEMS.length} heirlooms across {COLLECTIONS.length} collections. Lot points plus{' '}
        {COIN_CONVERSION} per leftover coin. Your collection triples its own lots.
      </p>
    </Panel>
  );
}

function Stat({
  label,
  value,
  tone,
  signed = false,
}: {
  label: string;
  value: number;
  tone: 'brass' | 'burnt' | 'moss' | 'plain';
  signed?: boolean;
}) {
  const colour =
    tone === 'brass'
      ? 'text-brass-300'
      : tone === 'burnt'
        ? 'text-burnt-400'
        : tone === 'moss'
          ? 'text-moss-400'
          : 'text-parchment-200';
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-parchment-800">{label}</dt>
      <dd className={`font-display text-xl tabular-nums ${colour}`}>
        {signed && value > 0 ? `+${value}` : value}
      </dd>
    </div>
  );
}
