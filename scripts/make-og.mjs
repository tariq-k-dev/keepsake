/**
 * Renders `public/og.png` — the 1200x630 social preview card.
 *
 *   pnpm og
 *
 * Why a script instead of a file dropped in by hand: the card must match the
 * app's actual palette, or a shared link previews a slightly-wrong product. The
 * colours below are the same values as `@theme` in src/client/index.css, and the
 * layout is drawn with Playwright so text is really typeset rather than
 * approximated.
 *
 * 1200x630 is the size Facebook, LinkedIn, Slack and X crop least. Text is kept
 * inside the middle 80% because X and Slack render a centre crop on some
 * clients, and the wordmark sits high so a bottom-corner crop cannot eat it.
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = 'public/og.png';
mkdirSync('public', { recursive: true });

// Mirrors @theme tokens in src/client/index.css.
const C = {
  ink950: '#0e0d0b',
  ink900: '#16140f',
  ink800: '#26221a',
  parchment50: '#f6f1e4',
  parchment200: '#e4d9c0',
  parchment400: '#b8a988',
  parchment600: '#a89975',
  brass300: '#f0d089',
  brass500: '#c99b39',
  burnt400: '#e07a5f',
  moss400: '#8aa07a',
};

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'Display'; src: local('Palatino Linotype'), local('Palatino'), local('Georgia'), local('Times New Roman'); }
  * { margin: 0; box-sizing: border-box; }

  body {
    width: 1200px; height: 630px;
    background:
      radial-gradient(1100px 520px at 12% -12%, rgba(201,155,57,0.16), transparent 62%),
      radial-gradient(900px 480px at 100% 118%, rgba(224,122,95,0.10), transparent 60%),
      ${C.ink950};
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: ${C.parchment50};
    display: flex; align-items: center;
    padding: 0 84px;
    position: relative;
    overflow: hidden;
  }

  /* Hairline catalogue rule, top and bottom — the auction-programme motif. */
  body::before, body::after {
    content: ''; position: absolute; left: 84px; right: 84px; height: 1px;
    background: linear-gradient(90deg, ${C.brass500}66, ${C.brass500}00);
  }
  body::before { top: 52px; }
  body::after { bottom: 52px; }

  .col { display: flex; flex-direction: column; justify-content: center; width: 100%; }

  .eyebrow {
    font-size: 19px; letter-spacing: 0.30em; text-transform: uppercase;
    color: ${C.brass500}; font-weight: 600; margin-bottom: 26px;
  }

  h1 {
    font-family: 'Display', Georgia, serif;
    font-size: 132px; line-height: 0.94; letter-spacing: 0.10em;
    color: ${C.brass300}; margin-bottom: 30px; font-weight: 400;
  }

  .tagline {
    font-family: 'Display', Georgia, serif;
    font-size: 40px; line-height: 1.28; color: ${C.parchment200};
    max-width: 900px; margin-bottom: 34px;
  }

  .rule { width: 108px; height: 3px; background: ${C.brass500}; margin-bottom: 26px; }

  .meta { display: flex; align-items: center; gap: 22px; font-size: 21px; color: ${C.parchment400}; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: ${C.ink800}; }
  .pill {
    padding: 9px 17px; border-radius: 999px; font-size: 17px; font-weight: 600;
    letter-spacing: 0.13em; text-transform: uppercase;
    border: 1px solid ${C.brass500}88; color: ${C.brass300};
  }
  .live { border-color: ${C.moss400}88; color: ${C.moss400}; }
</style>
</head>
<body>
  <div class="col">
    <div class="eyebrow">The Reading of the Will</div>
    <h1>KEEPSAKE</h1>
    <div class="rule"></div>
    <div class="tagline">
      Six heirlooms. Six sealed bids.<br />
      Nobody shows their hand until the gavel falls.
    </div>
    <div class="meta">
      <span class="pill">2&ndash;8 players</span>
      <span class="pill live">Real-time</span>
      <span class="dot"></span>
      <span>Join with a 4-letter code &middot; no accounts, no installs</span>
    </div>
  </div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: 'load' });
// Give webfont fallback a beat to settle before capture.
await page.waitForTimeout(250);
await page.screenshot({ path: OUT, type: 'png' });
await browser.close();

console.log(`wrote ${OUT}`);
