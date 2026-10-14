// ---------------------------------------------------------------------------
// Friend-invite toast visual QA (2026-10-14, owner FAIL "the invite window lies over the
// text at the top"). Mounts the menu and the in-room tables, injects the SAME toast markup
// the app renders and photographs it. A top toast necessarily lies over the top bar, so the
// gate does not forbid covering — it forbids SEE-THROUGH: the card must be opaque (the old
// 7% wash let the title and round show through the invite text), fully on screen, and must
// never reach the hand / action zones.
//
//   node scripts/invite-toast-shots.mjs [outDir]
// ---------------------------------------------------------------------------

import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openOwnedPage, applyViewport, CdpSession } from './lib/cdp-owned-target.mjs';
import { runWithQaRuntime } from './lib/qa-processes.mjs';

const OUT = process.argv[2] || '.shots/invite-toast';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9264;
const VITE_PORT = 5214;
const ROOT = `http://localhost:${VITE_PORT}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, timeout = 120000) {
  const start = Date.now();
  for (;;) {
    try { await new Promise((res, rej) => get(url, (r) => { r.resume(); res(r.statusCode); }).on('error', rej)); return; }
    catch { if (Date.now() - start > timeout) throw new Error(`not up: ${url}`); await sleep(200); }
  }
}

const PAGES = [
  ['menu', `${ROOT}/`, '.menu-screen'],
  ['king', `${ROOT}/scripts/layout-harness/social-games.html?game=king&seats=4&chat=3&panel=none`, '.game-stage'],
  ['durak', `${ROOT}/scripts/layout-harness/social-games.html?game=durak&seats=4&chat=3&panel=none`, '.game-stage'],
  ['poker', `${ROOT}/scripts/layout-harness/social-games.html?game=poker&seats=6&chat=3&panel=none`, '.game-stage'],
  ['fiftyone', `${ROOT}/scripts/layout-harness/social-games.html?game=fiftyone&seats=4&chat=3&panel=none`, '.game-stage'],
];
const VPS = [{ w: 360, h: 800, mobile: true }, { w: 390, h: 844, mobile: true }, { w: 667, h: 375, mobile: true }, { w: 1366, h: 768, mobile: false }];

// The production markup (OnlineGame / StartMenu), mounted where the app mounts it:
// inside the room's social region when one exists, otherwise at the end of #root.
const INJECT = `(() => {
  const host = document.querySelector('.room-layout > .social-region') || document.getElementById('root') || document.body;
  const d = document.createElement('div');
  d.className = 'friend-invite-toast'; d.setAttribute('role', 'status');
  d.innerHTML = '<span class="friend-invite-toast__text"><strong>Олександра</strong> запрошує вас у гру · <code>KING-4829</code></span>'
    + '<span class="friend-invite-toast__actions"><button type="button" class="btn btn--primary btn--small">Приєднатись</button>'
    + '<button type="button" class="btn btn--ghost btn--small">Закрити</button></span>';
  host.prepend(d);
  return host.className || host.id;
})()`;

// Same PLAY zones as the social gate: what a player taps to move.
const PLAY = ['.game-footer', '.durak-controls', '.fiftyone-piles', '.fiftyone-actions', '.poker-actions', '.hand-reorder-wrap'];
const MEASURE = `(() => {
  const t = document.querySelector('.friend-invite-toast'); if (!t) return null;
  const r = t.getBoundingClientRect(); const bg = getComputedStyle(t).backgroundColor;
  const a = /rgba[(]([^)]+)[)]/.exec(bg); const alpha = a ? +a[1].split(',')[3] : 1;
  const play = [];
  for (const sel of ${JSON.stringify(PLAY)}) for (const el of document.querySelectorAll(sel)) {
    const b = el.getBoundingClientRect(); if (b.width < 1 || b.height < 1) continue;
    if (b.right > r.left + 1 && b.left < r.right - 1 && b.bottom > r.top + 1 && b.top < r.bottom - 1) play.push(sel);
  }
  return { bg, alpha, t: r.top, b: r.bottom, l: r.left, r: r.right, play };
})()`;

async function main() {
  const failures = [];
  await runWithQaRuntime({ name: 'kg-invite-toast', vitePort: VITE_PORT, cdpPort: CDP_PORT, chromePath: CHROME, failures }, async () => {
    await waitHttp(`${ROOT}/`);
    const owned = await openOwnedPage(CDP_PORT, CdpSession);
    const cdp = owned.cdp;
    try {
      for (const [tag, url, ready] of PAGES) {
        for (const vp of VPS) {
          const name = `${tag}-${vp.w}x${vp.h}`;
          cdp.setContext(name);
          await applyViewport(owned, vp);
          await cdp.send('Page.navigate', { url });
          let ok = false;
          for (let i = 0; i < 150; i++) { if (await cdp.evaluate(`!!document.querySelector(${JSON.stringify(ready)})`)) { ok = true; break; } await sleep(100); }
          if (!ok) { failures.push(`${name}: page never rendered`); continue; }
          await sleep(400);
          await cdp.evaluate(INJECT);
          await cdp.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
          const m = await cdp.json(MEASURE);
          if (!m) { failures.push(`${name}: no toast`); continue; }
          if (m.alpha < 1) failures.push(`${name}: toast background is see-through (${m.bg})`);
          if (m.t < 0 || m.b > vp.h || m.l < 0 || m.r > vp.w) failures.push(`${name}: toast off screen ${JSON.stringify(m)}`);
          if (m.play.length) failures.push(`${name}: toast covers play zones ${m.play.join(', ')}`);
          const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
          writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.result.data, 'base64'));
        }
      }
    } finally { await owned.close?.(); }
  });
  if (failures.length) { console.log('INVITE TOAST FAIL\n' + failures.join('\n')); process.exit(1); }
  console.log('INVITE TOAST OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
