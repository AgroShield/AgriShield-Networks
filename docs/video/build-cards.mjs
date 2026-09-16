/**
 * Builds the video's graphic cards as 1920x1080 PNGs at 2x.
 *
 * Two rules hold throughout:
 *   1. Every number, address and hash on a card is real and traceable. Nothing
 *      is rounded up or invented to sound better.
 *   2. Callouts on the console are positioned from measured element geometry,
 *      not eyeballed, and the script asserts each one lands inside its frame.
 *      That matters because the operator cannot see the rendered image.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** Working directory for renders. Override with WORKDIR to keep them out of the tree. */
const ROOT = (process.env.WORKDIR ?? fileURLToPath(new URL('.', import.meta.url))).replace(/\/$/, '');


const OUT = `${ROOT}/assets`;
const CARDS = `${ROOT}/cards`;
mkdirSync(CARDS, { recursive: true });

const BASE = process.env.CONSOLE_URL ?? 'https://frontend-eight-delta-o0pj7gck3j.vercel.app';
const FARMER = 'GCSHYGP5KXGNCMTGMTYPX5WV5RPU7C2YTCU4LSGMO42IMZSEKOPPKCZY';
const boxes = JSON.parse(readFileSync(`${OUT}/boxes.json`, 'utf8'));

// ---------------------------------------------------------------------------
// A high-resolution copy of the detail panel: the zoom card shows it enlarged,
// so a 2x capture would be upscaled. 3x keeps it a downscale.
// ---------------------------------------------------------------------------
const browser = await chromium.launch({ args: ['--no-sandbox'] });
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 3,
    colorScheme: 'light',
  });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle', timeout: 120000 });
  await p.waitForFunction(() => !document.body.innerText.includes('Reading the chain'), null, {
    timeout: 90000,
  });
  await p.fill('input[name="farmer"]', FARMER);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => document.body.innerText.includes('#2'), null, { timeout: 90000 });
  await p.click('.policy-row:has-text("#2")');
  await p.waitForSelector('h3:has-text("Policy #2")', { timeout: 90000 });
  await p.waitForFunction(() => !document.body.innerText.includes('Asking the engine'), null, {
    timeout: 90000,
  });
  await p.waitForTimeout(300);
  await p.locator('.panel[aria-label="Policy detail"]').screenshot({
    path: `${OUT}/detail-panel@3x.png`,
  });
  await ctx.close();
  console.log('captured detail-panel@3x.png');
}

const T = {
  ink: '#16202c',
  muted: '#5a6675',
  line: '#d8dde5',
  panel: '#ffffff',
  bg: '#f6f7f9',
  accent: '#1f6f4a',
  accentSoft: '#e5f3ea',
  dark: '#0b1410',
  dark2: '#12241b',
  darkInk: '#e9f1ec',
  darkMuted: '#8fa89b',
  darkAccent: '#5fd39b',
};

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Inter, system-ui, sans-serif; background: #fff; }
  .card {
    position: relative; width: 1920px; height: 1080px; overflow: hidden;
    background: ${T.bg}; color: ${T.ink};
    display: flex; flex-direction: column; justify-content: center;
    padding: 96px 120px;
  }
  .card--dark {
    background: radial-gradient(1200px 800px at 78% 18%, ${T.dark2} 0%, ${T.dark} 62%);
    color: ${T.darkInk};
  }
  .kicker {
    font-size: 17px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase;
    color: ${T.accent}; margin-bottom: 20px;
  }
  .card--dark .kicker { color: ${T.darkAccent}; }
  h1 { font-size: 132px; font-weight: 800; letter-spacing: -.035em; line-height: 1; }
  h2 { font-size: 62px; font-weight: 700; letter-spacing: -.025em; line-height: 1.1; max-width: 1250px; }
  .lede { font-size: 27px; line-height: 1.5; color: ${T.muted}; max-width: 1000px; margin-top: 26px; }
  .card--dark .lede { color: ${T.darkMuted}; }

  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; margin-top: 62px; }
  .tile {
    background: ${T.panel}; border: 1px solid ${T.line}; border-radius: 18px;
    padding: 38px 34px; box-shadow: 0 12px 30px rgba(22,32,44,.06);
  }
  .tile__n { font-size: 20px; font-weight: 700; color: ${T.accent}; margin-bottom: 14px; }
  .tile__t { font-size: 30px; font-weight: 650; letter-spacing: -.015em; margin-bottom: 12px; }
  .tile__b { font-size: 21px; line-height: 1.5; color: ${T.muted}; }

  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

  /* ------------------------------------------------ architecture diagram */
  .flow, .under, .oracle-row {
    display: grid;
    grid-template-columns: minmax(0,1fr) 78px minmax(0,1fr) 78px minmax(0,1fr) 78px minmax(0,1fr);
    gap: 0 10px;
  }
  .flow { align-items: stretch; margin-top: 50px; }
  .node {
    background: ${T.panel}; border: 1px solid ${T.line}; border-radius: 16px;
    padding: 28px 24px; box-shadow: 0 12px 30px rgba(22,32,44,.06);
  }
  .node__t { font-size: 25px; font-weight: 700; letter-spacing: -.015em; }
  .node__s { font-size: 17px; color: ${T.muted}; margin-top: 9px; line-height: 1.45; }
  .node--accent { background: ${T.accentSoft}; border-color: #b9dcc8; }
  .node--accent .node__s { color: #2c6349; }
  .arrow {
    display: flex; align-items: center; justify-content: center;
    font-size: 32px; color: ${T.accent}; font-weight: 700;
  }
  .under { margin-top: 16px; }
  .up { font-size: 17px; color: ${T.accent}; font-weight: 600; line-height: 1.4; padding-left: 4px; }
  .oracle-row { margin-top: 26px; }
  .oracle {
    grid-column: 5; background: ${T.panel}; border: 1px dashed ${T.accent};
    border-radius: 14px; padding: 20px 22px;
  }
  .oracle__t { font-size: 21px; font-weight: 650; letter-spacing: -.01em; }
  .oracle__s { font-size: 17px; color: ${T.muted}; margin-top: 6px; }

  /* ------------------------------------------------------ browser frame */
  .browser {
    background: ${T.panel}; border: 1px solid ${T.line}; border-radius: 14px;
    box-shadow: 0 30px 70px rgba(22,32,44,.18); overflow: hidden; position: absolute;
  }
  .browser__bar {
    height: 48px; background: #eef1f5; border-bottom: 1px solid ${T.line};
    display: flex; align-items: center; gap: 10px; padding: 0 18px;
  }
  .dot { width: 13px; height: 13px; border-radius: 50%; background: #cfd6df; }
  .urlpill {
    margin-left: 16px; background: #fff; border: 1px solid ${T.line}; border-radius: 999px;
    padding: 6px 20px; font-size: 16px; color: ${T.muted};
  }
  .browser img { display: block; }
  .shot { position: absolute; overflow: hidden; border-radius: 10px; }
  .shot img { display: block; }

  /* --------------------------------------------------------- annotations */
  .ring {
    position: absolute; border: 3px solid ${T.accent}; border-radius: 8px; pointer-events: none;
  }
  .badge {
    position: absolute; width: 40px; height: 40px; border-radius: 50%;
    background: ${T.accent}; color: #fff; font-size: 21px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 16px rgba(31,111,74,.4);
  }
  .legend { display: flex; flex-direction: column; gap: 20px; }
  .legend__row { display: flex; gap: 16px; align-items: flex-start; }
  .legend__num {
    flex: none; width: 36px; height: 36px; border-radius: 50%; background: ${T.accent};
    color: #fff; font-size: 19px; font-weight: 700; display: flex;
    align-items: center; justify-content: center;
  }
  .legend__t { font-size: 24px; font-weight: 650; letter-spacing: -.01em; }
  .legend__b { font-size: 19px; color: ${T.muted}; line-height: 1.45; margin-top: 4px; }

  /* ---------------------------------------------------------- terminal */
  .term {
    background: #0f151c; border: 1px solid #26313d; border-radius: 14px;
    box-shadow: 0 30px 70px rgba(22,32,44,.28); overflow: hidden; margin-top: 44px;
  }
  .term__bar {
    height: 46px; background: #151d26; border-bottom: 1px solid #26313d;
    display: flex; align-items: center; gap: 10px; padding: 0 18px;
    color: #7d8b9a; font-size: 16px;
  }
  .term__body { padding: 28px 34px; font-family: 'JetBrains Mono', monospace; }
  .term__line { font-size: 22px; line-height: 1.85; white-space: pre; color: #cbd5e0; }
  .term__cmd { color: #5fd39b; }
  .term__ok { color: #8fa8bd; }
  .term__hi { color: #e8edf3; }
  .term__note { color: #6b7c8d; }

  .addr { font-size: 23px; letter-spacing: -.01em; }
  .stat { display: flex; gap: 14px; align-items: baseline; }
  .stat__n { font-size: 54px; font-weight: 750; letter-spacing: -.03em; }
  .stat__l { font-size: 20px; color: ${T.darkMuted}; }
  .card--dark .tile { background: rgba(255,255,255,.045); border-color: rgba(255,255,255,.1); box-shadow: none; }
  .card--dark .tile__b { color: ${T.darkMuted}; }
  .card--dark .tile__t { color: ${T.darkInk}; }
`;

// ---------------------------------------------------------------------------
// Callout helper. The console shots are displayed at a known scale and origin,
// so a measured CSS box maps linearly into card coordinates.
// ---------------------------------------------------------------------------
// `ox`/`oy` already account for the scale, so a measured CSS box maps linearly.
function ring(box, scale, ox, oy, n) {
  const x = Math.round(ox + box.x * scale);
  const y = Math.round(oy + box.y * scale);
  const w = Math.round(box.w * scale);
  const h = Math.round(box.h * scale);
  return `<div class="ring" style="left:${x - 6}px;top:${y - 6}px;width:${w + 12}px;height:${h + 12}px"></div>
    <div class="badge" style="left:${x - 20}px;top:${y - 20}px">${n}</div>`;
}

const CARD_LIST = [];

/** Poster — the README thumbnail and the release's social preview. */
CARD_LIST.push({
  name: 's0-poster',
  poster: true,
  html: `<div class="card card--dark" style="padding:0;flex-direction:row;align-items:center;gap:54px;justify-content:flex-start;padding-left:76px">
    <div style="width:700px;flex:none">
      <div class="kicker">Stellar testnet · live</div>
      <h1 style="font-size:104px">AgriShield</h1>
      <p class="lede" style="font-size:29px;color:${T.darkInk};margin-top:24px">
        Parametric drought cover that<br>settles itself — no claims, no adjuster.
      </p>
      <div style="margin-top:34px;display:inline-flex;align-items:center;gap:16px;background:${T.darkAccent};color:#08160f;border-radius:999px;padding:16px 32px;font-size:25px;font-weight:700">
        ▶ Watch the 2-minute pitch
      </div>
      <div style="margin-top:28px;font-size:19px;color:${T.darkMuted}" class="mono">
        github.com/AgroShield/AgriShield-Networks
      </div>
    </div>
    <div class="browser" style="position:relative;left:0;top:0;width:1000px;flex:none">
      <div class="browser__bar">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        <span class="urlpill">frontend-eight-delta-o0pj7gck3j.vercel.app</span>
      </div>
      <img src="file://${OUT}/console-list.png" width="1000" height="625">
    </div>
  </div>`,
});

/** Card 1 — title. */
CARD_LIST.push({
  name: 's1-title',
  html: `<div class="card card--dark" style="align-items:flex-start;justify-content:center">
    <div class="kicker">Stellar testnet · live</div>
    <h1>AgriShield</h1>
    <p class="lede" style="font-size:34px;max-width:1150px;color:${T.darkInk};margin-top:30px">
      Parametric drought cover that settles itself —<br>
      no claims, no adjuster, no waiting.
    </p>
    <div style="margin-top:56px;display:flex;gap:14px;align-items:center;font-size:20px;color:${T.darkMuted}">
      <span class="mono" style="color:${T.darkAccent}">4 contracts</span><span>·</span>
      <span class="mono" style="color:${T.darkAccent}">395 tests</span><span>·</span>
      <span class="mono" style="color:${T.darkAccent}">MIT</span>
    </div>
  </div>`,
});

/** Card 2 — the problem. */
CARD_LIST.push({
  name: 's2-problem',
  html: `<div class="card">
    <div class="kicker">The problem</div>
    <h2>A drought is verifiable.<br>A claim is not.</h2>
    <div class="grid3">
      <div class="tile">
        <div class="tile__n">01</div>
        <div class="tile__t">Proof costs more than the plot</div>
        <div class="tile__b">An assessor has to visit, measure and sign off on land whose whole season is worth less than the visit.</div>
      </div>
      <div class="tile">
        <div class="tile__n">02</div>
        <div class="tile__t">Payouts arrive after the loss</div>
        <div class="tile__b">A farmer needs seed money at planting, not a settlement months after the harvest they never got.</div>
      </div>
      <div class="tile">
        <div class="tile__n">03</div>
        <div class="tile__t">Discretion is a risk in itself</div>
        <div class="tile__b">When payment depends on a judgement call, the farmer carries the uncertainty about whether it goes their way.</div>
      </div>
    </div>
  </div>`,
});

/** Card 3 — the mechanism, as an architecture diagram. */
CARD_LIST.push({
  name: 's3-architecture',
  html: `<div class="card" style="justify-content:center">
    <div class="kicker">The mechanism</div>
    <h2>Cover written against an index, paid by code</h2>
    <div class="flow">
      <div class="node"><div class="node__t">Farmer</div><div class="node__s">Buys cover for one plot and one season</div></div>
      <div class="arrow">→</div>
      <div class="node"><div class="node__t">Policy Registry</div><div class="node__s">Escrows the premium and holds the terms</div></div>
      <div class="arrow">→</div>
      <div class="node node--accent"><div class="node__t">Payout Engine</div><div class="node__s">Re-derives the decision on chain, every time</div></div>
      <div class="arrow">→</div>
      <div class="node"><div class="node__t">Premium Pool</div><div class="node__s">Holds the capital that pays claims</div></div>
    </div>
    <div class="under">
      <div class="up">premium paid once</div><div></div>
      <div class="up">liability registered</div><div></div>
      <div class="up">index compared to the window</div><div></div>
      <div class="up">payout released</div>
    </div>
    <div class="oracle-row">
      <div class="oracle">
        <div class="oracle__t">Oracle Adapter · 2 of 3 signers ↑</div>
        <div class="oracle__s">Three signers publish the region's index; two must agree before a reading counts.</div>
      </div>
    </div>
    <p class="lede" style="margin-top:34px;font-size:23px">
      When the index breaches the threshold inside the cover window, the engine pays. Nothing has to be approved by a person.
    </p>
  </div>`,
});

// ---------------------------------------------------------------- console card
{
  const S = 1; // the shot is 1280 css px wide, so 1:1 keeps it pixel-exact
  const W = Math.round(800 * S);
  const left = 70;
  const top = 116;
  const imgTop = top + 48;
  CARD_LIST.push({
    name: 's4-console',
    html: `<div class="card" style="padding:0;justify-content:flex-start;background:linear-gradient(160deg,#eef1f5 0%,#f6f7f9 55%)">
      <div style="position:absolute;top:${top - 50}px;left:${left}px" class="kicker">Live console · Stellar testnet</div>
      <div class="browser" style="left:${left}px;top:${top}px;width:1280px">
        <div class="browser__bar">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span class="urlpill">frontend-eight-delta-o0pj7gck3j.vercel.app</span>
        </div>
        <img src="file://${OUT}/console-list.png" width="1280" height="${W}">
      </div>
      ${ring(boxes.searchForm, S, left, imgTop, 1)}
      ${ring(boxes.activeChip, S, left, imgTop, 2)}
      <div class="legend" style="position:absolute;left:1404px;top:${top + 96}px;width:470px">
        <div class="legend__row"><div class="legend__num">1</div><div>
          <div class="legend__t">Look up a book of cover</div>
          <div class="legend__b">By farmer address or by region. The API verifies the strkey checksum.</div></div></div>
        <div class="legend__row"><div class="legend__num">2</div><div>
          <div class="legend__t">A policy that is genuinely open</div>
          <div class="legend__b">Read from the registry on testnet — not seed data, and not a mock.</div></div></div>
      </div>
    </div>`,
  });
  console.log(`s4-console: shot ${1280}x${W} at (${left},${imgTop})`);
}

// ------------------------------------------------------------- detail zoom card
{
  const S = 1.32; // detail panel displayed at 1.32x
  const W = Math.round(617 * S);
  const H = Math.round(691 * S);
  const left = 1010;
  const top = Math.round((1080 - H) / 2);
  // The panel was captured at screen (597,154); map its contents into the card.
  const originX = left - 597 * S;
  const originY = top - 154 * S;
  CARD_LIST.push({
    name: 's5-detail',
    html: `<div class="card" style="padding:0">
      <div style="position:absolute;left:96px;top:150px;width:820px">
        <div class="kicker">What settlement would do</div>
        <h2 style="font-size:50px">The engine answers before anyone commits</h2>
        <div class="legend" style="margin-top:44px">
          <div class="legend__row"><div class="legend__num">1</div><div>
            <div class="legend__t">Terms, as bought</div>
            <div class="legend__b">Maize in Kaduna, cover open for a week, pays at an index of 300 or less.</div></div></div>
          <div class="legend__row"><div class="legend__num">2</div><div>
            <div class="legend__t">Paid — and it says why</div>
            <div class="legend__b">“The index breached the threshold inside the cover window”: a reading of 250, inside the window, read back from the contract.</div></div></div>
        </div>
      </div>
      <div class="shot" style="left:${left}px;top:${top}px;width:${W}px;height:${H}px;box-shadow:0 30px 70px rgba(22,32,44,.18);border:1px solid ${T.line};border-radius:14px">
        <img src="file://${OUT}/detail-panel@3x.png" width="${W}" height="${H}">
      </div>
      ${ring(boxes.thresholdField, S, originX, originY, 1)}
      ${ring(boxes.previewSection, S, originX, originY, 2)}
    </div>`,
  });
  console.log(`s5-detail: panel ${W}x${H} at (${left},${top})`);
}

/** Card 3b — the trust model, shown as the second half of the mechanism scene. */
CARD_LIST.push({
  name: 's3b-trust',
  html: `<div class="card">
    <div class="kicker">Why it can be trusted</div>
    <h2>Three parties, no single point of discretion</h2>
    <div class="grid3">
      <div class="tile">
        <div class="tile__n">Oracle</div>
        <div class="tile__t">2 of 3 signers</div>
        <div class="tile__b">Three independent signers report the same index. One approval only opens a pending reading; the second finalizes it. A single signer cannot move a reading.</div>
      </div>
      <div class="tile">
        <div class="tile__n">Settlement</div>
        <div class="tile__t">Anyone can push it</div>
        <div class="tile__b">The engine's settlement is permissionless — a keeper, a farmer or a stranger can trigger it. None of them can change its outcome.</div>
      </div>
      <div class="tile">
        <div class="tile__n">Refusal</div>
        <div class="tile__t">The contract says no</div>
        <div class="tile__b">A policy the index has not triggered is rejected on chain with its own error code, so an unpaid policy is a fact, not an opinion.</div>
      </div>
    </div>
  </div>`,
});

/** Card 6 — the checks, in a real transcript. */
CARD_LIST.push({
  name: 's6-tests',
  html: `<div class="card">
    <div class="kicker">Checked, not asserted</div>
    <h2 style="font-size:52px">Every claim here is a test that runs</h2>
    <div class="term">
      <div class="term__bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span style="margin-left:14px">AgriShield-Networks</span></div>
      <div class="term__body">
        <div class="term__line term__cmd">$ cargo test --workspace</div>
        <div class="term__line term__ok">test result: ok. 72 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out</div>
        <div class="term__line term__ok">test result: ok. 60 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out</div>
        <div class="term__line term__ok">test result: ok. 76 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out</div>
        <div class="term__line term__ok">test result: ok. 71 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out</div>
        <div class="term__line term__cmd">$ pnpm test</div>
        <div class="term__line term__hi">Test Files  5 passed (5)        <span class="term__note">backend</span>   Tests  88 passed (88)</div>
        <div class="term__line term__hi">Test Files  2 passed (2)        <span class="term__note">console</span>   Tests  28 passed (28)</div>
        <div class="term__line term__cmd">$ cargo test --workspace fee</div>
        <div class="term__line term__ok">test fees::a_submission_does_not_get_more_expensive_as_history_grows ... ok</div>
        <div class="term__line term__ok">test fees::settling_does_not_get_more_expensive_as_the_region_history_grows ... ok</div>
      </div>
    </div>
  </div>`,
});

/** Card 7 — the proof. */
{
  const short = (a) => `${a.slice(0, 22)}…${a.slice(-10)}`;
  const addrs = [
    ['Policy Registry', 'CDBHGAUHDNPATEWKI4QKVEDUFY4Z3KNM3U5Q24SN5O4WNWOCJDASQ6D6'],
    ['Payout Engine', 'CACW6OLOLGQZ6HK6F2CSAYJ4JFNEBSPDAYS7OVMYPXIBAYHGDLZTWSBB'],
    ['Premium Pool', 'CD6AE6HF3C666LV6VCMILITL5FQ5AAZUU6ID2PZTOIE3GTNBOHYTVGZG'],
    ['Oracle Adapter', 'CBAPAFWLOPF25VVUQOTIWUKM2EQF5B5PAFI2YZLMLK5QUVPMR3NK526S'],
  ];
  CARD_LIST.push({
    name: 's7-proof',
    html: `<div class="card card--dark">
      <div class="kicker">On chain, and verifiable</div>
      <h2 style="color:${T.darkInk}">Deployed, wired and settled on testnet</h2>
      <div style="display:grid;grid-template-columns:1.05fr .95fr;gap:56px;margin-top:52px">
        <div>
          ${addrs
            .map(
              ([n, a]) => `<div style="display:flex;justify-content:space-between;gap:20px;padding:15px 0;border-bottom:1px solid rgba(255,255,255,.1)">
              <span style="font-size:21px;color:${T.darkMuted}">${n}</span>
              <span class="mono addr" style="color:${T.darkAccent}">${short(a)}</span></div>`,
            )
            .join('')}
          <div style="margin-top:26px;font-size:19px;color:${T.darkMuted};line-height:1.5">
            Settlement paying a farmer:
            <span class="mono" style="color:${T.darkAccent}">3714eed8…caa0563</span><br>
            Each contract's wasm rebuilds byte-for-byte from this tree.
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:34px 26px;align-content:start">
          <div class="stat"><div><div class="stat__n">279</div><div class="stat__l">contract tests</div></div></div>
          <div class="stat"><div><div class="stat__n">88</div><div class="stat__l">backend tests</div></div></div>
          <div class="stat"><div><div class="stat__n">28</div><div class="stat__l">console tests</div></div></div>
          <div class="stat"><div><div class="stat__n">−92%</div><div class="stat__l">settlement CPU</div></div></div>
          <div class="stat"><div><div class="stat__n">−53%</div><div class="stat__l">oracle submission CPU</div></div></div>
          <div class="stat"><div><div class="stat__n">0</div><div class="stat__l">keys on the host</div></div></div>
        </div>
      </div>
    </div>`,
  });
}

/** Card 8 — why it matters. */
CARD_LIST.push({
  name: 's8-value',
  html: `<div class="card">
    <div class="kicker">Why it matters</div>
    <h2>Cheap to sell, and honest to hold</h2>
    <div class="grid3">
      <div class="tile">
        <div class="tile__n">Cost</div>
        <div class="tile__t">Small enough for small plots</div>
        <div class="tile__b">Settlement costs a fraction of what an assessment visit would. Cover can be priced for a single hectare rather than a single estate.</div>
      </div>
      <div class="tile">
        <div class="tile__n">Clarity</div>
        <div class="tile__t">The terms are the product</div>
        <div class="tile__b">A farmer can read the index, the threshold and the window before buying, and can check the outcome afterwards without asking anyone.</div>
      </div>
      <div class="tile">
        <div class="tile__n">Openness</div>
        <div class="tile__t">MIT, and meant to be extended</div>
        <div class="tile__b">New regions, crops and oracles are additions, not rewrites — the contracts, the API and the console are all in one repository.</div>
      </div>
    </div>
  </div>`,
});

/** Card 9 — close. */
CARD_LIST.push({
  name: 's9-close',
  html: `<div class="card card--dark" style="align-items:flex-start">
    <div class="kicker">Try it</div>
    <h2 style="font-size:58px;color:${T.darkInk}">The console is live, and the contracts are on testnet</h2>
    <div style="margin-top:52px;display:flex;flex-direction:column;gap:26px">
      <div>
        <div style="font-size:19px;color:${T.darkMuted};letter-spacing:.05em">CONSOLE</div>
        <div class="mono" style="font-size:27px;color:${T.darkAccent};margin-top:6px">frontend-eight-delta-o0pj7gck3j.vercel.app</div>
      </div>
      <div>
        <div style="font-size:19px;color:${T.darkMuted};letter-spacing:.05em">SOURCE</div>
        <div class="mono" style="font-size:27px;color:${T.darkAccent};margin-top:6px">github.com/AgroShield/AgriShield-Networks</div>
      </div>
    </div>
    <div style="margin-top:66px;font-size:26px;color:${T.darkInk}">AgriShield — drought cover that pays itself.</div>
  </div>`,
});

// ---------------------------------------------------------------------------
// Render, and assert every callout lands inside its card.
// ---------------------------------------------------------------------------
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

let bad = 0;
for (const card of CARD_LIST) {
  // Written to a file and navigated to, rather than setContent: a document whose
  // origin is about:blank is not allowed to load file:// subresources, so the
  // console shots would silently render as broken images.
  const file = `${CARDS}/${card.name}.html`;
  writeFileSync(
    file,
    `<html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${card.html}</body></html>`,
  );
  await page.goto(`file://${file}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(220);

  // Verify: rings and badges are inside the 1920x1080 frame.
  const problems = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.ring, .badge')) {
      const b = el.getBoundingClientRect();
      if (b.left < 0 || b.top < 0 || b.right > 1920 || b.bottom > 1080) {
        out.push(`${el.className} out of frame: ${JSON.stringify({ l: b.left, t: b.top, r: b.right, b: b.bottom })}`);
      }
    }
    const mustFit = ['.browser', '.shot', '.legend', 'h1', 'h2', '.lede', '.grid3', '.flow', '.under', '.oracle-row', '.oracle'];
    const seen = new Map();
    for (const sel of mustFit) {
      for (const el of document.querySelectorAll(sel)) {
        const b = el.getBoundingClientRect();
        if (b.right > 1920 || b.bottom > 1080 || b.left < 0 || b.top < 0) {
          out.push(`${sel} out of frame: ${JSON.stringify({ l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) })}`);
        }
      }
    }
    for (const el of document.querySelectorAll('img')) {
      if (el.naturalWidth === 0) out.push(`broken image: ${el.getAttribute('src')}`);
    }
    return out;
  });
  if (problems.length) {
    bad += problems.length;
    console.log(`!! ${card.name}`);
    for (const p of problems) console.log('   ', p);
  }

  const el = await page.$('.card');
  await el.screenshot({ path: `${CARDS}/${card.name}.png` });
  const b = await el.boundingBox();
  console.log(`ok ${card.name.padEnd(18)} ${Math.round(b.width)}x${Math.round(b.height)}`);

  // The poster doubles as the README thumbnail, so it also gets a web size.
  if (card.poster) {
    for (const [w, h, suffix] of [[1280, 720, '@1280']]) {
      execFileSync(
        'ffmpeg',
        ['-y', '-v', 'error', '-i', `${CARDS}/${card.name}.png`,
         '-vf', `scale=${w}:${h}:flags=lanczos`, '-q:v', '3',
         `${CARDS}/${card.name}${suffix}.jpg`],
      );
    }
    console.log('    poster jpg written');
  }
}

// Half-size copies for the edit. Still 1.2x the 1080p output, so a 1.05 zoom
// never upscales, but zoompan resamples a third of the pixels and runs about
// twice as fast — which is the difference between a 4 and a 9 minute render.
const small = `${ROOT}/cards-sm`;
mkdirSync(small, { recursive: true });
for (const card of CARD_LIST) {
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', `${CARDS}/${card.name}.png`,
    '-vf', 'scale=2304:1296:flags=lanczos', `${small}/${card.name}.png`,
  ]);
}
console.log(`\nwrote ${CARD_LIST.length} half-size card(s) to cards-sm/`);

writeFileSync(`${ROOT}/cards/index.json`, JSON.stringify(CARD_LIST.map((c) => c.name), null, 2));
console.log(bad === 0 ? '\nall cards within frame, no broken images' : `\n${bad} problems`);
await ctx.close();
await browser.close();
