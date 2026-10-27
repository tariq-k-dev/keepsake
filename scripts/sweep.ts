/**
 * Parameter sweep for the KEEPSAKE economy.
 *
 *   pnpm sweep
 *
 * Grid-searches coin conversion rate x collection multiplier and reports which
 * combinations produce a game where (a) winning requires items, (b) no single
 * bot strategy dominates, and (c) the score margin is close enough to be tense.
 * The cell this sweep picked is what ships in `src/shared/constants.ts`.
 *
 * It imports the SAME `decideBid` the Durable Object calls. An earlier version
 * reimplemented the bot inline and measured a strategy that never shipped.
 */

import {
  addPlayer,
  advance,
  createRoom,
  deal,
  mulberry32,
  placeBid,
  resolveRound,
} from '../src/shared/engine';
import { botStyleFor, decideBid, type BotStyle } from '../src/shared/bots';
import { ROUNDS } from '../src/shared/constants';
import { getItem, valueTo } from '../src/shared/catalog';
import type { RoomState } from '../src/shared/types';

const GAMES = Number(process.argv[2] ?? 2_000);

const CONVERSIONS = [0.8, 1.0, 1.2];
const MULTIPLIERS = [2.5, 3];

interface Summary {
  conversion: number;
  multiplier: number;
  dominant: number;
  dominantStyle: BotStyle;
  edge: number;
  styles: string;
  margin: number;
  coinShare: number;
  itemShare: number;
  burned: number;
  itemDecides: number;
}

function playOne(seed: number, players: number, conversion: number, multiplier: number) {
  const rng = mulberry32(seed);
  let state: RoomState = createRoom('SIM', 'b0', 0);
  for (let i = 0; i < players; i += 1) state = addPlayer(state, `b${i}`, `Bot ${i}`, true);
  state = deal(state, rng);

  for (let round = 0; round < ROUNDS; round += 1) {
    for (const id of state.order) {
      const amount = decideBid(botStyleFor(id), { state, playerId: id, rng, multiplier });
      state = placeBid(state, id, Math.max(0, Math.min(amount, state.players[id]?.coins ?? 0)));
    }
    state = resolveRound(state);
    if (round < ROUNDS - 1) state = advance(state);
  }

  const scores = state.order.map((id) => {
    const p = state.players[id]!;
    const itemPoints = p.items.reduce(
      (sum, itemId) => sum + valueTo(getItem(itemId), p.collection!, multiplier),
      0,
    );
    const coinPoints = Math.floor(p.coins * conversion);
    return { id, total: itemPoints + coinPoints, itemPoints, coinPoints };
  });
  const sorted = [...scores].sort((a, b) => b.total - a.total);
  const top = sorted[0]!;
  const second = sorted[1]!;

  return {
    style: botStyleFor(top.id),
    margin: top.total - second.total,
    coinShare: top.total === 0 ? 0 : top.coinPoints / top.total,
    itemShare: top.total === 0 ? 0 : top.itemPoints / top.total,
    burned: state.history.filter((r) => r.outcome === 'burned').length,
    itemDecides: top.itemPoints > 0 ? 1 : 0,
  };
}

function sweep(players: number): Summary[] {
  const rows: Summary[] = [];
  for (const conversion of CONVERSIONS) {
    for (const multiplier of MULTIPLIERS) {
      const wins: Record<string, number> = {};
      let margin = 0;
      let coinShare = 0;
      let itemShare = 0;
      let burned = 0;
      let itemDecides = 0;
      for (let seed = 0; seed < GAMES; seed += 1) {
        const r = playOne(seed * 31 + players, players, conversion, multiplier);
        wins[r.style] = (wins[r.style] ?? 0) + 1;
        margin += r.margin;
        coinShare += r.coinShare;
        itemShare += r.itemShare;
        burned += r.burned;
        itemDecides += r.itemDecides;
      }
      const entries = Object.entries(wins) as Array<[BotStyle, number]>;
      const top = entries.reduce((a, b) => (b[1] > a[1] ? b : a), entries[0]!);
      // Fair share is 1/number-of-styles-actually-seated, NOT 1/3: with two
      // players only two styles are at the table, so 50% is a fair split.
      const seated = entries.length || 1;
      rows.push({
        conversion,
        multiplier,
        dominant: top[1] / GAMES,
        dominantStyle: top[0],
        edge: top[1] / GAMES / (1 / seated),
        styles: entries
          .map(([style, wins_]) => `${style[0]}:${((wins_ / GAMES) * 100).toFixed(1)}`)
          .join(' '),
        margin: margin / GAMES,
        coinShare: coinShare / GAMES,
        itemShare: itemShare / GAMES,
        burned: burned / (GAMES * ROUNDS),
        itemDecides: itemDecides / GAMES,
      });
    }
  }
  return rows;
}

for (const players of [2, 4, 8]) {
  const rows = sweep(players);
  console.log(`\n=== ${players} players · ${GAMES} games per cell ===`);
  console.log('conv  mult   edge  margin  coinShare  itemShare  burned  itemDec  per-style');
  for (const r of rows) {
    console.log(
      [
        r.conversion.toFixed(1).padEnd(5),
        r.multiplier.toFixed(1).padEnd(6),
        r.edge.toFixed(2).padStart(5),
        r.margin.toFixed(1).padStart(7),
        ((r.coinShare * 100).toFixed(1) + '%').padStart(9),
        ((r.itemShare * 100).toFixed(1) + '%').padStart(9),
        ((r.burned * 100).toFixed(1) + '%').padStart(6),
        ((r.itemDecides * 100).toFixed(0) + '%').padStart(6),
        r.styles,
      ].join('  '),
    );
  }
}
