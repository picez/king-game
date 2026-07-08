// ---------------------------------------------------------------------------
// Online Tarneeb board QA screenshots (Stage 10.5) via headless Chrome + CDP.
// Spins up a REAL server (port 3001, fast bots) so the client's default WS URL
// (ws://localhost:3001/ws) connects; drives the HOST UI: create Tarneeb room →
// add 3 bots → start → bid/trump/play. Captures lobby + bidding + trump + playing
// at 360/390 and reports horizontal overflow.
//
//   node scripts/tarneeb-online-shots.mjs <clientUrl> <outDir>
//
// Requires a running `vite preview` at <clientUrl> (default http://localhost:4173/).
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import WebSocket from 'ws';

const CLIENT = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.shots/tarneeb-online';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9226;
const SRV_PORT = 3001;
const DATA = '.data-shots';

const CONFIGS = [
  { tag: 'mobile-360', w: 360, h: 780 },
  { tag: 'mobile-390', w: 390, h: 844 },
];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  return spawn('npx tsx server/index.ts', {
    shell: true,
    env: { ...process.env, PORT: String(SRV_PORT), ROOM_STORAGE_FILE: `${DATA}/rooms.json`, BOT_DELAY_MS: '250' },
    stdio: 'ignore',
  });
}
function killServer(child) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']).on('exit', () => resolve());
    else { child.kill('SIGTERM'); resolve(); }
  });
}
function waitForHealth(timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => get(`http://127.0.0.1:${SRV_PORT}/health`, (res) => { res.resume(); res.statusCode === 200 ? resolve() : retry(); }).on('error', retry);
    const retry = () => (Date.now() - start > timeoutMs ? reject(new Error('server not healthy')) : setTimeout(tick, 150));
    tick();
  });
}
function fetchJson(path) {
  return new Promise((res, rej) => get(`http://127.0.0.1:${CDP_PORT}${path}`, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
}
async function waitForDevtools(timeout = 8000) {
  const start = Date.now();
  for (;;) { try { return await fetchJson('/json/version'); } catch { if (Date.now() - start > timeout) throw new Error('chrome devtools not up'); await sleep(150); } }
}

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
const CLICK = (...texts) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>${JSON.stringify(texts)}.some(t=>x.textContent.trim().includes(t)));if(b){b.click();return true}return false})()`;
const HUMAN_STEP = `(()=>{
  const suit=document.querySelector('.tarneeb-suitbtn'); if(suit){suit.click();return 'trump'}
  const bids=[...document.querySelectorAll('.tarneeb-bidbtn')]; if(bids.length){bids[bids.length-1].click();return 'bid'}
  const pass=document.querySelector('.tarneeb-passbtn'); if(pass){pass.click();return 'pass'}
  const card=[...document.querySelectorAll('.tarneeb-hand .card')].find(c=>!c.disabled && !c.classList.contains('card--dimmed')); if(card){card.click();return 'play'}
  return 'wait';
})()`;

async function run() {
  rmSync(DATA, { recursive: true, force: true });
  const server = startServer();
  await waitForHealth();
  console.log('server up');
  const chrome = spawn(CHROME, [`--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank']);
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
      // Host online → pick Tarneeb → create.
      await cdp.evaluate(CLICKSEL('.tile', 1));            // Host online room
      await sleep(400);
      await cdp.evaluate(CLICKSEL('.game-picker .select-menu__trigger'));
      await sleep(300);
      await cdp.evaluate(`(()=>{const o=[...document.querySelectorAll('.select-menu__option')].find(x=>x.textContent.includes('Tarneeb')||x.textContent.includes('♠'));if(o){o.click();return true}return false})()`);
      await sleep(300);
      await cdp.evaluate(CLICK('Create room', 'Створити'));
      await sleep(800);
      // Lobby: add 3 bots, capture, then start.
      for (let i = 0; i < 3; i++) { await cdp.evaluate(CLICK('Add bot', 'Додати бота', '🤖')); await sleep(300); }
      await shot(cdp, `${cfg.tag}-0-lobby`);
      await cdp.evaluate(CLICK('Start game', 'Почати гру', 'Start'));
      await sleep(900);

      const grabbed = { bid: false, trump: false, play: false };
      for (let i = 0; i < 140; i++) {
        if (!grabbed.bid && await cdp.evaluate(`!!document.querySelector('.tarneeb-bidbar')`)) { await shot(cdp, `${cfg.tag}-1-bidding`); grabbed.bid = true; }
        if (!grabbed.trump && await cdp.evaluate(`!!document.querySelector('.tarneeb-trumpbar')`)) { await shot(cdp, `${cfg.tag}-2-trump`); grabbed.trump = true; }
        if (!grabbed.play && await cdp.evaluate(`!!document.querySelector('.tarneeb-play .card')`)) { await shot(cdp, `${cfg.tag}-3-playing`); grabbed.play = true; break; }
        await cdp.evaluate(HUMAN_STEP);
        await sleep(420);
      }
      const miss = Object.entries(grabbed).filter(([, v]) => !v).map(([k]) => k);
      if (miss.length) console.log(`  ⚠️ not captured: ${miss.join(', ')}`);
      cdp.ws.close();
    }
  } finally {
    chrome.kill();
    await killServer(server);
    rmSync(DATA, { recursive: true, force: true });
  }
  const bad = findings.filter((f) => f.overflowX);
  console.log(`\n=== ${bad.length === 0 ? 'NO horizontal overflow on any capture' : `OVERFLOW on ${bad.length}: ${bad.map((b) => b.name).join(', ')}`} ===`);
  process.exit(0);
}
run().catch((e) => { console.error('tarneeb-online-shots crashed:', e); process.exit(1); });
