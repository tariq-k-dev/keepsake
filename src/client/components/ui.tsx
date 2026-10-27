/**
 * Shared presentation primitives.
 *
 * Rendered as an auction catalogue: hairline rules, small caps, and a lot number
 * in the corner of every card. The constraint that shaped this file is
 * legibility at 320px in one hand — every tap target is at least 44px and the
 * primary action sits in the lower third where a thumb reaches.
 */

import type { ReactNode } from 'react';
import { COLLECTION_MULTIPLIER } from '../../shared/constants';
import { getCollection, getItem } from '../../shared/catalog';
import type { CollectionId } from '../../shared/catalog';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-[env(safe-area-inset-bottom)] sm:px-6">
      {children}
    </main>
  );
}

export function Wordmark({ subtitle }: { subtitle?: string }) {
  return (
    <header className="pt-6 pb-4 text-center sm:pt-10">
      <h1 className="font-display text-3xl tracking-[0.28em] text-brass-300 sm:text-4xl">
        KEEPSAKE
      </h1>
      <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-parchment-600">
        {subtitle ?? 'The Reading of the Will'}
      </p>
    </header>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-ink-700 bg-ink-900/80 p-4 shadow-[0_1px_0_rgba(246,241,228,0.04)_inset] backdrop-blur-sm sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-parchment-600">
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const base =
    'inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-400 disabled:cursor-not-allowed disabled:opacity-40';
  const styles = {
    primary: 'bg-brass-500 text-ink-950 hover:bg-brass-400 active:bg-brass-600',
    quiet: 'border border-ink-700 bg-ink-850 text-parchment-200 hover:border-parchment-600',
    danger: 'border border-burnt-600/60 bg-ink-850 text-burnt-400 hover:border-burnt-500',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/** The heirloom on the block. The lot number is pure catalogue theatre. */
export function LotCard({
  itemId,
  round,
  rounds,
  yourCollection,
  compact = false,
}: {
  itemId: string;
  round: number;
  rounds: number;
  yourCollection: CollectionId | null;
  compact?: boolean;
}) {
  const item = getItem(itemId);
  const collection = getCollection(item.collection);
  const yours = yourCollection === item.collection;
  const worthToYou = yours ? item.base * COLLECTION_MULTIPLIER : item.base;

  return (
    <article
      className={`relative overflow-hidden rounded-xl border ${
        yours ? 'border-brass-500/70 bg-brass-600/10' : 'border-ink-700 bg-ink-900'
      } ${compact ? 'p-3' : 'p-4 sm:p-5'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label>
            Lot {round} of {rounds}
          </Label>
          <h2 className="mt-1 font-display text-xl leading-tight text-parchment-50 sm:text-2xl">
            {item.name}
          </h2>
          <p className="mt-1 text-xs text-parchment-600">{collection.name}</p>
        </div>
        <div className="shrink-0 text-right">
          <Label>Base</Label>
          <p className="font-display text-2xl text-parchment-200">{item.base}</p>
        </div>
      </div>

      {yours ? (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brass-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-brass-300">
          In your collection · worth {worthToYou} to you
        </p>
      ) : (
        <p className="mt-3 text-[11px] uppercase tracking-wider text-parchment-800">
          Not your collection · worth {worthToYou} to you
        </p>
      )}
    </article>
  );
}

/**
 * A player's public row. Coins are shown for everyone (they are public in this
 * game by design — you can count what a rival cannot afford), but the collection
 * only appears for yourself or at the recap.
 */
export function PlayerRow({
  name,
  coins,
  score,
  items,
  isYou,
  isHost,
  isBot,
  hasBid,
  connected,
  collection,
  revealCollection,
}: {
  name: string;
  coins: number;
  score: number;
  items: number;
  isYou: boolean;
  isHost: boolean;
  isBot: boolean;
  hasBid: boolean;
  connected: boolean;
  collection: CollectionId | null;
  revealCollection: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
        isYou ? 'border-brass-600/40 bg-brass-600/5' : 'border-ink-800 bg-ink-900/60'
      } ${connected ? '' : 'opacity-50'}`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-parchment-50">
          <span className="truncate">{name}</span>
          {isYou ? (
            <span className="text-[10px] uppercase tracking-wider text-brass-400">you</span>
          ) : null}
          {isHost ? (
            <span className="text-[10px] uppercase tracking-wider text-parchment-600">host</span>
          ) : null}
          {isBot ? (
            <span className="text-[10px] uppercase tracking-wider text-parchment-800">bot</span>
          ) : null}
        </p>
        {revealCollection && collection ? (
          <p className="truncate text-[11px] text-parchment-600">
            {getCollection(collection).name}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-3 text-right">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-parchment-800">coins</p>
          <p className="text-sm tabular-nums text-parchment-200">{coins}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-parchment-800">lots</p>
          <p className="text-sm tabular-nums text-parchment-200">{items}</p>
        </div>
        <div className="w-10">
          <p className="text-[10px] uppercase tracking-wider text-parchment-800">pts</p>
          <p className="text-sm font-semibold tabular-nums text-brass-300">{score}</p>
        </div>
        {/*
          Status is conveyed by BOTH fill and shape, not colour alone: a filled
          dot for "bid in", a hollow ring for "still deciding". The previous pair
          of dark greys was invisible at this size.
        */}
        <span
          title={hasBid ? 'Bid in' : 'Still deciding'}
          aria-label={hasBid ? 'bid submitted' : 'still deciding'}
          role="img"
          className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
            hasBid ? 'border-moss-400 bg-moss-400' : 'border-parchment-800 bg-transparent'
          }`}
        />
      </div>
    </li>
  );
}

/** A countdown that turns from brass to burnt in the last five seconds. */
export function Timer({ ms }: { ms: number | null }) {
  if (ms === null) return null;
  const seconds = Math.ceil(ms / 1000);
  const urgent = seconds <= 5;
  return (
    <p
      aria-live="off"
      className={`text-center font-display text-3xl tabular-nums ${
        urgent ? 'text-burnt-400' : 'text-parchment-200'
      }`}
    >
      {seconds}
    </p>
  );
}
