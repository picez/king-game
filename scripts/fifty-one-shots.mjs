// ---------------------------------------------------------------------------
// 51 LOCAL board QA screenshots via headless Chrome + DevTools Protocol.
// (Same CDP-over-`ws` approach as preferans-shots.mjs — no Playwright dependency.)
//
//   node scripts/fifty-one-shots.mjs <url> <outDir>
//
// Drives the LOCAL 51 flow (1 human seat 0 + 3 bots) until the bots have opened
// public melds, then captures the table and checks two things per meld row:
//   • no HORIZONTAL OVERFLOW (scrollWidth > innerWidth) at 360/390, and
//   • no CARD OVERLAP inside .fiftyone-meld__cards (each card's left ≥ prev right).
// The human just draws then discards each turn so the bots reliably open melds.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const URL = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.shots/fifty-one';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9231;

const CONFIGS = [
  { tag: 'mobile-360', w: 360, h: 780 },
  { tag: 'mobile-390', w: 390, h: 844 },
];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchJson(path) {
  return new Promise((res, rej) => {
    get(`http://127.0.0.1:${PORT}${path}`, (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}
async function waitForDevtools(timeout = 8000) {
  const start = Date.now();
  for (;;) {
    try { return await fetchJson('/json/version'); }
    catch { if (Date.now() - start > timeout) throw new Error('chrome devtools not up'); await sleep(150); }
  }
}
class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); }
  open() {
    return new Promise((res) => {
      this.ws.on('open', res);
      this.ws.on('message', (m) => {
        const o = JSON.parse(m.toString());
        if (o.id && this.pending.has(o.id)) { this.pending.get(o.id)(o); this.pending.delete(o.id); }
      });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  }
}

const findings = [];
const CLICKSEL = (sel, i = 0) => `(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(e){e.click();return true}return false})()`;
const CLICK = (...texts) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>${JSON.stringify(texts)}.some(t=>x.textContent.trim().includes(t)));if(b){b.click();return true}return false})()`;

// One human action: draw from the deck at the draw step, else select a hand card and
// discard to end the turn (which lets the bots take their meld/open turns).
const HUMAN_STEP = `(()=>{
  const draw=[...document.querySelectorAll('.fiftyone-actions button')].find(b=>/Draw from deck|Взяти з колоди|Vom Stapel|اسحب/.test(b.textContent));
  if(draw && !draw.disabled){draw.click();return 'draw'}
  const hand=document.querySelector('.fiftyone-hand .card:not(:disabled)');
  if(hand){hand.click();
    const disc=document.querySelector('.fiftyone-discard-btn');
    if(disc && !disc.disabled){disc.click();return 'discard'}
  }
  const next=[...document.querySelectorAll('button')].find(x=>/Next round|Наступний раунд|Nächste Runde|الجولة/.test(x.textContent));
  if(next){next.click();return 'next'}
  return 'wait';
})()`;

// Per-meld overlap probe: for every .fiftyone-meld__cards, compare adjacent card rects.
const OVERLAP_PROBE = `JSON.stringify((()=>{
  const rows=[...document.querySelectorAll('.fiftyone-meld__cards')];
  let melds=0, maxCards=0, overlaps=0, clipped=0;
  for(const row of rows){
    const cards=[...row.children].filter(c=>c.classList.contains('card')||c.classList.contains('fiftyone-meldcard'));
    melds++; maxCards=Math.max(maxCards, cards.length);
    for(let i=1;i<cards.length;i++){
      const a=cards[i-1].getBoundingClientRect(), b=cards[i].getBoundingClientRect();
      if(b.left < a.right - 1) overlaps++;      // next card starts before prev ends → overlap
    }
    // a card wider than its visible slot inside the scroller is fine; clipping we flag
    // is when a card's own width collapsed below a readable minimum.
    for(const c of cards){ if(c.getBoundingClientRect().width < 20) clipped++; }
  }
  return { melds, maxCards, overlaps, clipped };
})())`;

async function shot(cdp, name, boardSel = '.fiftyone-screen') {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const m = JSON.parse(await cdp.evaluate(`JSON.stringify({
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    hasBoard: !!document.querySelector(${JSON.stringify(boardSel)})
  })`));
  const ov = JSON.parse(await cdp.evaluate(OVERLAP_PROBE));
  findings.push({ name, ...m, ...ov });
  console.log(`  ${name}: ${m.overflowX ? `OVERFLOW(${m.scrollW}>${m.innerW})` : 'ok'} · melds=${ov.melds} maxCards=${ov.maxCards} overlaps=${ov.overlaps} clipped=${ov.clipped}`);
}

async function pickLocal(cdp) {
  await cdp.evaluate(CLICKSEL('.tile', 0));                              // Play locally
  await sleep(500);
  await cdp.evaluate(CLICKSEL('.game-picker .select-menu__trigger'));
  await sleep(400);
  const opts = await cdp.evaluate(`JSON.stringify([...document.querySelectorAll('.select-menu__option')].map(o=>o.textContent.trim()))`);
  console.log(`  picker options: ${opts}`);
  // Match the 51 option by its game id on the option value, else by the 🀄 glyph / "51".
  const picked = await cdp.evaluate(`(()=>{
    const opts=[...document.querySelectorAll('.select-menu__option')];
    const o=opts.find(x=>x.getAttribute('data-value')==='fifty-one'||/🀄/.test(x.textContent)||/(^|\\D)51(\\D|$)/.test(x.textContent));
    if(o){o.click();return o.textContent.trim()} return null;
  })()`);
  console.log(`  picked option: ${picked}`);
  await sleep(300);
  await cdp.evaluate(CLICK('Start local game', 'Почати локальну гру', 'Lokales Spiel starten'));
  await sleep(600);
  const inSetup = await cdp.evaluate(`!!document.querySelector('.fiftyone-setup')`);
  console.log(`  reached 51 setup: ${inSetup}`);
  return inSetup;
}

async function run() {
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank',
  ]);
  try {
    await waitForDevtools();
    for (const cfg of CONFIGS) {
      const targets = await fetchJson('/json');
      const page = targets.find((t) => t.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: cfg.w, height: cfg.h, deviceScaleFactor: 2, mobile: true, screenWidth: cfg.w, screenHeight: cfg.h });
      console.log(`\n[${cfg.tag}  ${cfg.w}x${cfg.h}]`);

      await cdp.send('Page.navigate', { url: URL });
      await sleep(1200);
      await pickLocal(cdp);
      // FiftyOneSetup: default 4 players → Start.
      await cdp.evaluate(CLICKSEL('.fiftyone-setup__start'));
      await sleep(700);

      let captured = false;
      for (let i = 0; i < 260; i++) {
        const melds = await cdp.evaluate(`document.querySelectorAll('.fiftyone-meld').length`);
        if (melds >= 2 && !captured) { await shot(cdp, `${cfg.tag}-melds`); captured = true; }
        if (captured && await cdp.evaluate(`[...document.querySelectorAll('.fiftyone-meld__cards')].some(r=>r.children.length>=4)`)) {
          await shot(cdp, `${cfg.tag}-melds-long`); break;
        }
        await cdp.evaluate(HUMAN_STEP);
        await sleep(260);
      }
      if (!captured) { await shot(cdp, `${cfg.tag}-table-nomelds`); console.log('  ⚠️ no public melds appeared'); }
      cdp.ws.close();
    }
  } finally {
    chrome.kill();
  }

  const badOverflow = findings.filter((f) => f.overflowX);
  const badOverlap = findings.filter((f) => f.overlaps > 0);
  const badClip = findings.filter((f) => f.clipped > 0);
  console.log(`\n=== overflow: ${badOverflow.length ? 'FAIL ' + badOverflow.map((b) => b.name).join(',') : 'none'} · overlap: ${badOverlap.length ? 'FAIL ' + badOverlap.map((b) => b.name).join(',') : 'none'} · clipped: ${badClip.length ? 'FAIL ' + badClip.map((b) => b.name).join(',') : 'none'} ===`);
  process.exit(badOverflow.length || badOverlap.length || badClip.length ? 1 : 0);
}

run().catch((e) => { console.error('fifty-one-shots crashed:', e); process.exit(1); });
