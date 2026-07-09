// ---------------------------------------------------------------------------
// Online social visual-QA harness (Stage 12.7). The other shot scripts are
// local-only, so RoomSocial (chat drawer, sticker picker, floating stickers,
// raised social controls) had no screenshot coverage. This spins up a REAL
// server (like e2e-online), drives ONE browser as the host of an online Durak
// room (host + 1 bot → reaches `playing` with a hand instantly), and captures
// the social surfaces at 360×800 and 390×844.
//
//   npm run preview            # in another shell (serves the built client :4173)
//   node scripts/social-shots.mjs [previewUrl] [outDir]
//
// Reports, per state: horizontal overflow + presence of the key selectors.
// This is MANUAL QA (starts a server, drives a browser) — not part of `verify`.
// e2e-online.mjs remains the behavioral source of truth for social messaging.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import WebSocket from 'ws';

const PREVIEW = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || '.shots/social';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEVTOOLS_PORT = 9225;
const SERVER_PORT = 3001;                 // the client's default ws://<host>:3001/ws
const DATA = '.data-social';
const VIEWPORTS = [{ w: 360, h: 800 }, { w: 390, h: 844 }];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Server (real WS server, throwaway store; fast bots) ──────────────────────
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

// ── Minimal CDP ──────────────────────────────────────────────────────────────
const fetchJson = (p) => new Promise((res, rej) => get(`http://localhost:${DEVTOOLS_PORT}${p}`, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
async function waitDevtools(t = 8000) { const s = Date.now(); for (;;) { try { return await fetchJson('/json/version'); } catch { if (Date.now() - s > t) throw new Error('no devtools'); await sleep(150); } } }
class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); }
  open() { return new Promise((res) => { this.ws.on('open', res); this.ws.on('message', (m) => { const o = JSON.parse(m.toString()); if (o.id && this.pending.has(o.id)) { this.pending.get(o.id)(o); this.pending.delete(o.id); } }); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; }
}

const CLICKSEL = (sel, i = 0) => `(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${i}];if(e){e.click();return true}return false})()`;
const CLICKTXT = (t) => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(t)}));if(b){b.click();return true}return false})()`;
const HAS = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;
const TYPE = (sel, val) => `(()=>{const i=document.querySelector(${JSON.stringify(sel)});if(!i)return false;const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(val)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`;

const findings = [];
async function shot(cdp, name, checks = {}) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  const overflowX = await cdp.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1');
  const results = {};
  for (const [k, sel] of Object.entries(checks)) results[k] = await cdp.evaluate(HAS(sel));
  const missing = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
  const ok = !overflowX && missing.length === 0;
  findings.push({ name, overflowX, missing, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${overflowX ? ' [OVERFLOW]' : ''}${missing.length ? ` [missing: ${missing.join(',')}]` : ''}`);
}

async function openReactionPicker(cdp) { await cdp.evaluate(CLICKSEL('.social-fab', 0)); await sleep(350); }
async function openChat(cdp) { await cdp.evaluate(CLICKSEL('.social-fab', 1)); await sleep(350); }

async function runViewport(cdp, vp) {
  const tag = `${vp.w}`;
  console.log(`\n[viewport ${vp.w}x${vp.h}]`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true, screenWidth: vp.w, screenHeight: vp.h });

  // Host an online Durak room (host + 1 bot → reaches `playing` instantly).
  await cdp.send('Page.navigate', { url: PREVIEW });
  await sleep(1000);
  await cdp.evaluate(CLICKSEL('.tile', 1));                                   // Host online room
  await sleep(500);
  await cdp.evaluate(CLICKSEL('.game-picker .select-menu__trigger'));         // open game picker
  await sleep(300);
  await cdp.evaluate(`(()=>{const o=[...document.querySelectorAll('.select-menu__option')].find(x=>x.textContent.includes('Durak'));if(o)o.click()})()`);
  await sleep(300);
  await cdp.evaluate(`(()=>{const b=[...document.querySelectorAll('.sheet .btn--primary')].pop();if(b)b.click()})()`); // Create room
  await sleep(1200);
  await cdp.evaluate(CLICKTXT('🤖'));                                          // Add bot → 2/2
  await sleep(900);

  // ── Lobby social ───────────────────────────────────────────────────────────
  await openChat(cdp);
  await shot(cdp, `${tag}-lobby-1-chat-open`, { drawer: '.chat-drawer', compose: '.chat-drawer__compose', controls: '.social-controls' });
  // Send a text message, then (spaced past the 3s rate limit) a media sticker.
  await cdp.evaluate(TYPE('.chat-input', 'gg — nice deal! 🎉'));
  await sleep(150);
  await cdp.evaluate(`(()=>{const b=document.querySelector('.chat-drawer__compose .btn--primary');if(b)b.click()})()`);
  await sleep(3300);
  await cdp.evaluate(CLICKSEL('.chat-media-btn'));                            // open in-drawer sticker picker
  await sleep(400);
  await shot(cdp, `${tag}-lobby-2-media-picker`, { picker: '.chat-media-picker', thumb: '.chat-media-thumb' });
  await cdp.evaluate(CLICKSEL('.chat-media-thumb', 0));                       // send first sticker
  await sleep(700);
  await shot(cdp, `${tag}-lobby-3-chat-messages`, { drawer: '.chat-drawer', textMsg: '.chat-msg__text', mediaMsg: '.chat-msg__media img' });
  await cdp.evaluate(CLICKSEL('.chat-drawer__head .btn--ghost'));            // close chat
  await sleep(300);
  // Reaction picker (emoji + sticker grid) + a floating emoji reaction.
  await openReactionPicker(cdp);
  await shot(cdp, `${tag}-lobby-4-reaction-picker`, { bar: '.reaction-bar', emojis: '.reaction-bar__emojis', stickers: '.reaction-bar__stickers' });
  await cdp.evaluate(CLICKSEL('.reaction-bar__btn', 0));                      // send an emoji reaction
  await sleep(450);
  await shot(cdp, `${tag}-lobby-5-float-reaction`, { float: '.reactions-float .reaction-chip' });

  // ── Start the game → active Durak with a hand ────────────────────────────────
  await cdp.evaluate(`(()=>{const b=[...document.querySelectorAll('.btn--primary')].find(x=>!x.closest('.chat-drawer'));if(b)b.click()})()`); // Start
  await sleep(1500);
  await shot(cdp, `${tag}-game-1-hand-social`, { hand: '.durak-hand', card: '.durak-hand .card', controls: '.social-controls--raised' });
  await openReactionPicker(cdp);
  await shot(cdp, `${tag}-game-2-reaction-picker`, { bar: '.reaction-bar', stickers: '.reaction-bar__stickers', hand: '.durak-hand' });
  // Float a sticker over the table (media uses the 3s chat limit — already elapsed).
  await cdp.evaluate(CLICKSEL('.reaction-bar__stickers .chat-media-thumb', 1));
  await sleep(500);
  await shot(cdp, `${tag}-game-3-float-sticker`, { float: '.reactions-float .reaction-chip--sticker', hand: '.durak-hand' });
}

let server = null;
async function main() {
  rmSync(DATA, { recursive: true, force: true });
  server = startServer();
  await waitForHealth();
  console.log(`server up on :${SERVER_PORT}`);
  const chrome = spawn(CHROME, [`--remote-debugging-port=${DEVTOOLS_PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank']);
  try {
    await waitDevtools();
    for (const vp of VIEWPORTS) {
      const page = (await fetchJson('/json')).find((t) => t.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await runViewport(cdp, vp);
      cdp.ws.close();
    }
  } finally {
    chrome.kill();
    await killServer(server);
    rmSync(DATA, { recursive: true, force: true });
  }
  const fails = findings.filter((f) => !f.ok);
  console.log(`\n=== ${fails.length === 0 ? `ALL ${findings.length} SOCIAL STATES PASS` : `${fails.length}/${findings.length} FAILED: ${fails.map((f) => f.name).join(', ')}`} ===`);
  process.exit(fails.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error('social-shots crashed:', e); await killServer(server); rmSync(DATA, { recursive: true, force: true }); process.exit(1); });
