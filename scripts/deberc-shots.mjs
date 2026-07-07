// ---------------------------------------------------------------------------
// Deberc board QA screenshots via headless Chrome + DevTools Protocol.
// (Same CDP-over-`ws` approach as mobile-shots.mjs — no Playwright dependency.)
//
//   node scripts/deberc-shots.mjs <url> <outDir>
//
// Drives the LOCAL Deberc flow (one human seat 0 + bots) on the given URL — used
// against the live Render deploy — to visually verify:
//   #1 the first-dealer suit-draw intro (`.deberc-firstdealer`)
//   #2 the un-skewed board (`.deberc-screen` 3-col grid) in 3p and 4p
// For each capture it reports horizontal overflow (scrollWidth > innerWidth).
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = process.argv[3] || '.shots/deberc';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;

// (label, seat count, viewport). A wide 4p run surfaces any side-seat overlap.
const CONFIGS = [
  { tag: '3p-mobile', n: 3, w: 390, h: 844 },
  { tag: '4p-mobile', n: 4, w: 390, h: 844 },
  { tag: '4p-wide', n: 4, w: 820, h: 900 },
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
  const metrics = JSON.parse(await cdp.evaluate(`JSON.stringify((()=>{
    const board = document.querySelector('.deberc-screen');
    const hand = document.querySelector('.durak-hand');
    const bcr = (el)=> el ? (r=>({l:Math.round(r.left),r:Math.round(r.right),t:Math.round(r.top),b:Math.round(r.bottom)}))(el.getBoundingClientRect()) : null;
    return {
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      phase: (document.querySelector('.deberc-firstdealer')?'intro':(document.querySelector('.deberc-declare')?'declaring':(document.querySelector('.durak-hand .card:not(.card--dimmed)')?'playing':'other'))),
      board: bcr(board), hand: bcr(hand),
    };
  })())`));
  findings.push({ name, ...metrics });
  const geo = metrics.board ? ` board[${metrics.board.l}..${metrics.board.r}] hand[${metrics.hand?.l}..${metrics.hand?.r}]` : '';
  console.log(`  ${name}: ${metrics.overflowX ? `OVERFLOW (scrollW ${metrics.scrollW} > ${metrics.innerW})` : 'ok'} phase=${metrics.phase}${geo}`);
}

// Click the first <button> whose text includes ANY of the candidate strings.
const CLICK = (...texts) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>${JSON.stringify(texts)}.some(t=>x.textContent.trim().includes(t)));if(b){b.click();return true}return false})()`;
const CLICKSEL = (sel, i = 0) => `(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(e){e.click();return true}return false})()`;
// One human step: pass any bid, skip any declaration, else play the first legal card.
const HUMAN_STEP = `(()=>{
  const byText=(ts)=>[...document.querySelectorAll('button')].find(x=>ts.some(t=>x.textContent.trim().includes(t)));
  const pass=byText(['Pass','Пас']); if(pass && !pass.disabled){pass.click();return 'bidPass'}
  const skip=byText(['Skip','Пропустити']); if(skip && !skip.disabled){skip.click();return 'declareSkip'}
  const card=document.querySelector('.durak-hand .card:not(.card--dimmed)'); if(card){card.click();return 'play'}
  return 'wait';
})()`;

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
        { width: cfg.w, height: cfg.h, deviceScaleFactor: 2, mobile: cfg.w < 500, screenWidth: cfg.w, screenHeight: cfg.h });
      console.log(`\n[${cfg.tag}  ${cfg.w}x${cfg.h}]`);

      await cdp.send('Page.navigate', { url: URL });
      await sleep(1200);

      // Play locally (tile 0) → pick Deberc in the game dropdown → start local.
      await cdp.evaluate(CLICKSEL('.tile', 0));
      await sleep(500);
      await cdp.evaluate(CLICKSEL('.game-picker .select-menu__trigger'));
      await sleep(300);
      await cdp.evaluate(`(()=>{const o=[...document.querySelectorAll('.select-menu__option')].find(x=>x.textContent.includes('Deberc')||x.textContent.includes('Деберц')||x.textContent.includes('🎴'));if(o){o.click();return true}return false})()`);
      await sleep(300);
      await cdp.evaluate(CLICK('Start local game', 'Почати локальну гру'));
      await sleep(600);

      // DebercSetup: pick seat count, then Start.
      await cdp.evaluate(`(()=>{const t=[...document.querySelectorAll('.durak-setup .segmented__tab')].find(x=>x.textContent.trim()===${JSON.stringify(String(cfg.n))});if(t)t.click()})()`);
      await sleep(250);
      await cdp.evaluate(CLICKSEL('.durak-setup__start'));
      await sleep(900);

      // #1 — first-dealer suit-draw intro (auto-hides ~6.5s; capture immediately).
      const hasIntro = await cdp.evaluate(`!!document.querySelector('.deberc-firstdealer')`);
      if (!hasIntro) console.log('  ⚠️ first-dealer intro NOT found');
      await shot(cdp, `${cfg.tag}-1-firstdealer`);

      // Dismiss intro, then drive the human seat until trick play is on the board.
      await cdp.evaluate(CLICK('Got it', 'Зрозуміло'));
      await sleep(400);

      let captured = false;
      for (let i = 0; i < 40; i++) {
        const act = await cdp.evaluate(HUMAN_STEP);
        await sleep(cfg.w < 500 ? 380 : 320);
        // Once cards are actually on the table (a trick in progress), grab the board.
        const inPlay = await cdp.evaluate(`!!document.querySelector('.deberc-screen .durak-table__cards .card')`);
        if (inPlay && !captured) { await shot(cdp, `${cfg.tag}-2-board`); captured = true; }
        if (captured && i % 6 === 5) await shot(cdp, `${cfg.tag}-3-board-later`);
      }
      if (!captured) { console.log('  ⚠️ never reached trick play; capturing whatever is on screen'); await shot(cdp, `${cfg.tag}-2-board`); }

      cdp.ws.close();
    }
  } finally {
    chrome.kill();
  }

  const bad = findings.filter((f) => f.overflowX);
  console.log(`\n=== ${bad.length === 0 ? 'NO horizontal overflow on any capture' : `OVERFLOW on ${bad.length} capture(s): ${bad.map((b) => b.name).join(', ')}`} ===`);
  process.exit(0);
}

run().catch((e) => { console.error('deberc-shots crashed:', e); process.exit(1); });
