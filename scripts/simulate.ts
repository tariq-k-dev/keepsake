/**
 * Balance simulation for the KEEPSAKE economy.
 *
 *   pnpm sim            # 10,000 games
 *   pnpm sim -- 50000   # more games
 *
 * Why this exists: the 6-round / 100-coin / 2x-collection numbers in
 * `src/shared/constants.ts` are a design guess until they are measured. This
 * harness plays many complete games with mixed bot strategies and reports
 * whether the economy is degenerate — e.g. whether one strategy always wins,
 * whether lots burn too often, or whether coins become worthless.
 *
 * Output is also committed to docs/ECONOMY.md so the claim is auditable.
 */

import { mulberry32 } from '../src/shared/engine';
import {
  addPlayer,
  advance,
  createRoom,
  deal,
  placeBid,
  resolveRound,
  scorePlayer,
} from '../src/shared/engine';
import { botStyleFor, decideBid, type BotStyle } from '../src/shared/bots';
import { MAX_PLAYERS, ROUNDS, STARTING_COINS } from '../src/shared/constants';
import type { RoomState } from '../src/shared/types';

const GAMES = Number(process.argv[2] ?? 10_000);

interface GameResult {
  winnerSeat: number;
  winnerScore: number;
  scores: number[];
  burned: number;
  unsold: number;
  sold: number;
  coinsLeft: number;
  winnerStyle: BotStyle;
  /** Points won from items valued at the winner's own collection rate. */
  winnerItemPoints: number;
  winnerCoinPoints: number;
}

function playOne(seed: number, playerCount: number): GameResult {
  const rng = mulberry32(seed);
  let state: RoomState = createRoom('SIM', 'b0', 0);
  for (let i = 0; i < playerCount; i += 1) {
    state = addPlayer(state, `b${i}`, `Bot ${i}`, true);
  }
  state = deal(state, rng);

  for (let round = 0; round < ROUNDS; round += 1) {
    for (const id of state.order) {
      const amount = decideBid(botStyleFor(id), { state, playerId: id, rng });
      state = placeBid(state, id, Math.max(0, Math.min(amount, state.players[id]?.coins ?? 0)));
    }
    state = resolveRound(state);
    if (round < ROUNDS - 1) state = advance(state);
    else state = { ...state, phase: 'recap' };
  }

  const scores = state.order.map((id) => scorePlayer(state.players[id]!).total);
  const best = scores.reduce((a, b, i) => (b > (scores[a] ?? -1) ? i : a), 0);

  const outcomeCount = (kind: string) => state.history.filter((r) => r.outcome === kind).length;
  const winnerId = state.order[best];
  const winner = winnerId ? state.players[winnerId] : undefined;

  return {
    winnerSeat: best,
    winnerScore: scores[best] ?? 0,
    scores,
    burned: outcomeCount('burned'),
    unsold: outcomeCount('unsold'),
    sold: outcomeCount('sold'),
    coinsLeft: state.order.reduce((s, id) => s + (state.players[id]?.coins ?? 0), 0),
    winnerStyle: winnerId ? botStyleFor(winnerId) : 'greedy',
    winnerItemPoints: winner ? scorePlayer(winner).itemPoints : 0,
    winnerCoinPoints: winner ? scorePlayer(winner).coinPoints : 0,
  };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / (values.length || 1);
}

function stdev(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function run(playerCount: number): void {
  const results: GameResult[] = [];
  for (let seed = 0; seed < GAMES; seed += 1) {
    results.push(playOne(seed * 7919 + playerCount, playerCount));
  }

  const winners = results.map((r) => r.winnerScore);
  const margins = results.map((r) => {
    const sorted = [...r.scores].sort((a, b) => b - a);
    return (sorted[0] ?? 0) - (sorted[1] ?? 0);
  });
  // How often each seat position wins (seats map to fixed bot styles).
  const seatWins = new Array(playerCount).fill(0);
  for (const r of results) seatWins[r.winnerSeat] += 1;
  const stateStyles = results.map((r) => r.winnerStyle);

  // How often a player is dead last holding only coins (never won a lot).
  const lotsPerGame = mean(results.map((r) => r.sold));
  const burnedRate = results.reduce((s, r) => s + r.burned, 0) / (GAMES * ROUNDS);

  console.log(`\n=== ${playerCount} players · ${GAMES.toLocaleString()} games ===`);
  console.log(`lots sold              ${lotsPerGame.toFixed(2)} / ${ROUNDS}`);
  console.log(`burned (tied)          ${(burnedRate * 100).toFixed(1)}% of lots`);
  console.log(
    `winning score          mean ${mean(winners).toFixed(1)}  sd ${stdev(winners).toFixed(1)}  p10 ${percentile(winners, 0.1)}  p90 ${percentile(winners, 0.9)}`,
  );
  console.log(
    `margin of victory      mean ${mean(margins).toFixed(1)}  median ${percentile(margins, 0.5)}`,
  );
  console.log(
    `winner item / coins    ${mean(results.map((r) => r.winnerItemPoints)).toFixed(1)} / ${mean(results.map((r) => r.winnerCoinPoints)).toFixed(1)}`,
  );
  console.log(
    `coins left on table    ${mean(results.map((r) => r.coinsLeft)).toFixed(1)} of ${playerCount * STARTING_COINS}`,
  );
  console.log(
    `seat win rate          ${seatWins.map((w) => ((w / GAMES) * 100).toFixed(1) + '%').join('  ')}`,
  );

  // Fair share is 1 / (styles actually seated). A 2-player table seats two
  // styles, so 50% is parity there — not 33%. Treating 33% as the baseline made
  // an earlier run report "healthy" for a strategy that won 55% of 2p games.
  const seatedStyles = new Set(stateStyles).size || 1;
  const parity = 1 / Math.max(2, seatedStyles);
  const degeneracy = seatWins.some((w) => w / GAMES > parity * 1.5);
  console.log(
    degeneracy
      ? 'VERDICT: DEGENERATE — one strategy dominates; retune constants.'
      : 'VERDICT: HEALTHY — no strategy dominates.',
  );
}

for (const count of [2, 3, 4, 6, MAX_PLAYERS]) run(count);
