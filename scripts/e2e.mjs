/**
 * End-to-end smoke test against the real dev server.
 *
 *   pnpm dev                    # in one shell
 *   node scripts/e2e.mjs        # in another
 *
 * Why this exists on top of the workerd integration tests: those prove the
 * server is correct, not that the *UI* is. They never render React, never click
 * a range input, and never prove that two separate browser contexts converge on
 * the same screen. This plays a full two-player game in two real Chromium
 * contexts and screenshots each phase.
 *
 * It is deliberately not part of CI (it needs a browser binary and a live
 * server); `ci.yml` runs the fast, hermetic layers.
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:5173';
const SHOTS = 'artifacts/e2e';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

async function newPlayer(name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    console.log(`  PAGE ERROR (${name}): ${error.message}`);
    failures.push(`pageerror:${name}:${error.message}`);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#name', name);
  return { context, page };
}

/** Reads the room code off the lobby screen. */
async function readRoomCode(page) {
  const text = await page.locator('p.font-display.text-5xl').first().innerText();
  return text.trim();
}

async function currentRoundLabel(page) {
  const locator = page.getByText(/^Round \d+ of \d+$/i).first();
  if ((await locator.count()) === 0) return null;
  // Labels are uppercased via CSS `text-transform`, so innerText comes back as
  // "ROUND 1 OF 6". Normalise rather than asserting on presentation.
  return (await locator.innerText()).trim().toLowerCase();
}

/**
 * Sets the bid slider and submits. Clamps to the input's own max: a player's
 * coins fall as they win lots, so a fixed bid eventually exceeds the slider.
 */
async function placeBid(page, desired) {
  const range = page.locator('input[type="range"]');
  // A player with zero coins gets no slider at all (the UI hides it); the only
  // legal action is passing, which is still a bid the server needs.
  const hasSlider = (await range.count()) > 0;
  let submitted = 0;

  if (hasSlider) {
    const max = Number(await range.getAttribute('max'));
    const step = Number(await range.getAttribute('step')) || 5;
    const value = Math.max(0, Math.min(desired, max));
    submitted = Math.round(value / step) * step;
    await range.fill(String(submitted));
  }

  const bidButton = page.getByRole('button', { name: /^Bid \d+ coins$/ });
  const passButton = page.getByRole('button', { name: /^Pass on this lot$/ });
  await ((await bidButton.count()) > 0 ? bidButton : passButton).click();
  return submitted;
}

console.log(`\nKEEPSAKE e2e — ${BASE}\n`);

// --- Host creates a room ----------------------------------------------------
const host = await newPlayer('Tariq', { width: 390, height: 844 });
await host.page.getByRole('button', { name: 'Create a room' }).click();
await host.page.waitForURL(/\/room\/[A-Z0-9]{4}/, { timeout: 10_000 });
await host.page.waitForSelector('text=Room code', { timeout: 10_000 });
const code = await readRoomCode(host.page);
check('host lands in a room with a 4-char code', /^[A-Z0-9]{4}$/.test(code), code);
await host.page.screenshot({ path: `${SHOTS}/01-lobby-host.png` });

// --- Second player joins by code --------------------------------------------
const guest = await newPlayer('Wren', { width: 375, height: 667 });
await guest.page.getByLabel('Room code').fill(code);
await guest.page.getByRole('button', { name: 'Join' }).click();
await guest.page.waitForSelector('text=Room code', { timeout: 10_000 });

await host.page.waitForSelector('text=Wren', { timeout: 10_000 });
check('guest appears on the host screen (live sync)', true);
await host.page.screenshot({ path: `${SHOTS}/02-lobby-two-players.png` });

// --- Start the reading ------------------------------------------------------
await host.page.getByRole('button', { name: 'Begin the reading' }).click();
await Promise.all([
  host.page.waitForSelector('text=Your bid', { timeout: 15_000 }),
  guest.page.waitForSelector('text=Your bid', { timeout: 15_000 }),
]);
const hostRound = await currentRoundLabel(host.page);
check('both players enter round 1 together', hostRound === 'round 1 of 6', String(hostRound));
await host.page.screenshot({ path: `${SHOTS}/03-bidding.png` });

// Both players must be looking at the SAME lot.
const hostLot = await host.page.locator('h2.font-display').first().innerText();
const guestLot = await guest.page.locator('h2.font-display').first().innerText();
check('both screens show the same lot', hostLot === guestLot, `${hostLot} vs ${guestLot}`);

// --- Play all six rounds ----------------------------------------------------
for (let round = 1; round <= 6; round += 1) {
  await Promise.all([
    host.page.waitForSelector('text=Your bid', { timeout: 15_000 }),
    guest.page.waitForSelector('text=Your bid', { timeout: 15_000 }),
  ]);

  // Host always outbids the guest, but both bids scale with what they still
  // hold: a fixed ladder makes the host unable to afford its own bid by round 3.
  const stackText = (await guest.page.getByText(/\d+ of \d+ coins left/).innerText()) ?? '0 of 0';
  const guestStack = Number(stackText.match(/(\d+) of/)?.[1] ?? 0);
  const guestBid = Math.max(0, Math.min(10, Math.floor(guestStack / 3 / 5) * 5));
  await placeBid(host.page, guestBid + 15);
  await host.page.waitForSelector('text=Bid sealed.', { timeout: 10_000 });
  await placeBid(guest.page, guestBid);

  // The server resolves as soon as both bids are in.
  await host.page
    .getByText(/^The bids$/i)
    .first()
    .waitFor({ timeout: 20_000 });
  const sold = await host.page.getByText(/^Sold$/i).count();
  check(`round ${round} resolved with a sale`, sold > 0);
  if (round === 1) await host.page.screenshot({ path: `${SHOTS}/04-reveal.png` });

  if (round < 6) {
    // The reveal is a 7s server-side timer; wait for the next lot to be called.
    const next = round + 1;
    await host.page
      .waitForFunction(
        (label) => document.body.innerText.toLowerCase().includes(label),
        `round ${next} of 6`,
        { timeout: 20_000 },
      )
      .catch(() => {});
    await host.page.waitForSelector('text=Your bid', { timeout: 20_000 });
  }
}

// --- Recap ------------------------------------------------------------------
await Promise.all([
  host.page.waitForSelector('text=Final standings', { timeout: 25_000 }),
  guest.page.waitForSelector('text=Final standings', { timeout: 25_000 }),
]);
check('both players reach the recap', true);

const hostWinner = await host.page.locator('h2.font-display').first().innerText();
const guestWinner = await guest.page.locator('h2.font-display').first().innerText();
check(
  'both screens agree on the winner',
  hostWinner === guestWinner,
  `${hostWinner} vs ${guestWinner}`,
);

// The audit panel is the portfolio differentiator; prove it rendered numbers.
const audit = await host.page.getByText('Bid economics').count();
check('bid economics panel rendered', audit > 0);
const overpaid = await host.page.getByText(/Overpaid by/i).count();
check('per-player overpayment is shown', overpaid > 0);

// Every collection must be public at the recap.
const revealed = await host.page
  .getByText(/held The |held The Correspondence|held The Record|held The Garden|held The Wardrobe/i)
  .count();
check('recap reveals every collection', revealed >= 2, String(revealed));
await host.page.screenshot({ path: `${SHOTS}/05-recap.png`, fullPage: true });

// --- Mobile overflow --------------------------------------------------------
const overflow = await host.page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
check(
  'no horizontal overflow at 390px',
  overflow.scrollWidth <= overflow.clientWidth + 1,
  JSON.stringify(overflow),
);

// --- Rematch ----------------------------------------------------------------
await host.page.getByRole('button', { name: 'Deal again' }).click();
await host.page.waitForSelector('text=Your bid', { timeout: 15_000 });
const rematchRound = await currentRoundLabel(host.page);
check('rematch returns to round 1', rematchRound === 'round 1 of 6', String(rematchRound));

// --- Bot mode (the recruiter path) ------------------------------------------
const solo = await newPlayer('Recruiter', { width: 390, height: 844 });
await solo.page.getByRole('button', { name: 'Play now vs. bots' }).click();
await solo.page.waitForURL(/\/room\/[A-Z0-9]{4}/, { timeout: 10_000 });
await solo.page.waitForSelector('text=Heirs', { timeout: 15_000 });
// Give the bot-seating requests time to land.
await solo.page.waitForTimeout(2500);
const heirCount = await solo.page.locator('ul li').count();
check('bots are seated automatically', heirCount >= 4, `${heirCount} rows`);
await solo.page.screenshot({ path: `${SHOTS}/06-bots-lobby.png` });

await browser.close();

console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`);
if (failures.length) {
  for (const failure of failures) console.log(` - ${failure}`);
  process.exit(1);
}
