/**
 * Verifies two polish claims in a real browser, against the built app.
 *
 *   E2E_BASE=http://127.0.0.1:8796 node scripts/check-polish.mjs
 *
 * 1. Cursors: every enabled interactive control computes to `pointer` (or
 *    `text` for a text field). Asserting on classes is not enough — Tailwind v4
 *    dropped the button pointer rule, and a class string can exist while losing
 *    to another rule. `getComputedStyle` is the only honest check.
 * 2. OG tags: every required property is present, and og:image / og:url are
 *    absolute URLs that actually resolve to a real image.
 */

import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:8796';
const failures = [];
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

/* ---------------------------------------------------------------- cursors */
console.log('\nCursors (computed style, not class names)\n');

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#name', { timeout: 15000 });

const cursorReport = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, select, input, a[href], [role="button"]')) {
    const style = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') ?? '';
    const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
    // Invisible or zero-size controls cannot be clicked, so their cursor is moot.
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    out.push({
      tag,
      type,
      disabled,
      cursor: style.cursor,
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 34),
    });
  }
  return out;
});

const clickable = cursorReport.filter((c) => !c.disabled);
// A text field is identified by its RESOLVED type: `input.type` defaults to
// "text" for a bare <input>, so an empty attribute still means a caret target.
const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password']);
const textFields = clickable.filter(
  (c) => c.tag === 'input' && TEXT_TYPES.has((c.type || 'text').toLowerCase()),
);

const buttons = clickable.filter((c) => !textFields.includes(c));
ok(
  `all ${buttons.length} enabled clickable controls show a pointer`,
  buttons.every((c) => c.cursor === 'pointer'),
  buttons
    .filter((c) => c.cursor !== 'pointer')
    .map((c) => `${c.tag}.${c.type}:"${c.label}"→${c.cursor}`)
    .join(', '),
);
ok(
  `all ${textFields.length} text inputs show a text caret cursor`,
  textFields.every((c) => c.cursor === 'text'),
  textFields
    .filter((c) => c.cursor !== 'text')
    .map((c) => `${c.label}→${c.cursor}`)
    .join(', '),
);

// Disabled controls must NOT invite a click.
const disabled = cursorReport.filter((c) => c.disabled);
ok(
  `disabled controls (${disabled.length}) do not show a pointer`,
  disabled.every((c) => c.cursor !== 'pointer'),
  disabled
    .filter((c) => c.cursor === 'pointer')
    .map((c) => c.label)
    .join(', '),
);

/* ------------------------------------------------ cursors inside the game */
// The lobby/bidding screens render different controls; check those too.
// The name field must be filled first: "Play now" is refused without it, and a
// silent refusal here previously looked like a broken bot mode.
await page.fill('#name', 'Polisher');
await page.getByRole('button', { name: 'Play now vs. bots' }).click();
// The app routes with history.pushState, which does NOT fire a navigation event,
// so `waitForURL` never resolves. Wait for the bidding UI to actually render.
await page
  .getByText(/^Your bid$/i)
  .first()
  .waitFor({ timeout: 25000 });

const gameCursors = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, select, input[type="range"]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (el.disabled) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') ?? '',
      cursor: getComputedStyle(el).cursor,
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
    });
  }
  return out;
});
ok(
  `in-game controls (${gameCursors.length}) all show a pointer`,
  gameCursors.every((c) => c.cursor === 'pointer'),
  gameCursors
    .filter((c) => c.cursor !== 'pointer')
    .map((c) => `${c.tag}.${c.type}:"${c.label}"→${c.cursor}`)
    .join(', '),
);

/* ----------------------------------------------------------------- OG tags */
console.log('\nOpen Graph tags\n');

const meta = await page.evaluate(() => {
  const grab = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr) ?? null;
  return {
    ogType: grab('meta[property="og:type"]'),
    ogTitle: grab('meta[property="og:title"]'),
    ogDescription: grab('meta[property="og:description"]'),
    ogUrl: grab('meta[property="og:url"]'),
    ogImage: grab('meta[property="og:image"]'),
    ogImageWidth: grab('meta[property="og:image:width"]'),
    ogImageHeight: grab('meta[property="og:image:height"]'),
    ogImageAlt: grab('meta[property="og:image:alt"]'),
    ogSiteName: grab('meta[property="og:site_name"]'),
    twCard: grab('meta[name="twitter:card"]'),
    twTitle: grab('meta[name="twitter:title"]'),
    twDescription: grab('meta[name="twitter:description"]'),
    twImage: grab('meta[name="twitter:image"]'),
    title: document.title,
    description: grab('meta[name="description"]'),
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null,
  };
});

for (const [key, value] of Object.entries(meta)) {
  ok(`${key} present`, Boolean(value), String(value));
}

ok('og:title matches <title>', meta.ogTitle === meta.title, `${meta.ogTitle} vs ${meta.title}`);
ok('og:image is an absolute URL', /^https?:\/\//.test(meta.ogImage ?? ''), String(meta.ogImage));
ok('og:url is an absolute URL', /^https?:\/\//.test(meta.ogUrl ?? ''), String(meta.ogUrl));
ok('twitter:image is absolute', /^https?:\/\//.test(meta.twImage ?? ''), String(meta.twImage));
ok(
  'twitter:card is summary_large_image',
  meta.twCard === 'summary_large_image',
  String(meta.twCard),
);
ok(
  'og:image declares 1200x630',
  meta.ogImageWidth === '1200' && meta.ogImageHeight === '630',
  `${meta.ogImageWidth}x${meta.ogImageHeight}`,
);
ok(
  'og:image and twitter:image agree',
  meta.ogImage === meta.twImage,
  `${meta.ogImage} vs ${meta.twImage}`,
);

/* ------------------------------------------ the referenced image is real */
console.log('\nOG asset\n');

// Fetch the image off the same origin (the URL in the tag points at the
// production host, which may not be live yet — so resolve the PATH locally).
const imagePath = new URL(meta.ogImage ?? '/og.png').pathname;
const res = await page.request.get(new URL(imagePath, BASE).toString());
ok(`og image responds 200 at ${imagePath}`, res.status() === 200, String(res.status()));
ok(
  'og image is image/png',
  (res.headers()['content-type'] ?? '').includes('image/png'),
  res.headers()['content-type'],
);

const bytes = await res.body();
ok('og image is a real png (signature)', bytes.subarray(1, 4).toString() === 'PNG');
// Parse IHDR for the true dimensions — the tag claims 1200x630.
const width = bytes.readUInt32BE(16);
const height = bytes.readUInt32BE(20);
ok(`og image is actually 1200x630`, width === 1200 && height === 630, `${width}x${height}`);
ok(
  'og image under 1 MB (fast crawler fetch)',
  bytes.length < 1_000_000,
  `${Math.round(bytes.length / 1024)} KB`,
);

const faviconRes = await page.request.get(new URL(meta.favicon ?? '/favicon.svg', BASE).toString());
ok('favicon responds 200', faviconRes.status() === 200, String(faviconRes.status()));

await browser.close();

console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
