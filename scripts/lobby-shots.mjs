// ---------------------------------------------------------------------------
// Lobby + room-browser visual-QA harness (Stage 12.4). Seeds a MIX of online
// rooms over WS (open / locked / full / in-game across all 4 games), then drives
// one browser to capture the Join room browser and a couple of lobbies at
// 360×800 and 390×844 (+ an RTL Arabic smoke). Reports overflow + key selectors.
//
//   npm run preview                     # serve the built client on :4173 (one shell)
//   node scripts/lobby-shots.mjs [previewUrl] [outDir]
//
// Manual QA (starts a real server + browser) — NOT part of `npm run verify`.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import WebSocket from 'ws';

const PREVIEW = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.shots/lobby';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEVTOOLS_PORT = 9226;
const SERVER_PORT = 3001;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}/ws`;
const DATA = '.data-lobby';
const LANG_KEY = 'king.lang.v1';
const VIEWPORTS = [{ w: 360, h: 800 }, { w: 390, h: 844 }];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Server ───────────────────────────────────────────────────────────────────
function startServer() {
  return spawn('npx tsx server/index.ts', {
    shell: true,
    env: { ...process.env, PORT: String(SERVER_PORT), ROOM_STORAGE_FILE: `${DATA}/rooms.json`, BOT_DELAY_MS: '60' },
    stdio: 'ignore',
  });
}
function killServer(child) {
  return new Promise((resolve) => {
    if (!child) return resolve();
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']).on('exit', () => resolve());
    else { child.kill('SIGTERM'); resolve(); }
  });
}
function waitForHealth(timeoutMs = 12000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => get(`http://127.0.0.1:${SERVER_PORT}/health`, (res) => { res.resume(); res.statusCode === 200 ? resolve() : retry(); }).on('error', retry);
    const retry = () => (Date.now() - start > timeoutMs ? reject(new Error('server not healthy')) : setTimeout(tick, 150));
    tick();
  });
}

// ── WS seed clients (persistent so the rooms stay live while the browser views) ─
const seeds = [];
function conn() {
  const ws = new WebSocket(WS_URL);
  const c = { ws, room: null };
  ws.on('message', (m) => { const o = JSON.parse(m.toString()); if (o.t === 'WELCOME') c.room = o.room; if (o.t === 'ROOM_UPDATE') c.room = o.room; });
  seeds.push(c);
  return new Promise((res) => ws.on('open', () => res(c)));
}
const send = (c, msg) => c.ws.send(JSON.stringify(msg));

async function seedRooms() {
  // Open King lobby (1/4, no password).
  const king = await conn();
  send(king, { t: 'CREATE_ROOM', name: 'Ahmad', playerCount: 4, modeSelectionType: 'dealer_choice' });
  await sleep(200);
  // Locked Deberc small (1/4, password) → shows the 🔒 open/locked treatment.
  const deberc = await conn();
  send(deberc, { t: 'CREATE_ROOM', name: 'Layla', gameType: 'deberc', matchSize: 'small', modeSelectionType: 'fixed', password: 'x' });
  await sleep(200);
  // Full Tarneeb (4/4, not started) → status 'full'.
  const tarneeb = await conn();
  send(tarneeb, { t: 'CREATE_ROOM', name: 'Omar', gameType: 'tarneeb', modeSelectionType: 'fixed' });
  await sleep(200);
  send(tarneeb, { t: 'ADD_BOT' }); send(tarneeb, { t: 'ADD_BOT' }); send(tarneeb, { t: 'ADD_BOT' });
  await sleep(300);
  // In-game Durak (transfer), host + bot + start.
  const durak = await conn();
  send(durak, { t: 'CREATE_ROOM', name: 'Yusuf', gameType: 'durak', variant: 'transfer', modeSelectionType: 'fixed' });
  await sleep(200);
  send(durak, { t: 'ADD_BOT' });
  await sleep(200);
  send(durak, { t: 'START_GAME' });
  await sleep(400);
  console.log(`seeded rooms: King=${king.room?.code} Deberc=${deberc.room?.code} Tarneeb=${tarneeb.room?.code} Durak=${durak.room?.code}`);
}

// ── CDP ────────────────────────────────────────────────────────────────────────
const fetchJson = (p) => new Promise((res, rej) => get(`http://localhost:${DEVTOOLS_PORT}${p}`, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
async function waitDevtools(t = 8000) { const s = Date.now(); for (;;) { try { return await fetchJson('/json/version'); } catch { if (Date.now() - s > t) throw new Error('no devtools'); await sleep(150); } } }
class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); }
  open() { return new Promise((res) => { this.ws.on('open', res); this.ws.on('message', (m) => { const o = JSON.parse(m.toString()); if (o.id && this.pending.has(o.id)) { this.pending.get(o.id)(o); this.pending.delete(o.id); } }); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; }
}
const CLICKSEL = (sel, i = 0) => `(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(e){e.click();return true}return false})()`;
const CLICKTXT = (t) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(t)}));if(b){b.click();return true}return false})()`;
const HAS = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;
const COUNT = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;

const findings = [];
async function shot(cdp, name, checks = {}) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const overflowX = await cdp.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1');
  const results = {};
  for (const [k, sel] of Object.entries(checks)) results[k] = await cdp.evaluate(HAS(sel));
  const missing = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
  const ok = !overflowX && missing.length === 0;
  findings.push({ name, ok, overflowX, missing });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${overflowX ? ' [OVERFLOW]' : ''}${missing.length ? ` [missing: ${missing.join(',')}]` : ''}`);
}

async function hostLobby(cdp, gameLabel) {
  await cdp.send('Page.navigate', { url: PREVIEW });
  await sleep(900);
  await cdp.evaluate(CLICKSEL('.tile', 1));                                   // Host
  await sleep(450);
  if (gameLabel) {
    await cdp.evaluate(CLICKSEL('.game-picker .select-menu__trigger'));
    await sleep(250);
    await cdp.evaluate(`(()=>{const o=[...document.querySelectorAll('.select-menu__option')].find(x=>x.textContent.includes(${JSON.stringify(gameLabel)}));if(o)o.click()})()`);
    await sleep(250);
  }
  await cdp.evaluate(`(()=>{const b=[...document.querySelectorAll('.sheet .btn--primary')].pop();if(b)b.click()})()`);
  await sleep(1000);
  // Fill with bots so the seats + partnership hints render.
  for (let i = 0; i < 3; i++) { if (await cdp.evaluate(CLICKTXT('🤖'))) await sleep(500); }
}

async function runViewport(cdp, vp, rtl = false) {
  const tag = `${vp.w}${rtl ? '-ar' : ''}`;
  console.log(`\n[viewport ${vp.w}x${vp.h}${rtl ? ' RTL' : ''}]`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true, screenWidth: vp.w, screenHeight: vp.h });
  if (rtl) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem(${JSON.stringify(LANG_KEY)},'ar')}catch(e){}` });
  else await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem(${JSON.stringify(LANG_KEY)},'en')}catch(e){}` });

  // Room browser (Join) with the seeded mix.
  await cdp.send('Page.navigate', { url: PREVIEW });
  await sleep(900);
  await cdp.evaluate(CLICKSEL('.tile', 2));                                   // Join
  await sleep(1400);                                                          // wait for LIST_ROOMS
  const rows = await cdp.evaluate(COUNT('.server-browser__row'));
  console.log(`    room rows: ${rows}`);
  await shot(cdp, `${tag}-browser`, { browser: '.server-browser', row: '.server-browser__row', filter: '.room-filter__chip', sort: '.room-sort' });
  // Select the first joinable row (shows the selected treatment).
  await cdp.evaluate(CLICKSEL('.server-browser__row:not(:disabled)', 0));
  await sleep(300);
  await shot(cdp, `${tag}-browser-selected`, { selected: '.server-browser__row--selected, .server-browser__row' });

  if (rtl) return; // RTL smoke = browser only

  // King lobby (host + bots).
  await hostLobby(cdp, null); // default King
  await shot(cdp, `${tag}-lobby-king`, { code: '.room-code', members: '.lobby-member', leave: '.lobby-leave', start: '.setup-card .btn--primary' });
  // Tarneeb lobby (teams hint).
  await hostLobby(cdp, 'Tarneeb');
  await shot(cdp, `${tag}-lobby-tarneeb`, { code: '.room-code', members: '.lobby-member', teams: '.lobby-teams-hint', leave: '.lobby-leave' });
}

let server = null;
async function main() {
  rmSync(DATA, { recursive: true, force: true });
  server = startServer();
  await waitForHealth();
  console.log(`server up on :${SERVER_PORT}`);
  await seedRooms();
  const chrome = spawn(CHROME, [`--remote-debugging-port=${DEVTOOLS_PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank']);
  try {
    await waitDevtools();
    for (const vp of VIEWPORTS) {
      const page = (await fetchJson('/json')).find((t) => t.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await runViewport(cdp, vp, false);
      cdp.ws.close();
    }
    // RTL smoke at 390.
    const page = (await fetchJson('/json')).find((t) => t.type === 'page');
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open(); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await runViewport(cdp, { w: 390, h: 844 }, true);
    cdp.ws.close();
  } finally {
    chrome.kill();
    seeds.forEach((c) => { try { c.ws.close(); } catch { /* ignore */ } });
    await killServer(server);
    rmSync(DATA, { recursive: true, force: true });
  }
  const fails = findings.filter((f) => !f.ok);
  console.log(`\n=== ${fails.length === 0 ? `ALL ${findings.length} LOBBY/BROWSER STATES PASS` : `${fails.length}/${findings.length} FAILED: ${fails.map((f) => f.name).join(', ')}`} ===`);
  process.exit(fails.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error('lobby-shots crashed:', e); seeds.forEach((c) => { try { c.ws.close(); } catch { /* ignore */ } }); await killServer(server); rmSync(DATA, { recursive: true, force: true }); process.exit(1); });
