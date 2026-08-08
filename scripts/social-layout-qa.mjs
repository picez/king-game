// ---------------------------------------------------------------------------
// GENERIC RoomSocial LAYOUT + BEHAVIOUR gate (Stage 38.0.12).
//
//   node scripts/social-layout-qa.mjs [--shots <dir>] [--only <substr>] [--legacy]
//
// `layout:poker` measures the docked cluster inside the poker table and
// `layout:fiftyone` measures the sheet inside 51's screen. NEITHER proves that the
// seven games share ONE social contract — that is what this gate is for. It mounts the
// real RoomSocial on its own (scripts/layout-harness/social.html) in every layout
// variant, at phone and desktop widths, LTR and Arabic RTL, and:
//
//   * counts the outer social controls (exactly one chat control, no rival reactions one);
//   * measures the open chat: history + composer + Send + picker button all visible;
//   * opens the picker and measures that the HISTORY SURVIVES beside it, that the
//     composer stays reachable, that the picker is the only scroller of its region and
//     that every sticker cell is a square with a fully visible image;
//   * drives the REAL clicks against recorded callbacks: emoji → message inserts at the
//     caret and sends nothing, emoji → table sends exactly one reaction and touches no
//     text, a sticker sends exactly once — and none of the three closes anything.
//
// `--legacy` reproduces the pre-fix RED by re-applying the old CSS caps.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const WebSocket = createRequire(`${process.cwd()}/package.json`)('ws');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9254;
const VITE_PORT = 5201;
const BASE = `http://localhost:${VITE_PORT}/scripts/layout-harness/social.html`;

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const LEGACY = args.includes('--legacy');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchJson = (p) => new Promise((res, rej) => get(`http://127.0.0.1:${CDP_PORT}${p}`, (r) => {
  let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)));
}).on('error', rej));

async function waitHttp(url, timeout = 90000) {
  const start = Date.now();
  for (;;) {
    try { await new Promise((res, rej) => get(url, (r) => { r.resume(); res(r.statusCode); }).on('error', rej)); return; }
    catch { if (Date.now() - start > timeout) throw new Error(`not up: ${url}`); await sleep(200); }
  }
}
async function waitDevtools(timeout = 15000) {
  const start = Date.now();
  for (;;) {
    try { return await fetchJson('/json/version'); }
    catch { if (Date.now() - start > timeout) throw new Error('chrome devtools not up'); await sleep(150); }
  }
}

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); }
  close() { try { this.ws.close(); } catch { /* already gone */ } }
  open() {
    return new Promise((res) => {
      this.ws.on('open', res);
      this.ws.on('message', (m) => {
        const o = JSON.parse(m.toString());
        if (o.id && this.pending.has(o.id)) { this.pending.get(o.id)(o); this.pending.delete(o.id); }
      });
    });
  }
  send(method, params = {}, timeoutMs = 20000) {
    const id = ++this.id;
    return new Promise((res) => {
      const done = (v) => { clearTimeout(timer); this.pending.delete(id); res(v); };
      const timer = setTimeout(() => done({ __timeout: true }), timeoutMs);
      this.pending.set(id, done);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r?.__timeout) return undefined;
    return r.result?.result?.value;
  }
}

// The RED: the caps this stage replaced. `--legacy` re-applies them so the failure can
// be reproduced on demand instead of being described.
const LEGACY_CSS = `
  .chat-picker { max-height: 34vh !important; }
  .chat-drawer__list { min-height: 0 !important; }
`;

// --- settle: fonts, the harness's own mount, decoded in-viewport art, 2 frames --------
const SETTLE = `(async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  for (let i = 0; i < 60 && window.__socialReady !== true; i++) await new Promise(r => setTimeout(r, 50));
  const imgs = [...document.images].filter((im) => {
    const r = im.getBoundingClientRect();
    return r.width > 0.5 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  });
  await Promise.all(imgs.map((im) => Promise.race([
    im.decode ? im.decode().catch(() => {}) : Promise.resolve(),
    new Promise((r) => setTimeout(r, 2000)),
  ])));
  await new Promise((r) => requestAnimationFrame(() => r()));
  await new Promise((r) => requestAnimationFrame(() => r()));
  return { ready: window.__socialReady === true };
})()`;

// --- the in-page probe ---------------------------------------------------------------
const PROBE = `JSON.stringify((() => {
  const S = 0.5;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const live = (r) => !!r && r.w > 0.5 && r.h > 0.5;
  const one = (sel) => { const el = document.querySelector(sel); return el ? rect(el) : null; };
  // A list may be TALLER than the box that clips it (a scrolling parent), so the honest
  // measure of "how much conversation can the player see" is the visible band.
  const visibleH = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return 0;
    const r = rect(el);
    let box = { t: r.t, b: r.b }, clip = el.parentElement;
    while (clip) {
      const st = getComputedStyle(clip);
      if (st.overflowY === 'auto' || st.overflowY === 'scroll' || st.overflowY === 'hidden') {
        const cr = rect(clip);
        box = { t: Math.max(box.t, cr.t), b: Math.min(box.b, cr.b) };
      }
      clip = clip.parentElement;
    }
    return Math.max(0, Math.min(box.b, window.innerHeight) - Math.max(box.t, 0));
  };
  const all = (sel) => [...document.querySelectorAll(sel)].filter((e) => live(rect(e)));
  const hit = (a, b) => !!a && !!b && a.l < b.r - S && b.l < a.r - S && a.t < b.b - S && b.t < a.b - S;
  const v = [];
  const add = (kind, detail) => v.push(kind + ': ' + detail);
  const vw = window.innerWidth, vh = window.innerHeight;

  // 1. Outer controls: exactly ONE chat control, and no rival reactions control.
  const outer = [...document.querySelectorAll('.social-controls__row .social-fab, .social-menu__launcher')];
  const chatBtns = outer.filter((b) => (b.textContent || '').includes('💬'));
  const emojiBtns = outer.filter((b) => (b.textContent || '').trim().startsWith('😀'));
  if (chatBtns.length !== 1) add('outer-chat-controls', String(chatBtns.length));
  if (emojiBtns.length !== 0) add('outer-reactions-control', String(emojiBtns.length));

  // 2. Tap targets of every social control.
  for (const b of outer) {
    const r = rect(b);
    if (live(r) && (r.w < 43.5 || r.h < 43.5)) add('control-small', Math.round(r.w) + 'x' + Math.round(r.h));
  }

  // 3. The open chat: history + composer + Send + picker button.
  const panel = one('.chat-drawer') || one('.social-sheet');
  const list = one('.chat-drawer__list');
  const compose = one('.chat-drawer__compose');
  const send = one('.chat-drawer__compose [type="submit"]');
  const pickerBtn = one('.chat-picker-btn');
  const picker = one('.chat-picker');
  const chatOpen = !!panel && !!list;
  if (chatOpen) {
    if (!live(list)) add('history-missing', 'zero size');
    if (!live(compose)) add('composer-missing', 'zero size');
    if (!live(send)) add('send-missing', 'zero size');
    if (!live(pickerBtn)) add('picker-button-missing', 'zero size');
    // The panel itself must stay inside the viewport.
    if (panel.b > vh + S) add('panel-below-viewport', Math.round(panel.b) + '>' + vh);
    if (panel.l < -S || panel.r > vw + S) add('panel-outside-viewport', Math.round(panel.l) + '..' + Math.round(panel.r));
    if (compose && compose.b > vh + S) add('composer-below-viewport', Math.round(compose.b) + '>' + vh);
  }

  // 4. With the picker open the HISTORY must survive beside it, and the composer stay put.
  const histVisible = visibleH('.chat-drawer__list');
  if (picker && live(picker)) {
    if (histVisible < 96) add('history-squeezed', Math.round(histVisible) + 'px');
    if (panel && histVisible / panel.h < 0.2) {
      add('history-share', Math.round(100 * histVisible / panel.h) + '% of ' + Math.round(panel.h));
    }
    if (picker.h > 0.5 * vh + S) add('picker-too-tall', Math.round(picker.h) + '>' + Math.round(0.5 * vh));
    if (picker.b > vh + S) add('picker-below-viewport', Math.round(picker.b) + '>' + vh);
    if (hit(picker, list)) add('picker-covers-history', 'overlap');
    if (compose && hit(picker, compose)) add('picker-covers-composer', 'overlap');
    const pk = document.querySelector('.chat-picker');
    if (pk && pk.scrollWidth > pk.clientWidth + 1) add('picker-scroll-x', pk.scrollWidth + '>' + pk.clientWidth);
    // …and NOTHING inside the picker scrolls on its own.
    for (const el of pk.querySelectorAll('*')) {
      const st = getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll')
        && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1) {
        add('picker-nested-scroll', (el.className || '?').toString().split(' ')[0]);
      }
    }
  }

  // 5. Sticker cells: square, image fills them, no overlap, no sideways scroll.
  const thumbs = all('.chat-media-thumb');
  for (const b of thumbs) {
    const br = rect(b);
    const ratio = br.w / br.h;
    if (ratio < 0.75 || ratio > 1.34) add('sticker-not-square', Math.round(br.w) + 'x' + Math.round(br.h));
    if (br.w < 43.5 || br.h < 43.5) add('sticker-small', Math.round(br.w) + 'x' + Math.round(br.h));
    const img = b.querySelector('img');
    if (img) {
      const ir = rect(img);
      if (ir.w > 0.5 && ir.h / ir.w < 0.5) add('sticker-img-strip', Math.round(ir.w) + 'x' + Math.round(ir.h));
      if (br.w > 0.5 && (ir.w / br.w < 0.7 || ir.h / br.h < 0.7)) {
        add('sticker-img-underfills', Math.round(ir.w) + 'x' + Math.round(ir.h) + ' in ' + Math.round(br.w));
      }
    }
  }

  // 6. The page never scrolls sideways, and the cluster never covers the action row.
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) add('page-scroll-x', de.scrollWidth + '>' + de.clientWidth);
  // The DOCKED panel takes layout space by contract (Stage 38.0.3) — it may never sit on
  // the game's action row. The floating drawer and the modal sheet are overlays by design.
  const actions = one('.probe-actions');
  const dockedPanel = document.querySelector('.chat-drawer--docked') ? panel : null;
  if (actions && dockedPanel && hit(dockedPanel, actions)) add('panel-covers-actions', 'overlap');
  // The caller's utility panel and the chat are mutually exclusive; if both were ever on
  // screen at once they must not overlap (Poker's history button rides beside chat).
  const utilPanel = one('.probe-utility-panel');
  if (utilPanel && list && hit(utilPanel, list)) add('utility-covers-chat', 'overlap');

  return {
    violations: v,
    hist: Math.round(histVisible),
    panelH: panel ? Math.round(panel.h) : 0,
    pick: picker ? Math.round(picker.h) : 0,
    stickers: thumbs.length,
    calls: (window.__socialCalls || []).length,
    text: (document.querySelector('.chat-input') || {}).value || '',
    anchor: (document.querySelector('.reaction-anchor') || {}).className || '',
  };
})())`;

const VIEWPORTS = [
  { tag: '360', w: 360, h: 800, mobile: true },
  { tag: '390', w: 390, h: 844, mobile: true },
  { tag: '768', w: 768, h: 1024, mobile: true },
  { tag: '1366', w: 1366, h: 900, mobile: false },
];

const VARIANTS = ['floating', 'docked', 'sheet'];

function scenarios(variant) {
  return [
    { name: 'collapsed', q: `variant=${variant}&panel=none` },
    { name: 'chat', q: `variant=${variant}&panel=chat` },
    { name: 'picker', q: `variant=${variant}&panel=chat`, click: ['.chat-picker-btn'] },
    { name: 'emoji-to-message', q: `variant=${variant}&panel=chat`, click: ['.chat-picker-btn'], act: 'insert' },
    { name: 'emoji-to-table', q: `variant=${variant}&panel=chat`, click: ['.chat-picker-btn'], act: 'table' },
    { name: 'sticker', q: `variant=${variant}&panel=chat`, click: ['.chat-picker-btn'], act: 'sticker' },
    { name: 'rtl-picker', q: `variant=${variant}&panel=chat&dir=rtl&lang=ar`, click: ['.chat-picker-btn'] },
    { name: 'utility', q: `variant=${variant}&panel=utility&util=1` },
    { name: 'reaction-anchor', q: `variant=${variant}&panel=none&react=1&seat=0&seats=4`, anchor: 'reaction-anchor--left' },
  ];
}

/** Type "ab", put the caret between them, tap an emoji: it must land at the caret. */
const INSERT_AT_CARET = `(async () => {
  const el = document.querySelector('.chat-input');
  if (!el) return { ok: false, why: 'no input' };
  el.focus();
  document.execCommand('insertText', false, 'ab');
  el.setSelectionRange(1, 1);
  const btn = document.querySelector('.chat-picker .reaction-bar__btn');
  if (!btn) return { ok: false, why: 'no emoji' };
  btn.click();
  await new Promise((r) => requestAnimationFrame(() => r()));
  return { ok: true, value: document.querySelector('.chat-input').value };
})()`;

const SEND_TO_TABLE = `(async () => {
  const el = document.querySelector('.chat-input');
  el.focus();
  document.execCommand('insertText', false, 'hi');
  const mode = document.querySelector('.chat-picker__mode[data-mode="table"]');
  if (!mode) return { ok: false, why: 'no table mode' };
  mode.click();
  await new Promise((r) => requestAnimationFrame(() => r()));
  const btn = document.querySelector('.chat-picker .reaction-bar__btn');
  btn.click();
  await new Promise((r) => requestAnimationFrame(() => r()));
  return { ok: true, value: document.querySelector('.chat-input').value };
})()`;

const SEND_STICKER = `(async () => {
  const btn = document.querySelector('.chat-picker .chat-media-thumb');
  if (!btn) return { ok: false, why: 'no sticker' };
  btn.click();
  await new Promise((r) => requestAnimationFrame(() => r()));
  return { ok: true };
})()`;

async function main() {
  const vite = spawn(`npx vite --port ${VITE_PORT} --strictPort`, { shell: true, stdio: 'ignore' });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${process.env.TEMP || '/tmp'}/kg-social-qa`, 'about:blank',
  ], { stdio: 'ignore' });

  const failures = [];
  let checks = 0;
  const measured = [];
  try {
    await waitHttp(BASE);
    await waitDevtools();
    for (const vp of VIEWPORTS) {
      console.log(`\n[${vp.tag} ${vp.w}x${vp.h}]`);
      const targets = await fetchJson('/json');
      const page = targets.find((t) => t.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
      });

      for (const variant of VARIANTS) {
        for (const sc of scenarios(variant).filter((x) => !ONLY || `${variant}/${x.name}`.includes(ONLY))) {
          await cdp.send('Page.navigate', { url: `${BASE}?${sc.q}` });
          let mounted = false;
          for (let i = 0; i < 60; i++) {
            if (await cdp.evaluate("!!document.querySelector('.probe-table')")) { mounted = true; break; }
            await sleep(100);
          }
          if (!mounted) { failures.push(`${vp.tag} ${variant}/${sc.name}: NOTHING rendered`); continue; }
          if (LEGACY) {
            await cdp.evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(LEGACY_CSS)}; document.head.appendChild(s); return true; })()`);
          }
          const settled = await cdp.evaluate(SETTLE);
          if (!settled || settled.ready !== true) failures.push(`${vp.tag} ${variant}/${sc.name}: harness never signalled ready`);

          for (const sel of sc.click ?? []) {
            const clicked = await cdp.evaluate(
              `(() => { const el = document.querySelector('${sel}'); if (!el) return false; el.click(); return true; })()`);
            if (!clicked) failures.push(`${vp.tag} ${variant}/${sc.name}: cannot click ${sel}`);
          }
          await cdp.evaluate(SETTLE);

          if (sc.act === 'insert') {
            const r = await cdp.evaluate(INSERT_AT_CARET);
            if (!r?.ok) failures.push(`${vp.tag} ${variant}/${sc.name}: ${r?.why ?? 'insert failed'}`);
            else if (!/^a.+b$/u.test(String(r.value))) {
              failures.push(`${vp.tag} ${variant}/${sc.name}: emoji did not land at the caret (value="${r.value}")`);
            }
            const calls = await cdp.evaluate('JSON.stringify(window.__socialCalls||[])');
            if (JSON.parse(calls).length !== 0) {
              failures.push(`${vp.tag} ${variant}/${sc.name}: typing an emoji SENT something (${calls})`);
            }
          }
          if (sc.act === 'table') {
            const r = await cdp.evaluate(SEND_TO_TABLE);
            if (!r?.ok) failures.push(`${vp.tag} ${variant}/${sc.name}: ${r?.why ?? 'table send failed'}`);
            else if (r.value !== 'hi') failures.push(`${vp.tag} ${variant}/${sc.name}: a table reaction changed the text ("${r.value}")`);
            const calls = JSON.parse(await cdp.evaluate('JSON.stringify(window.__socialCalls||[])'));
            const reacts = calls.filter((c) => c.kind === 'react');
            if (reacts.length !== 1) failures.push(`${vp.tag} ${variant}/${sc.name}: react fired ${reacts.length}x`);
          }
          if (sc.act === 'sticker') {
            const r = await cdp.evaluate(SEND_STICKER);
            if (!r?.ok) failures.push(`${vp.tag} ${variant}/${sc.name}: ${r?.why ?? 'sticker send failed'}`);
            const calls = JSON.parse(await cdp.evaluate('JSON.stringify(window.__socialCalls||[])'));
            const media = calls.filter((c) => c.kind === 'media');
            if (media.length !== 1) failures.push(`${vp.tag} ${variant}/${sc.name}: sticker fired ${media.length}x`);
          }
          if (sc.act) {
            // Nothing a send does may close the chat or the picker.
            const stillOpen = await cdp.evaluate(
              "!!document.querySelector('.chat-drawer__list') && !!document.querySelector('.chat-picker')");
            if (!stillOpen) failures.push(`${vp.tag} ${variant}/${sc.name}: the send CLOSED the chat or the picker`);
            await cdp.evaluate(SETTLE);
          }

          const res = JSON.parse(await cdp.evaluate(PROBE));
          checks++;
          if (sc.name !== 'collapsed' && sc.name !== 'utility' && sc.name !== 'reaction-anchor' && !res.hist) {
            failures.push(`${vp.tag} ${variant}/${sc.name}: no chat history rendered`);
          }
          if (sc.click?.includes('.chat-picker-btn') && !res.pick) {
            failures.push(`${vp.tag} ${variant}/${sc.name}: the picker never opened`);
          }
          if (sc.anchor && !res.anchor.includes(sc.anchor)) {
            failures.push(`${vp.tag} ${variant}/${sc.name}: reaction anchored "${res.anchor}", expected ${sc.anchor}`);
          }
          for (const violation of res.violations) failures.push(`${vp.tag} ${variant}/${sc.name}: ${violation}`);
          if (SHOTS) {
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            if (shot?.result?.data) writeFileSync(`${SHOTS}/${LEGACY ? 'RED-' : ''}${vp.tag}-${variant}-${sc.name}.png`, Buffer.from(shot.result.data, 'base64'));
          }
          const meta = `hist${res.hist}/pick${res.pick}/panel${res.panelH}`;
          measured.push(`${vp.tag} ${variant}/${sc.name} ${meta}`);
          console.log(`  ${(variant + '/' + sc.name).padEnd(26)} ${meta.padEnd(24)} ${res.violations.length ? `FAIL(${res.violations.length}) ${res.violations.slice(0, 2).join(' | ')}` : 'ok'}`);
        }
      }
      cdp.close();
    }
  } finally {
    chrome.kill();
    if (vite) vite.kill();
  }

  console.log(`\n${checks} RoomSocial layout checks run.`);
  console.log('measurements (history/picker/panel px):');
  for (const m of measured.filter((x) => x.includes('/picker '))) console.log(`  ${m}`);
  if (failures.length) {
    console.log(`\n${failures.length} violations:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('SOCIAL LAYOUT OK — one chat control, one contract, history alive beside the picker.');
}

main().catch((e) => { console.error(e); process.exit(1); });
