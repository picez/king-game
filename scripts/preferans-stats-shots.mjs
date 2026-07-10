// ---------------------------------------------------------------------------
// Preferans stats/leaderboard panel QA screenshots (Stage 19.6) via headless
// Chrome + CDP. Opens Profile → My stats → Preferans and Profile → Leaderboard →
// Preferans at 360/390 and reports horizontal overflow. No server needed: the
// stats fetch degrades to a soft empty/error state (the point is the panel LAYOUT).
//
//   node scripts/preferans-stats-shots.mjs <clientUrl> <outDir>
// Requires a running `vite preview` at <clientUrl> (default http://localhost:4173/).
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const CLIENT = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.shots/preferans-stats';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9228;
const CONFIGS = [{ tag: 'mobile-360', w: 360, h: 780 }, { tag: 'mobile-390', w: 390, h: 844 }];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fetchJson(path) { return new Promise((res, rej) => get(`http://127.0.0.1:${PORT}${path}`, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej)); }
async function waitForDevtools(t = 8000) { const s = Date.now(); for (;;) { try { return await fetchJson('/json/version'); } catch { if (Date.now() - s > t) throw new Error('devtools'); await sleep(150); } } }

class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); }
  open() { return new Promise((res) => { this.ws.on('open', res); this.ws.on('message', (m) => { const o = JSON.parse(m.toString()); if (o.id && this.pending.has(o.id)) { this.pending.get(o.id)(o); this.pending.delete(o.id); } }); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; }
}

const findings = [];
async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const m = JSON.parse(await cdp.evaluate(`JSON.stringify({ overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth })`));
  findings.push({ name, ...m });
  console.log(`  ${name}: ${m.overflowX ? `OVERFLOW (${m.scrollW}>${m.innerW})` : 'ok'}`);
}
const CLICKSEL = (sel, i = 0) => `(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(e){e.click();return true}return false})()`;
const CLICKTXT = (...t) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>${JSON.stringify(t)}.some(s=>x.textContent.trim().includes(s)));if(b){b.click();return true}return false})()`;
// Click the last game sub-tab (Preferans is the 5th / last in the sub-toggle).
const CLICK_PREFERANS_SUBTAB = `(()=>{const tabs=[...document.querySelectorAll('.segmented--sub .segmented__tab')];const o=tabs.find(x=>/Preferans|Преферанс|بريفيرانس/.test(x.textContent))||tabs[tabs.length-1];if(o){o.click();return true}return false})()`;

async function run() {
  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank']);
  try {
    await waitForDevtools();
    for (const cfg of CONFIGS) {
      const targets = await fetchJson('/json');
      const page = targets.find((t) => t.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: cfg.w, height: cfg.h, deviceScaleFactor: 2, mobile: true, screenWidth: cfg.w, screenHeight: cfg.h });
      console.log(`\n[${cfg.tag}  ${cfg.w}x${cfg.h}]`);
      await cdp.send('Page.navigate', { url: CLIENT });
      await sleep(1200);
      // Open Profile (⚙️ tile, index 3), then the Stats tab, then Preferans sub-tab.
      await cdp.evaluate(CLICKSEL('.tile', 3));
      await sleep(500);
      await cdp.evaluate(CLICKTXT('My stats', 'Моя статистика', 'Statistiken', 'إحصائياتي'));
      await sleep(400);
      await cdp.evaluate(CLICK_PREFERANS_SUBTAB);
      await sleep(600);
      await shot(cdp, `${cfg.tag}-stats-preferans`);
      // Leaderboard tab → Preferans sub-tab.
      await cdp.evaluate(CLICKTXT('Leaderboard', 'Таблиця лідерів', 'Bestenliste', 'المتصدرين'));
      await sleep(400);
      await cdp.evaluate(CLICK_PREFERANS_SUBTAB);
      await sleep(600);
      await shot(cdp, `${cfg.tag}-leaderboard-preferans`);
      cdp.ws.close();
    }
  } finally { chrome.kill(); }
  const bad = findings.filter((f) => f.overflowX);
  console.log(`\n=== ${bad.length === 0 ? 'NO horizontal overflow on any capture' : `OVERFLOW on ${bad.length}: ${bad.map((b) => b.name).join(', ')}`} ===`);
  process.exit(0);
}
run().catch((e) => { console.error('preferans-stats-shots crashed:', e); process.exit(1); });
