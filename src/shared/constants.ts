/**
 * Tunable economy constants. Every number here was chosen so that the
 * simulation in `docs/ECONOMY.md` produces a non-degenerate win distribution.
 * Changing one of these invalidates that document — re-run `pnpm sim`.
 */

/** Coins each heir starts with. */
export const STARTING_COINS = 100;

/** Number of heirlooms auctioned per game. Kept at 6 so a session fits in 3-5 minutes. */
export const ROUNDS = 6;

/**
 * A player's own collection multiplies the value of its items to them.
 *
 * Chosen by `scripts/sweep.ts` (see docs/ECONOMY.md). At 2x the simulated winner
 * took ~94% of their score from items, which made coins almost free and turned
 * bidding into a formality. At 3x with COIN_CONVERSION = 1 the winner's score
 * splits roughly 70/30 items-to-coins, so every bid has a real opportunity cost.
 */
export const COLLECTION_MULTIPLIER = 3;

/**
 * Leftover coins convert to points at this rate, rounded down.
 * Swept alongside COLLECTION_MULTIPLIER — see docs/ECONOMY.md.
 */
export const COIN_CONVERSION = 1;

/** Hard ceilings. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_BOTS = 7;

/** How long a bidding window lasts before non-bidders are auto-passed. */
export const BID_SECONDS = 30;

/** How long the reveal stays up before the next lot is called. */
export const REVEAL_SECONDS = 7;

/** How long a final scoreboard stays before the room may be reclaimed. */
export const RECAP_SECONDS = 300;

/** Room code alphabet — no I/O/0/1 so codes survive being read aloud. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

export const MAX_NAME_LENGTH = 16;
export const MAX_BID = STARTING_COINS;
