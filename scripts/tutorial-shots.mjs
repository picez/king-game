// One-off visual smoke for the Tutorials MVP (Stage 31.1). Headless Chrome via CDP.
// Captures the hub + a 51 step + a Durak step at 360/390 and asserts NO horizontal
// page overflow. node scripts-scratch/tutorial-shots.mjs <url> <outDir>
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const URL = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.shots/tutorial';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9233;
const CONFIGS = [{ tag: '360', w: 360, h: 780 }, { tag: '390', w: 390, h: 844 }];
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchJson = (path) => new Promise((res, rej) => { get(`http://127.0.0.1:${PORT}${path}`, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej); });
async function waitDT(t = 15000) { const s = Date.now(); for (;;) { try { return await fetchJson('/json/version'); } catch { if (Date.now() - s > t) throw new Error('no devtools'); await sleep(200); } } }
class CDP {
  constructor(u) { this.ws = new WebSocket(u); this.id = 0; this.p = new Map(); }
  open() { return new Promise((res) => { this.ws.on('open', res); this.ws.on('message', (m) => { const o = JSON.parse(m.toString()); if (o.id && this.p.has(o.id)) { this.p.get(o.id)(o.result); this.p.delete(o.id); } }); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res) => { this.p.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.value; }
}
const clickText = (txt) => `(() => { const els = [...document.querySelectorAll('button')]; const el = els.find(e => e.textContent.includes(${JSON.stringify(txt)})); if (el) { el.click(); return true; } return false; })()`;
const clickRowStart = (name) => `(() => { const li = [...document.querySelectorAll('.tutorial-row')].find(r => r.textContent.includes(${JSON.stringify(name)})); if (!li) return false; const b = li.querySelector('button'); if (b) { b.click(); return true; } return false; })()`;
const overflow = `(document.documentElement.scrollWidth - window.innerWidth)`;

import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
const PROFILE = pjoin(tmpdir(), `tut-shots-${PORT}`);
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let fails = 0;
try {
  await waitDT();
  for (const cfg of CONFIGS) {
    const targets = await fetchJson('/json');
    const page = targets.find((t) => t.type === 'page');
    const cdp = new CDP(page.webSocketDebuggerUrl); await cdp.open();
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: cfg.w, height: cfg.h, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: URL }); await sleep(1500);
    const shot = async (name) => { const r = await cdp.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${cfg.tag}-${name}.png`, Buffer.from(r.data, 'base64')); const ov = await cdp.eval(overflow); console.log(`${cfg.tag} ${name}: overflow=${ov}px`); if (ov > 1) { console.error(`  ✗ HORIZONTAL OVERFLOW ${ov}px`); fails++; } };
    await cdp.eval(clickText('Tutorials')) || console.warn('no Tutorials tile'); await sleep(500);
    await shot('hub');
    // One representative step per game: open its tutorial, capture step 1 + a mid step, then back.
    const GAMES = [['King', 'king'], ['Durak', 'durak'], ['Deberc', 'deberc'], ['Tarneeb', 'tarneeb'], ['Preferans', 'preferans'], ['51', 'fifty-one']];
    for (const [name, key] of GAMES) {
      const opened = await cdp.eval(clickRowStart(name)); await sleep(500);
      if (!opened) { console.warn(`could not open ${name}`); continue; }
      await shot(`${key}-step1`);
      await cdp.eval(clickText('Next')); await cdp.eval(clickText('Next')); await sleep(350);
      await shot(`${key}-mid`);
      await cdp.eval(clickText('Skip')); await sleep(350); // back to the hub
    }
    cdp.ws.close();
  }
} finally { chrome.kill(); }
console.log(fails === 0 ? 'VISUAL SMOKE PASS ✅ (no horizontal overflow)' : `VISUAL SMOKE: ${fails} overflow failure(s)`);
process.exit(fails === 0 ? 0 : 1);
