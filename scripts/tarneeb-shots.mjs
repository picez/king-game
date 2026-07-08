// ---------------------------------------------------------------------------
// Tarneeb LOCAL board QA screenshots via headless Chrome + DevTools Protocol.
// (Same CDP-over-`ws` approach as deberc-shots.mjs — no Playwright dependency.)
//
//   node scripts/tarneeb-shots.mjs <url> <outDir>
//
// Drives the LOCAL Tarneeb flow (one human seat 0 + 3 bots) to visually verify:
//   #0 the Host sheet shows Tarneeb DISABLED ("online coming later")
//   #1 bidding, #2 trump choice, #3 trick play, #4 hand complete, #5 finished
// For each capture it reports horizontal overflow (scrollWidth > innerWidth).
// The human bids the MAX each auction so it reliably becomes declarer and the
// trump picker is exercised.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const URL = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.shots/tarneeb';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;

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
    hasBoard: !!document.querySelector('.tarneeb-board'),
  }))())`));
  findings.push({ name, ...metrics });
  console.log(`  ${name}: ${metrics.overflowX ? `OVERFLOW (scrollW ${metrics.scrollW} > ${metrics.innerW})` : 'ok'}`);
}

const CLICKSEL = (sel, i = 0) => `(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(e){e.click();return true}return false})()`;
const CLICK = (...texts) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>${JSON.stringify(texts)}.some(t=>x.textContent.trim().includes(t)));if(b){b.click();return true}return false})()`;

// One human action: pick trump if the picker is up, else win the auction by the
// max bid, else play the first legal card, else advance the hand.
const HUMAN_STEP = `(()=>{
  const suit=document.querySelector('.tarneeb-suitbtn'); if(suit){suit.click();return 'trump'}
  const bids=[...document.querySelectorAll('.tarneeb-bidbtn')];
  if(bids.length){ bids[bids.length-1].click(); return 'bid'; }
  const pass=document.querySelector('.tarneeb-passbtn'); if(pass){pass.click();return 'pass'}
  const card=[...document.querySelectorAll('.tarneeb-hand .card')].find(c=>!c.disabled && !c.classList.contains('card--dimmed'));
  if(card){card.click();return 'play'}
  const next=[...document.querySelectorAll('button')].find(x=>/Next hand|Наступна|Nächste|التالية/.test(x.textContent)); if(next){next.click();return 'next'}
  return 'wait';
})()`;

async function pickTarneebLocal(cdp) {
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

      // #0 (390 only) — the local picker lists Tarneeb; the HOST sheet disables it.
      if (cfg.w === 390) {
        await pickTarneebLocal(cdp);
        await shot(cdp, `${cfg.tag}-0a-local-picker`);
        // Close picker + local sheet, open Host, verify Tarneeb is disabled there.
        await cdp.evaluate(CLICK('Back to menu', 'Назад до меню', 'Zurück zum Menü'));
        await sleep(300);
        await cdp.evaluate(CLICKSEL('.tile', 1));                  // Host online
        await sleep(400);
        await cdp.evaluate(CLICKSEL('.game-picker .select-menu__trigger'));
        await sleep(300);
        await shot(cdp, `${cfg.tag}-0b-host-picker-tarneeb-disabled`);
        await cdp.send('Page.navigate', { url: URL });
        await sleep(1000);
      }

      // Enter local Tarneeb.
      await pickTarneebLocal(cdp);
      await cdp.evaluate(`(()=>{const o=[...document.querySelectorAll('.select-menu__option')].find(x=>x.textContent.includes('Tarneeb')||x.textContent.includes('Тарніб')||x.textContent.includes('طرنيب')||x.textContent.includes('♠'));if(o){o.click();return true}return false})()`);
      await sleep(300);
      await cdp.evaluate(CLICK('Start local game', 'Почати локальну гру', 'Lokales Spiel starten'));
      await sleep(500);
      // TarneebSetup → Start.
      await cdp.evaluate(CLICKSEL('.tarneeb-setup__start'));
      await sleep(700);

      const grabbed = { bid: false, trump: false, play: false, done: false, fin: false };
      for (let i = 0; i < 160; i++) {
        // Capture phase snapshots opportunistically BEFORE stepping.
        if (!grabbed.bid && await cdp.evaluate(`!!document.querySelector('.tarneeb-bidbar')`)) { await shot(cdp, `${cfg.tag}-1-bidding`); grabbed.bid = true; }
        if (!grabbed.trump && await cdp.evaluate(`!!document.querySelector('.tarneeb-trumpbar')`)) { await shot(cdp, `${cfg.tag}-2-trump`); grabbed.trump = true; }
        if (!grabbed.play && await cdp.evaluate(`!!document.querySelector('.tarneeb-play .card')`)) { await shot(cdp, `${cfg.tag}-3-playing`); grabbed.play = true; }
        if (!grabbed.done && await cdp.evaluate(`!!document.querySelector('.tarneeb-handdone')`)) { await shot(cdp, `${cfg.tag}-4-handcomplete`); grabbed.done = true; }
        if (!grabbed.fin && await cdp.evaluate(`!!document.querySelector('.tarneeb-finished')`)) { await shot(cdp, `${cfg.tag}-5-finished`); grabbed.fin = true; break; }
        await cdp.evaluate(HUMAN_STEP);
        await sleep(420);
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

run().catch((e) => { console.error('tarneeb-shots crashed:', e); process.exit(1); });
