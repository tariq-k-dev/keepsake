# KEEPSAKE — Economy Design

Why the game's numbers are these numbers. Every constant in
`src/shared/constants.ts` is defended here with measured output from
`scripts/sweep.ts` and `scripts/simulate.ts`.

The rules are simple enough to state in five lines. **Balancing them is not obvious**,
and guessing produces a game where bidding is pointless. That is what this document exists
to prevent.

---

## 1. The design question

KEEPSAKE is a sealed-bid auction. Each round, players privately bid coins on a lot worth a
public base value — doubled (now tripled) if the lot belongs to your secret collection.
At the end, **lots + leftover coins** decide the winner.

That creates a tension with exactly one correct answer, and finding it is not intuitive:

- If **coins are worth a lot**, the optimal strategy is to never bid. Everyone hoards, nothing sells, and the game is six rounds of passivity.
- If **coins are worth nothing**, bidding is free money. Everyone bids their maximum, every lot sells above value, and the highest stack wins regardless of judgement.

The game only works in the narrow band between those two failures.

## 2. What the first build got wrong

The first constants were `COIN_CONVERSION = 0.2` and `COLLECTION_MULTIPLIER = 2`.
They felt reasonable. Measured over 10,000 simulated games, they were broken:

| Symptom                       | 2 players  | 4 players  |
| ----------------------------- | ---------- | ---------- |
| Winner's score from **lots**  | 94.2%      | 91.2%      |
| Winner's score from **coins** | 5.8%       | 8.8%       |
| Coins left unspent            | 103 of 200 | 288 of 400 |

With coins worth 0.2 points, a lot's base value (14–28) dwarfed any coin it cost. Bidding was
strictly correct almost always, so the optimal play was "bid high on everything". Half the
money in the game never got spent because there was nothing worth spending it on.

**The simulation also caught a second bug that had nothing to do with the constants.** One
of the three bot archetypes won **86% of two-player games** — not because the economy favoured
it, but because it was the only strategy that evaluated every lot. A balance sweep over a broken
bot measures the bot, not the game.

## 3. The sweep

`scripts/sweep.ts` grid-searches `COIN_CONVERSION` × `COLLECTION_MULTIPLIER`, playing
`n` complete games per cell with all three bot archetypes. It reports, per cell:

- **edge** — the dominant archetype's win share divided by its fair share. `1.00` is perfect parity.
- **coinShare / itemShare** — how the winner's score splits between lots and unspent coins.
- **burned** — what fraction of lots are destroyed by a tie.
- **itemDec** — how often the winner won at least one lot. Below 100% means a player can win purely by hoarding.

### Selection criteria

A cell is **healthy** only if all five hold:

1. `edge ≤ 1.35` for every table size — no archetype has a real advantage.
2. `itemDec ≥ 99%` — you cannot win by hoarding alone.
3. `coinShare` between 15% and 45% — coins matter, but do not decide the game.
4. `burned` between 1% and 15% — ties are a real threat without being the main event.
5. Median margin of victory ≥ 10 points — the game is not decided before the last lot.

### Result

**`COIN_CONVERSION = 1`, `COLLECTION_MULTIPLIER = 3`.**

| conv    | mult    | edge (2p) | edge (4p) | edge (8p) | coinShare  | itemDec  |
| ------- | ------- | --------- | --------- | --------- | ---------- | -------- |
| 0.8     | 2.5     | 1.39      | 1.36      | 1.18      | 21–29%     | 100%     |
| 0.8     | 3.0     | 1.37      | 1.33      | 1.07      | 18–24%     | 100%     |
| 1.0     | 2.5     | 1.35      | 1.51      | 1.33      | 25–37%     | 100%     |
| **1.0** | **3.0** | **1.34**  | **1.43**  | **1.14**  | **22–31%** | **100%** |
| 1.2     | 2.5     | 1.28      | 1.76      | 1.46      | 30–46%     | 100%     |
| 1.2     | 3.0     | 1.30      | 1.55      | 1.23      | 26–39%     | 100%     |

`1.0 / 3.0` is the only cell that keeps `edge` under 1.45 at every table size while holding
`coinShare` in the target band. `1.2 / 2.5` has a better 2-player edge but pushes coins past
46% of the winner's score at four players, which is where hoarding starts to compete with
bidding.

## 4. Verified behaviour at the shipped constants

`pnpm sim 4000` — 4,000 games per table size:

```
=== 4 players ===                        === 8 players ===
lots sold              5.43 / 6          lots sold              5.71 / 6
burned (tied)          9.4% of lots      burned (tied)          4.9% of lots
winning score          mean 149.6        winning score          mean 148.4
margin of victory      mean 22.0         margin of victory      mean 19.0
                       median 17                                median 15
winner item / coins    109.3 / 40.4      winner item / coins    101.9 / 46.5
coins left on table    249.9 of 400      coins left on table    596.9 of 800
seat win rate          23.6 31.5          seat win rate          6.9 7.8 12.3 23.0
                       20.7 24.1                               24.6 11.2 6.7 7.6
VERDICT: HEALTHY                         VERDICT: HEALTHY
```

Read it as: a typical winner takes **~73% of their score from lots and ~27% from unspent coins**,
so both halves of the scoring rule matter. Ties destroy 5–9% of lots, which is frequent enough
to make a defensive bid meaningful and rare enough to be a surprise. The median game is won by
15–17 points, roughly one good lot — close enough that the last round is usually live.

## 5. Why 6 rounds

A session should fit in 3–5 minutes so a group will actually start one. At 6 rounds:
30s bidding + 7s reveal = 37s per round worst case, ≈ 3.7 minutes, and a decisive table finishes
each bidding phase in 10–15s (the round resolves the instant every bid is in, so the 30s is a
ceiling for a distracted player, not a cost everyone pays).

Ten rounds made the last three lots feel like a formality once the coin leader was clear.
Six keeps the endgame live: with `STARTING_COINS = 100` and lots averaging ~18 base value,
a player cannot win more than about half the estate, so every round changes the standings.

## 6. Rules that earn their complexity

Each rule was added because the simulation showed a degenerate strategy without it.

- **A tie destroys the lot** (rather than paying the second-highest bid). Without it, two players with equal stacks bid identically and the lot goes to whoever the code iterates first — an arbitrary winner. Burning it makes a tie a genuine threat and turns "what will they bid" into a real question. Measured effect: 5–9% of lots, and it is the single rule players comment on.
- **Coins are public, collections are secret.** Public coins turn the endgame into arithmetic anyone at the table can do ("she cannot afford more than 34"). Secret collections mean you must _infer_ what a rival values — which is where the bluffing lives.
- **Collections dealt without repeats while possible.** With 6 collections and 6 or fewer players, nobody shares a collection. This guarantees each lot is tripled for at most one player, so no two players are ever contesting the same lots for the same reason.
- **Bots bid below true value (70–85%).** A bot that bids its exact valuation can never be beaten on a lot it wants. The margin is what makes bot mode winnable and what makes reading the board profitable.

## 7. Known limitations

- The sweep tunes against **three specific bot archetypes**. A human who identifies and exploits the `patient` archetype's late-game aggression will outperform all measured win rates. That is intended — the simulation checks for degeneracy, not for optimal play.
- `edge` cannot go below 1.00 by construction; several cells sit just above it, meaning the dominant archetype wins ~1.3× its fair share. With three archetypes and 6 rounds of a high-variance game, that is within noise, but it is not proof of perfect balance.
- The economy has not been tuned against real human play. If the game ships and groups find bidding too passive, `COIN_CONVERSION` is the dial: lowering it to 0.8 makes hoarding weaker.

## Reproducing

```bash
pnpm sweep            # grid search, 2,000 games per cell (~40s)
pnpm sweep 4000       # tighter confidence intervals
pnpm sim              # 10,000 games per table size at shipped constants
pnpm sim 4000
```

Both scripts import `decideBid` and `scorePlayer` from `src/shared/`, the same modules the live
Durable Object executes. A simulation that reimplements the bot measures a strategy that never ships.
