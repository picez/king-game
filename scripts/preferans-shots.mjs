// ---------------------------------------------------------------------------
// Preferans LOCAL board QA screenshots via headless Chrome + DevTools Protocol.
// (Same CDP-over-`ws` approach as tarneeb-shots.mjs — no Playwright dependency.)
//
//   node scripts/preferans-shots.mjs <url> <outDir>
//
// Drives the LOCAL Preferans flow (one human seat 0 + 2 bots) to visually verify:
//   #0 the Local picker offers Preferans (experimental); the Host sheet disables it
//   #1 setup, #2 bidding, #3 talon/discard, #4 trick play, #5 hand complete, #6 finished
// For each capture it reports horizontal overflow (scrollWidth > innerWidth).
// The human bids the MAX each auction so it reliably becomes declarer and the
// talon → discard → declare UIs are exercised.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const URL = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.shots/preferans';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9226;

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

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const metrics = JSON.parse(await cdp.evaluate(`JSON.stringify((()=>({
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    hasBoard: !!document.querySelector('.preferans-board'),
  }))())`));
  findings.push({ name, ...metrics });
  console.log(`  ${name}: ${metrics.overflowX ? `OVERFLOW (scrollW ${metrics.scrollW} > ${metrics.innerW})` : 'ok'}`);
}

const CLICKSEL = (sel, i = 0) => `(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(e){e.click();return true}return false})()`;
const CLICK = (...texts) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>${JSON.stringify(texts)}.some(t=>x.textContent.trim().includes(t)));if(b){b.click();return true}return false})()`;

// One human action, in priority order: take the talon, bury 2 (select then confirm),
// declare the minimum, win the auction with the MAX bid, play the first legal card,
// else advance the hand.
const HUMAN_STEP = `(()=>{
  const take=document.querySelector('.preferans-talonbar .btn--primary'); if(take){take.click();return 'take'}
  if(document.querySelector('.preferans-discardbar')){
    const confirm=document.querySelector('.preferans-discardbar .btn--primary');
    if(confirm && !confirm.disabled){confirm.click();return 'discard'}
    const card=[...document.querySelectorAll('.preferans-hand .card')].find(c=>!c.classList.contains('card--selected'));
    if(card){card.click();return 'pick'}
  }
  const decl=[...document.querySelectorAll('.preferans-declarebar .preferans-ladder__cell')].filter(c=>!c.disabled);
  if(decl.length){decl[0].click();return 'declare'}
  const bids=[...document.querySelectorAll('.preferans-bidbar .preferans-ladder__cell')].filter(c=>!c.disabled);
  if(bids.length){bids[bids.length-1].click();return 'bid'}
  const play=[...document.querySelectorAll('.preferans-hand .card')].find(c=>!c.disabled && !c.classList.contains('card--dimmed'));
  if(play){play.click();return 'play'}
  const next=[...document.querySelectorAll('button')].find(x=>/Next hand|Наступна|Nächste|التالية/.test(x.textContent)); if(next){next.click();return 'next'}
  return 'wait';
})()`;

async function pickPreferansLocal(cdp) {
  await cdp.evaluate(CLICKSEL('.tile', 0));                       // Play locally
  await sleep(400);
  await cdp.evaluate(CLICKSEL('.game-picker .select-menu__trigger'));
  await sleep(300);
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

      // #0 (390 only) — the local picker lists Preferans; the HOST sheet disables it.
      if (cfg.w === 390) {
        await pickPreferansLocal(cdp);
        await shot(cdp, `${cfg.tag}-0a-local-picker`);
        await cdp.evaluate(CLICK('Back to menu', 'Назад до меню', 'Zurück zum Menü'));
        await sleep(300);
        await cdp.evaluate(CLICKSEL('.tile', 1));                  // Host online
        await sleep(400);
        await cdp.evaluate(CLICKSEL('.game-picker .select-menu__trigger'));
        await sleep(300);
        await shot(cdp, `${cfg.tag}-0b-host-picker-preferans-disabled`);
        await cdp.send('Page.navigate', { url: URL });
        await sleep(1000);
      }

      // Enter local Preferans.
      await pickPreferansLocal(cdp);
      await cdp.evaluate(`(()=>{const o=[...document.querySelectorAll('.select-menu__option')].find(x=>x.textContent.includes('Preferans')||x.textContent.includes('Преферанс')||x.textContent.includes('بريفيرانس')||x.textContent.includes('🎩'));if(o){o.click();return true}return false})()`);
      await sleep(300);
      await cdp.evaluate(CLICK('Start local game', 'Почати локальну гру', 'Lokales Spiel starten'));
      await sleep(500);
      // PreferansSetup snapshot → Start.
      await shot(cdp, `${cfg.tag}-1-setup`);
      await cdp.evaluate(CLICKSEL('.preferans-setup__start'));
      await sleep(700);

      const grabbed = { bid: false, talon: false, play: false, done: false, fin: false };
      for (let i = 0; i < 220; i++) {
        if (!grabbed.bid && await cdp.evaluate(`!!document.querySelector('.preferans-bidbar')`)) { await shot(cdp, `${cfg.tag}-2-bidding`); grabbed.bid = true; }
        if (!grabbed.talon && await cdp.evaluate(`!!document.querySelector('.preferans-talonbar, .preferans-discardbar, .preferans-declarebar')`)) { await shot(cdp, `${cfg.tag}-3-talon`); grabbed.talon = true; }
        if (!grabbed.play && await cdp.evaluate(`!!document.querySelector('.preferans-play .card')`)) { await shot(cdp, `${cfg.tag}-4-playing`); grabbed.play = true; }
        if (!grabbed.done && await cdp.evaluate(`!!document.querySelector('.preferans-handdone')`)) { await shot(cdp, `${cfg.tag}-5-handcomplete`); grabbed.done = true; }
        if (!grabbed.fin && await cdp.evaluate(`!!document.querySelector('.preferans-finished')`)) { await shot(cdp, `${cfg.tag}-6-finished`); grabbed.fin = true; break; }
        await cdp.evaluate(HUMAN_STEP);
        await sleep(360);
      }
      const miss = Object.entries(grabbed).filter(([, v]) => !v).map(([k]) => k);
      if (miss.length) console.log(`  ⚠️ phases not captured: ${miss.join(', ')}`);

      cdp.ws.close();
    }
  } finally {
    chrome.kill();
  }

  const bad = findings.filter((f) => f.overflowX);
  console.log(`\n=== ${bad.length === 0 ? 'NO horizontal overflow on any capture' : `OVERFLOW on ${bad.length} capture(s): ${bad.map((b) => b.name).join(', ')}`} ===`);
  process.exit(0);
}

run().catch((e) => { console.error('preferans-shots crashed:', e); process.exit(1); });
