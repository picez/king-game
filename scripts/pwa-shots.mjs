// ---------------------------------------------------------------------------
// PWA banner QA screenshots (Stage 21.0) via headless Chrome + CDP. The banners
// only appear on real browser events, so this dispatches synthetic ones:
//   • beforeinstallprompt → the install card (menu only)
//   • offline → the offline strip (menu + in a game, to prove it never covers the
//     top-left ✕ and the install card is suppressed during play)
// Captures at 360/390 and reports horizontal overflow.
//
//   node scripts/pwa-shots.mjs <url> <outDir>
// Requires a running `vite preview` (production build → the SW/PWA hook is active).
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const URL = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.shots/pwa';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9229;
const CONFIGS = [{ tag: 'mobile-360', w: 360, h: 780 }, { tag: 'mobile-390', w: 390, h: 844 }];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fetchJson(p) { return new Promise((res, rej) => get(`http://127.0.0.1:${PORT}${p}`, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej)); }
async function waitDev(t = 8000) { const s = Date.now(); for (;;) { try { return await fetchJson('/json/version'); } catch { if (Date.now() - s > t) throw new Error('devtools'); await sleep(150); } } }

class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.p = new Map(); }
  open() { return new Promise((res) => { this.ws.on('open', res); this.ws.on('message', (m) => { const o = JSON.parse(m.toString()); if (o.id && this.p.has(o.id)) { this.p.get(o.id)(o); this.p.delete(o.id); } }); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res) => { this.p.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; }
}

const findings = [];
async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const m = JSON.parse(await cdp.evaluate(`JSON.stringify({ overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, hasInstall: !!document.querySelector('.pwa-install'), hasOffline: !!document.querySelector('.pwa-banner--offline'), hasExit: !!document.querySelector('.preferans-exit') })`));
  findings.push({ name, ...m });
  console.log(`  ${name}: ${m.overflowX ? `OVERFLOW ${m.scrollW}>${m.innerW}` : 'ok'} (install:${m.hasInstall} offline:${m.hasOffline} exit:${m.hasExit})`);
}

const CLICKSEL = (sel, i = 0) => `(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(e){e.click();return true}return false})()`;
const CLICK = (...t) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>${JSON.stringify(t)}.some(s=>x.textContent.trim().includes(s)));if(b){b.click();return true}return false})()`;
const FIRE_INSTALL = `(()=>{const e=new Event('beforeinstallprompt');e.prompt=()=>Promise.resolve();e.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(e);return true})()`;
const FIRE_OFFLINE = `window.dispatchEvent(new Event('offline'))`;

async function run() {
  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank']);
  try {
    await waitDev();
    for (const cfg of CONFIGS) {
      const t = await fetchJson('/json'); const page = t.find((x) => x.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl); await cdp.open();
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: cfg.w, height: cfg.h, deviceScaleFactor: 2, mobile: true, screenWidth: cfg.w, screenHeight: cfg.h });
      console.log(`\n[${cfg.tag} ${cfg.w}x${cfg.h}]`);

      // Menu + install card.
      await cdp.send('Page.navigate', { url: URL }); await sleep(1200);
      await cdp.evaluate(FIRE_INSTALL); await sleep(300);
      await shot(cdp, `${cfg.tag}-1-install-menu`);

      // Menu + offline strip (fresh load to drop the install event).
      await cdp.send('Page.navigate', { url: URL }); await sleep(1000);
      await cdp.evaluate(FIRE_OFFLINE); await sleep(300);
      await shot(cdp, `${cfg.tag}-2-offline-menu`);

      // In a game: install card suppressed, offline pill must NOT cover the ✕.
      await cdp.send('Page.navigate', { url: URL }); await sleep(1000);
      await cdp.evaluate(CLICKSEL('.tile', 0));                                   // Play locally
      await sleep(400);
      await cdp.evaluate(CLICKSEL('.game-picker .select-menu__trigger')); await sleep(300);
      await cdp.evaluate(`(()=>{const o=[...document.querySelectorAll('.select-menu__option')].find(x=>x.textContent.includes('Preferans')||x.textContent.includes('🎩'));if(o){o.click();return true}return false})()`);
      await sleep(300);
      await cdp.evaluate(CLICK('Start local game', 'Почати локальну гру')); await sleep(500);
      await cdp.evaluate(CLICKSEL('.preferans-setup__start')); await sleep(700);
      await cdp.evaluate(FIRE_INSTALL);   // should be IGNORED (in game)
      await cdp.evaluate(FIRE_OFFLINE);
      await sleep(300);
      await shot(cdp, `${cfg.tag}-3-offline-ingame`);
      cdp.ws.close();
    }
  } finally { chrome.kill(); }
  const bad = findings.filter((f) => f.overflowX);
  const inGameInstall = findings.filter((f) => f.name.includes('ingame') && f.hasInstall);
  console.log(`\n=== ${bad.length === 0 ? 'NO horizontal overflow' : `OVERFLOW: ${bad.map((b) => b.name).join(', ')}`} ===`);
  console.log(inGameInstall.length === 0 ? '=== install card correctly suppressed in game ===' : `=== BUG: install shown in game: ${inGameInstall.map((b) => b.name).join(', ')} ===`);
  process.exit(0);
}
run().catch((e) => { console.error('pwa-shots crashed:', e); process.exit(1); });
