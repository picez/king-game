// Worst-case gameplay footprint audit (Stage 38.0.16.3).
//   node footprint.mjs [--games king,poker] [--widths 1366,1920] [--dirs ltr,rtl] [--json out]
// Uses the c5d2d87 shared QA runtime: owned processes, owned target, proved viewport.
import { get } from 'node:http';
import { writeFileSync } from 'node:fs';
import { openOwnedPage, applyViewport, provePage, CdpSession } from './lib/cdp-owned-target.mjs';
import { runWithQaRuntime } from './lib/qa-processes.mjs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9256;
const VITE_PORT = 5203;
const BASE = `http://localhost:${VITE_PORT}/scripts/layout-harness/social-games.html`;

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const GAMES = arg('--games', 'king,poker,durak,deberc,tarneeb,preferans,fiftyone').split(',');
const WIDTHS = arg('--widths', '1366,1440,1480,1560,1620,1660,1680,1920,2560').split(',').map(Number);
const DIRS = arg('--dirs', 'ltr,rtl').split(',');
const JSON_OUT = arg('--json', null);

const Q = {
  king: 'game=king&seats=4', durak: 'game=durak&seats=4', deberc: 'game=deberc&seats=4',
  tarneeb: 'game=tarneeb&seats=4', preferans: 'game=preferans&seats=3',
  fiftyone: 'game=fiftyone&seats=4', poker: 'game=poker&seats=6',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, timeout = 90000) {
  const start = Date.now();
  for (;;) {
    try { await new Promise((res, rej) => get(url, (r) => { r.resume(); res(r.statusCode); }).on('error', rej)); return; }
    catch { if (Date.now() - start > timeout) throw new Error(`not up: ${url}`); await sleep(200); }
  }
}

const SETTLE = `(async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  for (let i = 0; i < 60 && window.__socialReady !== true; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
})()`;

/**
 * The gameplay UNION: every element inside `.game-stage` that actually PAINTS something a
 * player sees or touches — a background, a border, an image/canvas/svg, a text leaf, or an
 * interactive control. Pure layout wrappers contribute nothing, which is the whole point:
 * the stage is full-width by contract, so measuring the stage tells you nothing about how
 * much room the GAME needs. `widest` names the element that set the width, so a union that
 * comes out full-width can be explained instead of guessed at.
 */
const UNION = `JSON.stringify((() => {
  const stage = document.querySelector('.game-stage');
  if (!stage) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const paints = (el, st) => {
    if (/^(IMG|CANVAS|SVG|VIDEO|INPUT|BUTTON|SELECT|TEXTAREA)$/.test(el.tagName)) return true;
    if (el.matches('a,[role="button"],[tabindex]:not([tabindex="-1"])')) return true;
    const bg = st.backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\\(\\s*0,\\s*0,\\s*0,\\s*0\\s*\\)/.test(bg)) return true;
    if (st.backgroundImage && st.backgroundImage !== 'none') return true;
    for (const s of ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth']) {
      if (parseFloat(st[s]) > 0.4) return true;
    }
    // a text leaf: has its own text and no element children carrying it
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length);
    return own;
  };
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  let widest = null, widestW = -1, count = 0;
  for (const el of stage.querySelectorAll('*')) {
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
    const rc = el.getBoundingClientRect();
    if (rc.width < 0.5 || rc.height < 0.5) continue;
    if (rc.bottom < 0 || rc.top > vh || rc.right < 0 || rc.left > vw) continue;  // off-screen
    if (!paints(el, st)) continue;
    count++;
    l = Math.min(l, rc.left); t = Math.min(t, rc.top);
    r = Math.max(r, rc.right); b = Math.max(b, rc.bottom);
    if (rc.width > widestW) { widestW = rc.width; widest = (el.className || el.tagName).toString().split(' ')[0]; }
  }
  if (!isFinite(l)) return null;
  const layout = document.querySelector('.room-layout').getBoundingClientRect();
  const stageR = stage.getBoundingClientRect();
  const panel = document.querySelector('.chat-panel');
  const pr = panel ? panel.getBoundingClientRect() : null;
  const de = document.documentElement;
  return {
    inner: window.innerWidth, client: de.clientWidth, gutter: window.innerWidth - de.clientWidth,
    layout: { x: +layout.left.toFixed(2), w: +layout.width.toFixed(2) },
    stage: { x: +stageR.left.toFixed(2), w: +stageR.width.toFixed(2) },
    union: { x: +l.toFixed(2), y: +t.toFixed(2), w: +(r - l).toFixed(2), h: +(b - t).toFixed(2) },
    centre: +((l + r) / 2).toFixed(2),
    freeStart: +(l - layout.left).toFixed(2),
    freeEnd: +(layout.right - r).toFixed(2),
    widest, widestW: +widestW.toFixed(2), painted: count,
    chat: pr ? { x: +pr.left.toFixed(2), w: +pr.width.toFixed(2), h: +pr.height.toFixed(2),
                 inView: pr.top >= -0.5 && pr.bottom <= vh + 0.5 } : null,
    scrollY: Math.round(window.scrollY),
    docH: de.scrollHeight, overflowX: de.scrollWidth > de.clientWidth + 1,
    sidecar: (() => { const l = document.querySelector('.room-layout');
      return !!l && /room-layout--sidecar/.test(l.className)
        && getComputedStyle(l).gridTemplateColumns.split(' ').length === 3; })(),
  };
})())`;

const OPEN_CHAT = `(() => {
  const btns = [...document.querySelectorAll('.room-social__bar .social-fab, .social-menu__launcher, .social-controls__row .social-fab')]
    .filter((b) => (b.textContent || '').includes('\u{1F4AC}'));
  if (btns.length !== 1) return btns.length;
  btns[0].click(); return true;
})()`;

async function main() {
  const failures = [];
  const rows = [];
  await runWithQaRuntime({
    name: 'kg-footprint', vitePort: VITE_PORT, cdpPort: CDP_PORT, chromePath: CHROME, failures,
  }, async () => {
    await waitHttp(`${BASE}?game=king&seats=4`);
    const owned = await openOwnedPage(CDP_PORT, CdpSession);
    const cdp = owned.cdp;
    try {
      for (const w of WIDTHS) {
        const vp = { w, h: 1080, mobile: w < 700 };
        for (const dir of DIRS) {
          for (const game of GAMES) {
            const dirQ = dir === 'rtl' ? '&dir=rtl&lang=ar' : '';
            const url = `${BASE}?${Q[game]}${dirQ}&chat=8`;
            cdp.setContext(`${w} ${game}/${dir}`);
            await applyViewport(owned, vp);
            await cdp.send('Page.navigate', { url });
            let ok = false;
            for (let i = 0; i < 200; i++) {
              if (await cdp.evaluate("!!document.querySelector('#root > *')")) { ok = true; break; }
              await sleep(100);
            }
            if (!ok) { failures.push(`${w} ${game}/${dir}: nothing rendered`); continue; }
            await cdp.evaluate(SETTLE);
            const proof = await provePage(owned, vp, url, `${w} ${game}/${dir}`);
            if (proof.length) { failures.push(...proof); continue; }

            const closed = JSON.parse(await cdp.evaluate(UNION));
            const opened = await cdp.evaluate(OPEN_CHAT);
            if (opened !== true) { failures.push(`${w} ${game}/${dir}: ${opened} chat launchers`); continue; }
            await cdp.evaluate(SETTLE);
            const open = JSON.parse(await cdp.evaluate(UNION));
            await cdp.evaluate(`(() => { const b = document.querySelector('.chat-picker-btn'); if (b) b.click(); return true; })()`);
            await cdp.evaluate(SETTLE);
            const picker = JSON.parse(await cdp.evaluate(UNION));
            rows.push({ w, dir, game, closed, open, picker });
            const d = (a, b) => +(b - a).toFixed(2);
            const dU = (a, b) => `${d(a.union.x, b.union.x)}/${d(a.union.w, b.union.w)}`;
            console.log(`${String(w).padEnd(5)} ${game.padEnd(10)} ${dir}  `
              + `inner ${closed.inner} client ${closed.client} gut ${closed.gutter} | `
              + `union ${String(closed.union.w).padEnd(8)} x${String(closed.union.x).padEnd(7)} `
              + `free ${String(closed.freeStart).padEnd(7)}/${String(closed.freeEnd).padEnd(7)} | `
              + `widest ${String(closed.widest).slice(0, 22).padEnd(22)} ${closed.widestW} | `
              + `stageΔ ${d(closed.layout.w, closed.stage.w)} | `
              + `scrollY ${closed.scrollY}/${open.scrollY}/${picker.scrollY} | `
              + `chat ${open.chat ? `${open.chat.w}w inView=${open.chat.inView}` : 'none'} | `
              + `sidecar ${open.sidecar} | unionΔ open ${dU(closed, open)} picker ${dU(closed, picker)}`
              + ` | centreΔ ${d(closed.centre, open.centre)}/${d(closed.centre, picker.centre)}`
              + ` | ovfl ${closed.overflowX}/${open.overflowX}`);
          }
        }
      }
    } finally { await owned.close(); }
  });
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
  if (failures.length) { console.log(`\n${failures.length} problems:`); for (const f of failures) console.log('  - ' + f); }
}
main().catch((e) => { console.error(e); process.exit(1); });
