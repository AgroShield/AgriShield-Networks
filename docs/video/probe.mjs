/** Measures the exact boxes the video's callouts will point at. */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** Working directory for renders. Override with WORKDIR to keep them out of the tree. */
const ROOT = (process.env.WORKDIR ?? fileURLToPath(new URL('.', import.meta.url))).replace(/\/$/, '');


const BASE = process.env.CONSOLE_URL ?? 'https://frontend-eight-delta-o0pj7gck3j.vercel.app';
const FARMER = 'GCSHYGP5KXGNCMTGMTYPX5WV5RPU7C2YTCU4LSGMO42IMZSEKOPPKCZY';
mkdirSync(`${ROOT}/assets`, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => !document.body.innerText.includes('Reading the chain'), null, {
  timeout: 90000,
});
await page.fill('input[name="farmer"]', FARMER);
await page.click('button[type="submit"]');
await page.waitForFunction(() => document.body.innerText.includes('#2'), null, { timeout: 90000 });
await page.click('.policy-row:has-text("#2")');
await page.waitForSelector('h3:has-text("Policy #2")', { timeout: 90000 });
await page.waitForFunction(() => !document.body.innerText.includes('Asking the engine'), null, {
  timeout: 90000,
});
await page.waitForTimeout(300);

const r = await page.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.x + window.scrollX),
      y: Math.round(b.y + window.scrollY),
      w: Math.round(b.width),
      h: Math.round(b.height),
    };
  };
  /** The `.field` whose label reads exactly this. */
  const field = (label) =>
    [...document.querySelectorAll('.field')].find(
      (f) => f.querySelector('.field__label')?.textContent.trim() === label,
    );

  const health = document.querySelector('.app__header')?.lastElementChild;
  return {
    searchForm: box(document.querySelector('form.search')),
    searchInput: box(document.querySelector('input[name="farmer"]')),
    searchButton: box(document.querySelector('form.search button[type="submit"]')),
    listPanel: box(document.querySelector('.panel[aria-label="Policy lookup"]')),
    list: box(document.querySelector('.list')),
    row2: box(document.querySelectorAll('.policy-row')[0]),
    row1: box(document.querySelectorAll('.policy-row')[1]),
    activeChip: box(
      [...document.querySelectorAll('.policy-row .chip')].find(
        (c) => c.textContent.trim() === 'Active',
      ),
    ),
    detailPanel: box(document.querySelector('.panel[aria-label="Policy detail"]')),
    detail: box(document.querySelector('.detail')),
    detailHeader: box(document.querySelector('.detail__header')),
    payoutField: box(field('Payout')),
    thresholdField: box(field('Pays at index ≤')),
    premiumField: box(field('Premium')),
    coverField: box(field('Cover')),
    fieldGrid: box(document.querySelector('.field-grid')),
    previewSection: box(document.querySelector('.detail__section[aria-label="Settlement preview"]')),
    previewChip: box(
      document.querySelector('.detail__section[aria-label="Settlement preview"] .chip'),
    ),
    settleSection: box(document.querySelector('.detail__section[aria-label="Submit settlement"]')),
    healthPanel: box(health),
    keeperPanel: box(document.querySelector('.keeper')),
  };
});

console.log(JSON.stringify(r, null, 1));
writeFileSync(`${ROOT}/assets/boxes.json`, JSON.stringify(r, null, 2));
await browser.close();
