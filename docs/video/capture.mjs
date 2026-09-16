/**
 * Captures the live console for the product video.
 *
 * Renders at 1280 CSS px wide with deviceScaleFactor 2, so every shot is a
 * 2560-wide raster and downscales cleanly into a 1920x1080 frame. Full-page
 * captures, plus the geometry of each panel, let exact 16:9 windows be cropped
 * afterwards without guessing where anything is.
 *
 * Every claim a shot makes is asserted here, because the operator of this script
 * cannot see images: the text is printed and the boxes are measured.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** Working directory for renders. Override with WORKDIR to keep them out of the tree. */
const ROOT = (process.env.WORKDIR ?? fileURLToPath(new URL('.', import.meta.url))).replace(/\/$/, '');


const BASE = process.env.CONSOLE_URL ?? 'https://frontend-eight-delta-o0pj7gck3j.vercel.app';
const FARMER = 'GCSHYGP5KXGNCMTGMTYPX5WV5RPU7C2YTCU4LSGMO42IMZSEKOPPKCZY';
const OUT = `${ROOT}/assets`;
mkdirSync(OUT, { recursive: true });

const report = {};
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await context.newPage();

const failed = [];
page.on('response', (r) => {
  if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
});
page.on('pageerror', (e) => failed.push(`pageerror ${e.message}`));

/** Box of an element in CSS px, which the crop maths multiplies by two. */
async function boxes(selectors) {
  return page.evaluate((sels) => {
    const out = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) { out[s] = null; continue; }
      const r = el.getBoundingClientRect();
      out[s] = {
        x: Math.round(r.x + window.scrollX),
        y: Math.round(r.y + window.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }
    return out;
  }, selectors);
}

console.log('==> loading', BASE);
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(
  () => !document.body.innerText.includes('Reading the chain'),
  null,
  { timeout: 90000 },
);

// ------------------------------------------------------- empty state
await page.screenshot({ path: `${OUT}/console-empty.png`, fullPage: true });
report.empty = {
  height: await page.evaluate(() => document.documentElement.scrollHeight),
  boxes: await boxes(['.app__header', '.panel[aria-label="Policy lookup"]', 'body']),
};
console.log('  empty-state height:', report.empty.height);

// ------------------------------------------------------- searched + selected
console.log('==> searching');
await page.fill('input[name="farmer"]', FARMER);
await page.click('button[type="submit"]');
await page.waitForFunction(() => document.body.innerText.includes('#2'), null, { timeout: 90000 });
await page.click('.policy-row:has-text("#2")');
await page.waitForSelector('h3:has-text("Policy #2")', { timeout: 90000 });
await page.waitForFunction(
  () => !document.body.innerText.includes('Asking the engine'),
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(300);

const body = await page.innerText('body');
report.state = {
  height: await page.evaluate(() => document.documentElement.scrollHeight),
  hasActive: body.includes('Active'),
  hasSettled: body.includes('Settled'),
  previewPaid: body.includes('Paid'),
  breachLine: body.includes('breached the threshold inside the cover window'),
  readOnly: body.includes('Read-only deployment'),
  keeperReadOnly: body.includes('This deployment is read-only'),
  failedRequests: failed,
  boxes: await boxes([
    '.app__header',
    '.panel[aria-label="Policy lookup"]',
    '.panel[aria-label="Policy detail"]',
    '.list',
    '.policy-row',
    '.detail',
    '.detail__section[aria-label="Settlement preview"]',
    '.detail__section[aria-label="Submit settlement"]',
    '.app__main',
    'form.search',
  ]),
};
console.log('  height:', report.state.height);
console.log('  preview Paid:', report.state.previewPaid, '| breach line:', report.state.breachLine);
console.log('  failed requests:', report.state.failedRequests.length ? report.state.failedRequests : 'none');
console.log('  boxes:', JSON.stringify(report.state.boxes, null, 1));

await page.screenshot({ path: `${OUT}/console-full.png`, fullPage: true });

// A viewport shot with the list and the empty detail column, as it first looks.
await page.screenshot({ path: `${OUT}/console-list.png` });

// The detail column, framed for a close-up.
await page.locator('.panel[aria-label="Policy detail"]').screenshot({ path: `${OUT}/console-detail-panel.png` });
await page.locator('.list').screenshot({ path: `${OUT}/console-list-panel.png` });

// The keeper panel lives below the fold; capture it on its own.
await page.locator('section:has-text("Settlement keeper")').last().screenshot({
  path: `${OUT}/console-keeper.png`,
});

// ------------------------------------------------------- workflow recording
console.log('==> recording the interaction pass');
const videoContext = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1.5,
  recordVideo: { dir: `${OUT}/video`, size: { width: 1920, height: 1080 } },
});
const vp = await videoContext.newPage();
await vp.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
await vp.waitForFunction(
  () => !document.body.innerText.includes('Reading the chain'),
  null,
  { timeout: 90000 },
);
await vp.waitForTimeout(1200);
await vp.click('input[name="farmer"]');
await vp.type('input[name="farmer"]', FARMER, { delay: 24 });
await vp.waitForTimeout(600);
await vp.click('button[type="submit"]');
await vp.waitForSelector('.policy-row', { timeout: 90000 });
await vp.waitForTimeout(1500);
await vp.click('.policy-row:has-text("#2")');
await vp.waitForSelector('h3:has-text("Policy #2")', { timeout: 90000 });
await vp.waitForTimeout(2400);
await vp.locator('.detail__section[aria-label="Settlement preview"]').scrollIntoViewIfNeeded();
await vp.waitForTimeout(2000);
await vp.locator('section:has-text("Settlement keeper")').last().scrollIntoViewIfNeeded();
await vp.waitForTimeout(1600);
await vp.locator('.policy-row:has-text("#1")').scrollIntoViewIfNeeded();
await vp.waitForTimeout(500);
await vp.click('.policy-row:has-text("#1")');
await vp.waitForTimeout(2200);
report.video = await vp.video().path();
console.log('  recorded:', report.video);
await videoContext.close();

await import('node:fs').then((fs) =>
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2)),
);
await context.close();
await browser.close();
console.log('==> done');
