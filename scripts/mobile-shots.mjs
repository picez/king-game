// ---------------------------------------------------------------------------
// Mobile regression screenshots via headless Chrome + DevTools Protocol.
// (No Playwright dependency — drives Chrome over CDP using the `ws` package.)
//
//   node scripts/mobile-shots.mjs <previewUrl> <outDir>
//
// For each viewport it walks the local-game flow, captures PNGs, and reports
// horizontal overflow (scrollWidth > innerWidth) per screen.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = process.argv[3] || '.shots';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const VIEWPORTS = [{ w: 360, h: 800 }, { w: 390, h: 844 }];

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

// Minimal CDP client
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
  const metrics = await cdp.evaluate(`JSON.stringify({
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  })`);
  const m = JSON.parse(metrics);
  findings.push({ name, ...m });
  console.log(`  ${name}: ${m.overflowX ? `OVERFLOW (scrollW ${m.scrollW} > ${m.innerW})` : 'ok'}`);
}

const CLICK = (text) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().includes(${JSON.stringify(text)}));if(b){b.click();return true}return false})()`;

async function run() {
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank',
  ]);
  try {
    await waitForDevtools();
    for (const vp of VIEWPORTS) {
      const targets = await fetchJson('/json');
      const page = targets.find((t) => t.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true, screenWidth: vp.w, screenHeight: vp.h });
      const tag = `${vp.w}x${vp.h}`;
      console.log(`\n[viewport ${tag}]`);

      await cdp.send('Page.navigate', { url: URL });
      await sleep(900);
      await shot(cdp, `${tag}-1-startmenu`);

      // Switch to Arabic (RTL) for a menu screenshot, then back to English so the
      // text-based click driver can continue through the gameplay flow.
      await cdp.evaluate(`(()=>{const s=document.querySelector('.lang-select');if(s){s.value='ar';s.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
      await sleep(400);
      await shot(cdp, `${tag}-1b-startmenu-ar`);
      await cdp.evaluate(`(()=>{const s=document.querySelector('.lang-select');if(s){s.value='en';s.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
      await sleep(300);

      // Profile/Statistics segmented menu (Stage 7) — open, capture the My stats
      // + Leaderboard segments (soft empty state without a DB), then collapse.
      await cdp.evaluate(CLICK('Statistics'));   // toggle includes "Statistics"
      await sleep(600);
      await cdp.evaluate(CLICK('My King stats')); // stats segment
      await sleep(700);
      await shot(cdp, `${tag}-1c-stats`);
      await cdp.evaluate(CLICK('Leaderboard'));
      await sleep(600);
      await shot(cdp, `${tag}-1d-leaderboard`);
      await cdp.evaluate(CLICK('Statistics'));   // collapse
      await sleep(200);

      // Join pane (room list + manual code + password)
      await cdp.evaluate(CLICK('Join online room'));
      await sleep(700);
      await shot(cdp, `${tag}-2-join`);

      // Back → Local game → setup
      await cdp.evaluate(CLICK('Back'));
      await sleep(200);
      await cdp.evaluate(CLICK('Local game'));
      await sleep(400);
      await shot(cdp, `${tag}-3-setup`);

      // 3 players (so kitty exchange exists), then start
      await cdp.evaluate(CLICK('3 Players'));
      await sleep(200);
      await cdp.evaluate(CLICK('Start Game'));
      await sleep(500);
      // Dismiss the dealer's PassScreen → ModeSelection (with dealer hand)
      await cdp.evaluate(CLICK('show my hand'));
      await sleep(500);
      await shot(cdp, `${tag}-4-modeselect`);

      // Pick Trump → dealer takes kitty → KittyExchange
      await cdp.evaluate(CLICK('Trump'));
      await sleep(500);
      await shot(cdp, `${tag}-5-kitty`);

      // Discard 2 cards → select trump → play
      await cdp.evaluate(`(()=>{const c=[...document.querySelectorAll('.player-hand .card:not(.card--dimmed)')];c[0]&&c[0].click();})()`);
      await sleep(150);
      await cdp.evaluate(`(()=>{const c=[...document.querySelectorAll('.player-hand .card:not(.card--dimmed):not(.card--selected)')];c[0]&&c[0].click();})()`);
      await sleep(150);
      await cdp.evaluate(CLICK('Discard'));
      await sleep(450);
      await cdp.evaluate(CLICK('No Trump'));
      await sleep(450);
      await cdp.evaluate(CLICK('show my hand')); // PassScreen → leader's GameScreen
      await sleep(500);
      await shot(cdp, `${tag}-6-game`);

      // Open the "My tricks" private panel
      await cdp.evaluate(CLICK('My tricks'));
      await sleep(300);
      await shot(cdp, `${tag}-7-mytricks`);
      await cdp.evaluate(CLICK('Hide my tricks'));
      await sleep(150);

      // Play one full trick (3 plays) to surface the trick toast
      for (let i = 0; i < 3; i++) {
        await cdp.evaluate(`(()=>{const c=[...document.querySelectorAll('.player-hand .card:not(.card--dimmed)')];c[0]&&c[0].click();})()`);
        await sleep(250);
        await cdp.evaluate(CLICK('show my hand')); // dismiss pass if a different human is next
        await sleep(200);
      }
      await sleep(150);
      await shot(cdp, `${tag}-8-tricktoast`);

      cdp.ws.close();
    }
  } finally {
    chrome.kill();
  }

  const bad = findings.filter((f) => f.overflowX);
  console.log(`\n=== ${bad.length === 0 ? 'NO horizontal overflow' : `OVERFLOW on ${bad.length} screen(s)`} ===`);
  process.exit(0);
}

run().catch((e) => { console.error('shots crashed:', e); process.exit(1); });
