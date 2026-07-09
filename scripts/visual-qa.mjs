// ---------------------------------------------------------------------------
// Focused visual-QA screenshots the other scripts don't cover (Stage 12.6):
//   • RTL (Arabic) — main menu, host sheet, and a Durak game table, to confirm
//     the UI mirrors but the SEAT geometry (bottom/left/top/right) does NOT.
//   • Reduced motion — a Durak table under prefers-reduced-motion: reduce, to
//     confirm nothing vanishes when animations are stilled.
// Reports horizontal overflow (scrollWidth > innerWidth) per capture.
//
//   node scripts/visual-qa.mjs <previewUrl> <outDir>
//
// Language is forced via localStorage BEFORE the app boots (key king.lang.v1),
// since the in-app language control is a custom SelectMenu, not a native <select>.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const URL = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.shots/visual-qa';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;
const VIEWPORTS = [{ w: 360, h: 800 }, { w: 390, h: 844 }];
const LANG_KEY = 'king.lang.v1';

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchJson = (p) => new Promise((res, rej) => get(`http://localhost:${PORT}${p}`, (r) => {
  let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)));
}).on('error', rej));
async function waitDt(t = 8000) { const s = Date.now(); for (;;) { try { return await fetchJson('/json/version'); } catch { if (Date.now() - s > t) throw new Error('no devtools'); await sleep(150); } } }

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
  const m = JSON.parse(await cdp.evaluate(`JSON.stringify({ overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, dir: document.documentElement.dir })`));
  findings.push({ name, ...m });
  console.log(`  ${name}: ${m.overflowX ? 'OVERFLOW' : 'ok'} (dir=${m.dir || 'ltr'})`);
}
const CLICK = (text) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().includes(${JSON.stringify(text)}));if(b){b.click();return true}return false})()`;
const CLICKSEL = (sel, i = 0) => `(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(e){e.click();return true}return false})()`;

// Drive a local Durak game to a played table (label-agnostic, works in any lang).
async function toDurakTable(cdp) {
  await cdp.evaluate(CLICKSEL('.tile', 0));                                   // Play locally
  await sleep(400);
  await cdp.evaluate(CLICKSEL('.game-picker .select-menu__trigger'));        // open game dropdown
  await sleep(250);
  await cdp.evaluate(`(()=>{const o=[...document.querySelectorAll('.select-menu__option')].find(x=>x.textContent.includes('Durak')||x.textContent.includes('دوراك')||x.textContent.includes('🃏'));if(o)o.click()})()`);
  await sleep(250);
  await cdp.evaluate(CLICKSEL('.sheet__cta') || '');                         // Start local game (primary CTA)
  await cdp.evaluate(`(()=>{const b=[...document.querySelectorAll('.sheet .btn--primary')][0];if(b)b.click()})()`);
  await sleep(450);
  await cdp.evaluate(`(()=>{const b=document.querySelector('.durak-setup .btn--primary')||[...document.querySelectorAll('.btn--primary')].pop();if(b)b.click()})()`); // Start
  await sleep(700);
}

async function run() {
  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank']);
  try {
    await waitDt();
    for (const vp of VIEWPORTS) {
      const page = (await fetchJson('/json')).find((t) => t.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true, screenWidth: vp.w, screenHeight: vp.h });
      const tag = `${vp.w}`;
      console.log(`\n[viewport ${vp.w}x${vp.h}]`);

      // ---- RTL (Arabic): force lang before boot, then walk menu → host → game ----
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem(${JSON.stringify(LANG_KEY)},'ar')}catch(e){}` });
      await cdp.send('Page.navigate', { url: URL });
      await sleep(900);
      await shot(cdp, `${tag}-ar-1-menu`);
      await cdp.evaluate(CLICKSEL('.tile', 1));                 // Host sheet
      await sleep(450);
      await shot(cdp, `${tag}-ar-2-host`);
      await cdp.evaluate(CLICK('') /* noop */);
      await cdp.evaluate(`(()=>{const b=[...document.querySelectorAll('.sheet .btn--ghost')].pop();if(b)b.click()})()`); // back
      await sleep(300);
      await toDurakTable(cdp);
      await shot(cdp, `${tag}-ar-3-durak-table`);              // seating must NOT be mirrored

      // ---- Reduced motion: still animations, confirm nothing disappears ----
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem(${JSON.stringify(LANG_KEY)},'en')}catch(e){}` });
      await cdp.send('Page.navigate', { url: URL });
      await sleep(900);
      await toDurakTable(cdp);
      const cards = await cdp.evaluate(`document.querySelectorAll('.durak-hand .card').length`);
      const seatGlow = await cdp.evaluate(`!!document.querySelector('.durak-seat--acting')`);
      console.log(`    reduced-motion: hand cards=${cards}, acting-seat present=${seatGlow}`);
      await shot(cdp, `${tag}-rm-durak-table`);
      await cdp.send('Emulation.setEmulatedMedia', { features: [] }); // reset

      cdp.ws.close();
    }
  } finally {
    chrome.kill();
  }
  const bad = findings.filter((f) => f.overflowX);
  console.log(`\n=== ${bad.length === 0 ? 'NO horizontal overflow' : `OVERFLOW on ${bad.length}: ${bad.map((b) => b.name).join(', ')}`} ===`);
  process.exit(0);
}
run().catch((e) => { console.error('visual-qa crashed:', e); process.exit(1); });
