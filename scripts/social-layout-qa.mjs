// ---------------------------------------------------------------------------
// GENERIC social LAYOUT + BEHAVIOUR gate (Stage 38.0.12, rebuilt for Stage 38.0.13).
//
//   node scripts/social-layout-qa.mjs [--shots <dir>] [--only <substr>] [--legacy]
//
// WHY IT WAS REBUILT. The 38.0.12 gate mounted RoomSocial ON ITS OWN, so it could only
// prove the three LAYOUT VARIANTS agreed with each other about the chat's INNER parts.
// The owner's production FAIL was between GAMES and about the SHELL: Durak opened a tall
// fixed right-hand drawer, 51 opened a compact modal card, Poker opened an in-flow box —
// same component, same viewport, three different chats. This gate now runs two phases:
//
//   PHASE A — the isolated variant harness (scripts/layout-harness/social.html):
//     one chat control, bounded picker, history floor, square stickers, RTL, tap targets.
//   PHASE B — the REAL online branches (scripts/layout-harness/social-games.html):
//     Durak (floating cluster), Fifty-One (sheet launcher), Poker (docked toolbar). The
//     OPEN CHAT of all three must be the SAME element with the SAME geometry, the same
//     backdrop, the same radius and the same inner DOM at the same viewport.
//
// Behaviour is driven with REAL CDP mouse input (`Input.dispatchMouseEvent`) and REAL
// typing (`Input.insertText`), never `el.click()` — the whole emoji contract now hangs on
// which element has focus, and a synthetic `click()` cannot move focus at all. It proves:
//   focused input + emoji → inserted at the caret, nothing sent, focus kept;
//   blurred input + emoji → exactly one table reaction, the draft untouched;
//   tapping the history blurs the field and flips the next emoji to the table;
//   the picker button and the emoji buttons never steal focus;
//   a sticker is always chat media, focused or not, exactly once;
//   and nothing above ever closes the chat or the picker.
//
// `--legacy` re-applies the pre-38.0.12 CSS caps so that RED can be reproduced on demand.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const WebSocket = createRequire(`${process.cwd()}/package.json`)('ws');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9254;
const VITE_PORT = 5201;
const ORIGIN = `http://localhost:${VITE_PORT}`;
const BASE = `${ORIGIN}/scripts/layout-harness/social.html`;
const GAMES_BASE = `${ORIGIN}/scripts/layout-harness/social-games.html`;

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
  async json(expression) {
    const raw = await this.evaluate(`JSON.stringify(${expression})`);
    try { return JSON.parse(raw); } catch { return null; }
  }
  /** A REAL mouse click at the element's centre — the only kind that moves focus. */
  async click(sel) {
    const box = await this.json(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null; const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 18) }; })()`);
    if (!box) return false;
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await this.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    return true;
  }
  /** REAL typing into whatever currently holds focus (fires React's onChange). */
  async type(text) {
    await this.send('Input.insertText', { text });
    await this.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  }
}

// The RED: the caps this stage replaced. `--legacy` re-applies them so the failure can
// be reproduced on demand instead of being described.
const LEGACY_CSS = `
  .chat-picker { max-height: 34vh !important; }
  .chat-dialog__list { min-height: 0 !important; }
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

// Shared in-page helpers. Version-agnostic on purpose: the chat shell is found through
// the message list, so this same probe measures the OLD drawer/sheet and the NEW dialog
// and can therefore record the RED as well as the GREEN.
const HELPERS = `
  const S = 0.5;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const live = (r) => !!r && r.w > 0.5 && r.h > 0.5;
  const q = (sel) => document.querySelector(sel);
  const one = (sel) => { const el = q(sel); return el ? rect(el) : null; };
  const listNode = () => q('.chat-dialog__list, .chat-drawer__list');
  const shellNode = () => { const l = listNode(); return l ? l.closest('.chat-dialog, .chat-drawer, .social-sheet') : null; };
  const backdropNode = () => q('.chat-dialog-backdrop, .social-sheet-backdrop');
  const composeNode = () => q('.chat-dialog__compose, .chat-drawer__compose');
  const hit = (a, b) => !!a && !!b && a.l < b.r - S && b.l < a.r - S && a.t < b.b - S && b.t < a.b - S;
  const visibleH = (el) => {
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
`;

// --- the shared chat probe ------------------------------------------------------------
const PROBE = `JSON.stringify((() => {
  ${HELPERS}
  const all = (sel) => [...document.querySelectorAll(sel)].filter((e) => live(rect(e)));
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

  // 3. The manual picker-mode switch is GONE (38.0.13) — the DOM must not carry it back.
  const html = document.body.innerHTML;
  for (const banned of ['chat-picker__mode', 'data-mode="message"', 'data-mode="table"']) {
    if (html.includes(banned)) add('picker-mode-switch', banned);
  }

  // 4. The open chat: history + composer + Send + picker button, inside the viewport.
  const shellEl = shellNode();
  const shell = shellEl ? rect(shellEl) : null;
  const list = listNode() ? rect(listNode()) : null;
  const compose = composeNode() ? rect(composeNode()) : null;
  const send = one('.chat-dialog__compose [type="submit"], .chat-drawer__compose [type="submit"]');
  const pickerBtn = one('.chat-picker-btn');
  const picker = one('.chat-picker');
  if (shell && list) {
    if (!live(list)) add('history-missing', 'zero size');
    if (!live(compose)) add('composer-missing', 'zero size');
    if (!live(send)) add('send-missing', 'zero size');
    if (!live(pickerBtn)) add('picker-button-missing', 'zero size');
    if (shell.b > vh + S) add('panel-below-viewport', Math.round(shell.b) + '>' + vh);
    if (shell.l < -S || shell.r > vw + S) add('panel-outside-viewport', Math.round(shell.l) + '..' + Math.round(shell.r));
    if (compose && compose.b > vh + S) add('composer-below-viewport', Math.round(compose.b) + '>' + vh);
  }

  // 5. With the picker open the HISTORY must survive beside it, and the composer stay put.
  const histVisible = visibleH(listNode());
  if (picker && live(picker)) {
    if (histVisible < 96) add('history-squeezed', Math.round(histVisible) + 'px');
    if (shell && histVisible / shell.h < 0.2) {
      add('history-share', Math.round(100 * histVisible / shell.h) + '% of ' + Math.round(shell.h));
    }
    if (picker.h > 0.5 * vh + S) add('picker-too-tall', Math.round(picker.h) + '>' + Math.round(0.5 * vh));
    if (picker.b > vh + S) add('picker-below-viewport', Math.round(picker.b) + '>' + vh);
    if (hit(picker, list)) add('picker-covers-history', 'overlap');
    if (compose && hit(picker, compose)) add('picker-covers-composer', 'overlap');
    const pk = q('.chat-picker');
    if (pk && pk.scrollWidth > pk.clientWidth + 1) add('picker-scroll-x', pk.scrollWidth + '>' + pk.clientWidth);
    for (const el of pk.querySelectorAll('*')) {
      const st = getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll')
        && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1) {
        add('picker-nested-scroll', (el.className || '?').toString().split(' ')[0]);
      }
    }
  }

  // 6. Sticker cells: square, image fills them, no overlap, no sideways scroll.
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

  // 7. The page never scrolls sideways.
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) add('page-scroll-x', de.scrollWidth + '>' + de.clientWidth);
  // The caller's utility panel and the chat are mutually exclusive; if both were ever on
  // screen at once they must not overlap.
  const utilPanel = one('.probe-utility-panel, .poker-log-panel');
  if (utilPanel && list && hit(utilPanel, list)) add('utility-covers-chat', 'overlap');

  // 8. The chat SHELL signature — what PHASE B compares across the seven games.
  const st = shellEl ? getComputedStyle(shellEl) : null;
  const bd = backdropNode();
  const sig = shellEl ? {
    cls: shellEl.className,
    position: st.position,
    radius: st.borderRadius,
    backdrop: bd ? getComputedStyle(bd).backgroundColor : 'none',
    w: Math.round(shell.w), h: Math.round(shell.h),
    l: Math.round(shell.l), t: Math.round(shell.t),
    dom: [...shellEl.children].map((c) => (c.className || c.tagName).toString().split(' ')[0]).join('|'),
  } : null;

  return {
    violations: v,
    hist: Math.round(histVisible),
    panelH: shell ? Math.round(shell.h) : 0,
    pick: picker ? Math.round(picker.h) : 0,
    stickers: thumbs.length,
    sig,
    calls: (window.__socialCalls || []).length,
    text: (q('.chat-input') || {}).value || '',
    anchor: (q('.reaction-anchor') || {}).className || '',
  };
})())`;

/** Snapshot of everything a behaviour scenario asserts on. */
const STATE = `JSON.stringify((() => {
  ${HELPERS}
  const input = q('.chat-input');
  return {
    text: input ? input.value : null,
    focused: !!input && document.activeElement === input,
    active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName).toString() : '',
    chatOpen: !!listNode(),
    pickerOpen: !!q('.chat-picker'),
    calls: window.__socialCalls || [],
    hint: (q('.chat-picker__hint') || {}).textContent || '',
  };
})())`;

const VIEWPORTS = [
  { tag: '360', w: 360, h: 800, mobile: true },
  { tag: '390', w: 390, h: 844, mobile: true },
  { tag: '768', w: 768, h: 1024, mobile: true },
  { tag: '1366', w: 1366, h: 900, mobile: false },
];

const VARIANTS = ['floating', 'docked', 'sheet'];

/** PHASE B: the three REAL online branches, one per launcher layout. */
const GAMES = [
  { tag: 'durak', q: 'game=durak&seats=4' },
  { tag: 'fiftyone', q: 'game=fiftyone&seats=4' },
  { tag: 'poker', q: 'game=poker&seats=4' },
];

function scenarios(variant) {
  return [
    { name: 'collapsed', q: `variant=${variant}&panel=none` },
    { name: 'chat', q: `variant=${variant}&panel=chat` },
    { name: 'picker', q: `variant=${variant}&panel=chat`, picker: true },
    { name: 'emoji-focused', q: `variant=${variant}&panel=chat`, picker: true, act: 'focused-caret' },
    { name: 'emoji-blurred', q: `variant=${variant}&panel=chat`, picker: true, act: 'blurred-draft' },
    { name: 'sticker', q: `variant=${variant}&panel=chat`, picker: true, act: 'sticker' },
    { name: 'rtl-picker', q: `variant=${variant}&panel=chat&dir=rtl&lang=ar`, picker: true },
    { name: 'utility', q: `variant=${variant}&panel=utility&util=1` },
    { name: 'reaction-anchor', q: `variant=${variant}&panel=none&react=1&seat=0&seats=4`, anchor: 'reaction-anchor--left' },
  ];
}

const EMOJI = '.chat-picker .reaction-bar__btn';
const STICKER = '.chat-picker .chat-media-thumb';
const HISTORY = '.chat-dialog__list, .chat-drawer__list';

/**
 * The focus-based emoji contract, driven with REAL input. Returns the violations it
 * found so the caller can label them with the viewport/variant/game.
 */
async function runBehaviour(cdp, act, label) {
  const bad = [];
  const state = async () => JSON.parse(await cdp.evaluate(STATE));
  const setCaret = (a, b) => cdp.evaluate(
    `(() => { const el = document.querySelector('.chat-input'); if (!el) return false; el.setSelectionRange(${a}, ${b}); return true; })()`);

  if (act === 'focused-caret') {
    // Type "ab", put the caret between them, then tap an emoji: it lands at the caret,
    // wipes nothing, sends nothing, and the field keeps focus AND the keyboard.
    if (!await cdp.click('.chat-input')) bad.push('cannot click the input');
    await cdp.type('ab');
    await setCaret(1, 1);
    const before = await state();
    if (!before.focused) bad.push('the input did not take focus from a real tap');
    if (before.text !== 'ab') bad.push(`typing produced "${before.text}"`);
    // Opening the picker must NOT steal focus from the field.
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    const afterPicker = await state();
    if (!afterPicker.pickerOpen) bad.push('the picker never opened');
    if (!afterPicker.focused) bad.push(`the picker button STOLE focus (active=${afterPicker.active})`);
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const after = await state();
    if (!/^a.+b$/u.test(after.text ?? '')) bad.push(`emoji did not land at the caret (value="${after.text}")`);
    if (!after.focused) bad.push(`the emoji button STOLE focus (active=${after.active})`);
    if (after.calls.length !== 0) bad.push(`typing an emoji SENT something (${JSON.stringify(after.calls)})`);
  }

  if (act === 'blurred-draft') {
    // A draft is typed, then the player taps the HISTORY: the field loses focus, so the
    // very next emoji goes to the TABLE — once — and the draft is untouched.
    if (!await cdp.click('.chat-input')) bad.push('cannot click the input');
    await cdp.type('hi');
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    if (!await cdp.click(HISTORY)) bad.push('cannot click the history');
    const blurred = await state();
    if (blurred.focused) bad.push('tapping the history did not blur the field');
    if (!blurred.pickerOpen) bad.push('tapping the history closed the picker');
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const after = await state();
    const reacts = after.calls.filter((c) => c.kind === 'react');
    if (reacts.length !== 1) bad.push(`react fired ${reacts.length}x`);
    if (after.text !== 'hi') bad.push(`a table reaction changed the draft ("${after.text}")`);
    if (after.focused) bad.push('a table reaction pulled focus back into the field');
  }

  if (act === 'blurred-empty') {
    // Picker opened without ever touching the field → the emoji goes to the table.
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    const opened = await state();
    if (opened.focused) bad.push('the picker button focused the field on its own');
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const after = await state();
    const reacts = after.calls.filter((c) => c.kind === 'react');
    if (reacts.length !== 1) bad.push(`react fired ${reacts.length}x`);
    if (after.text !== '') bad.push(`the field gained text ("${after.text}")`);
  }

  if (act === 'focus-switch') {
    // One session, both intents: tap the field → insert; tap the history → table.
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    if (!await cdp.click('.chat-input')) bad.push('cannot click the input');
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const inserted = await state();
    if ((inserted.text ?? '').length === 0) bad.push('a focused tap inserted nothing');
    if (inserted.calls.length !== 0) bad.push('a focused tap SENT something');
    if (!await cdp.click(HISTORY)) bad.push('cannot click the history');
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const after = await state();
    if (after.calls.filter((c) => c.kind === 'react').length !== 1) bad.push('the blurred tap did not send exactly one reaction');
    if (after.text !== inserted.text) bad.push(`the blurred tap changed the message ("${after.text}")`);
  }

  if (act === 'sticker') {
    // A sticker is chat media whatever the focus is — and it never closes anything.
    if (!await cdp.click('.chat-input')) bad.push('cannot click the input');
    await cdp.type('hi');
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    if (!await cdp.click(STICKER)) bad.push('cannot click a sticker');
    const after = await state();
    const media = after.calls.filter((c) => c.kind === 'media');
    if (media.length !== 1) bad.push(`sticker fired ${media.length}x`);
    if (after.calls.some((c) => c.kind === 'react')) bad.push('a sticker also sent a table reaction');
    if (after.text !== 'hi') bad.push(`a sticker changed the draft ("${after.text}")`);
  }

  if (act) {
    const end = await state();
    if (!end.chatOpen || !end.pickerOpen) bad.push('the action CLOSED the chat or the picker');
  }
  return bad.map((b) => `${label}: ${b}`);
}

async function newPage(vp) {
  const targets = await fetchJson('/json');
  const page = targets.find((t) => t.type === 'page');
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // A headless page has no system focus. Real mouse input still focuses fields, but
  // emulating focus makes the page behave like a phone in the player's hand throughout.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile,
  });
  return cdp;
}

async function load(cdp, url, marker) {
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 80; i++) {
    if (await cdp.evaluate(`!!document.querySelector('${marker}')`)) {
      if (LEGACY) {
        await cdp.evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(LEGACY_CSS)}; document.head.appendChild(s); return true; })()`);
      }
      const settled = await cdp.evaluate(SETTLE);
      return settled?.ready === true;
    }
    await sleep(100);
  }
  return null;
}

async function main() {
  const vite = spawn(`npx vite --port ${VITE_PORT} --strictPort`, { shell: true, stdio: 'ignore' });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${process.env.TEMP || '/tmp'}/kg-social-qa`, 'about:blank',
  ], { stdio: 'ignore' });

  const failures = [];
  let checks = 0;
  const measured = [];
  /** viewport+dir → game → shell signature (PHASE B's equality proof). */
  const shells = new Map();
  try {
    await waitHttp(BASE);
    await waitDevtools();

    for (const vp of VIEWPORTS) {
      console.log(`\n[${vp.tag} ${vp.w}x${vp.h}]`);
      const cdp = await newPage(vp);

      // ---- PHASE A: the isolated variant harness --------------------------------------
      for (const variant of VARIANTS) {
        for (const sc of scenarios(variant).filter((x) => !ONLY || `${variant}/${x.name}`.includes(ONLY))) {
          const label = `${vp.tag} ${variant}/${sc.name}`;
          const ok = await load(cdp, `${BASE}?${sc.q}`, '.probe-table');
          if (ok === null) { failures.push(`${label}: NOTHING rendered`); continue; }
          if (!ok) failures.push(`${label}: harness never signalled ready`);

          if (sc.picker && !sc.act) {
            if (!await cdp.click('.chat-picker-btn')) failures.push(`${label}: cannot click the picker button`);
            await cdp.evaluate(SETTLE);
          }
          if (sc.act) {
            failures.push(...await runBehaviour(cdp, sc.act, label));
            await cdp.evaluate(SETTLE);
          }

          const res = JSON.parse(await cdp.evaluate(PROBE));
          checks++;
          if (!['collapsed', 'utility', 'reaction-anchor'].includes(sc.name) && !res.hist) {
            failures.push(`${label}: no chat history rendered`);
          }
          if (sc.picker && !res.pick) failures.push(`${label}: the picker never opened`);
          if (sc.anchor && !res.anchor.includes(sc.anchor)) {
            failures.push(`${label}: reaction anchored "${res.anchor}", expected ${sc.anchor}`);
          }
          for (const violation of res.violations) failures.push(`${label}: ${violation}`);
          if (SHOTS) {
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            if (shot?.result?.data) writeFileSync(`${SHOTS}/${LEGACY ? 'RED-' : ''}${vp.tag}-${variant}-${sc.name}.png`, Buffer.from(shot.result.data, 'base64'));
          }
          const meta = `hist${res.hist}/pick${res.pick}/panel${res.panelH}`;
          measured.push(`${vp.tag} ${variant}/${sc.name} ${meta}`);
          console.log(`  ${(variant + '/' + sc.name).padEnd(26)} ${meta.padEnd(24)} ${res.violations.length ? `FAIL(${res.violations.length}) ${res.violations.slice(0, 2).join(' | ')}` : 'ok'}`);
        }
      }

      // ---- PHASE B: the REAL online branches ------------------------------------------
      for (const dirTag of ['ltr', 'rtl']) {
        for (const g of GAMES) {
          const name = `${g.tag}/${dirTag}`;
          if (ONLY && !name.includes(ONLY)) continue;
          const label = `${vp.tag} ${name}`;
          const dirQ = dirTag === 'rtl' ? '&dir=rtl&lang=ar' : '';
          const ok = await load(cdp, `${GAMES_BASE}?${g.q}${dirQ}&chat=8`, '#root > *');
          if (ok === null) { failures.push(`${label}: NOTHING rendered`); continue; }

          // Open the chat through the game's OWN launcher — the production path.
          const launcher = '.social-menu__launcher, .social-controls__row .social-fab';
          const opened = await cdp.evaluate(`(() => {
            const btns = [...document.querySelectorAll('${launcher}')].filter((b) => (b.textContent || '').includes('💬'));
            if (btns.length !== 1) return btns.length;
            btns[0].click();
            return true;
          })()`);
          if (opened !== true) { failures.push(`${label}: expected exactly one 💬 launcher, found ${opened}`); continue; }
          await cdp.evaluate(SETTLE);
          if (!await cdp.click('.chat-picker-btn')) failures.push(`${label}: cannot open the picker`);
          await cdp.evaluate(SETTLE);

          const res = JSON.parse(await cdp.evaluate(PROBE));
          checks++;
          if (!res.sig) { failures.push(`${label}: the chat never opened`); continue; }
          for (const violation of res.violations) failures.push(`${label}: ${violation}`);
          const key = `${vp.tag}/${dirTag}`;
          if (!shells.has(key)) shells.set(key, new Map());
          shells.get(key).set(g.tag, res.sig);
          if (SHOTS) {
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            if (shot?.result?.data) writeFileSync(`${SHOTS}/${LEGACY ? 'RED-' : ''}${vp.tag}-${g.tag}-${dirTag}-chat.png`, Buffer.from(shot.result.data, 'base64'));
          }
          const s = res.sig;
          const meta = `${s.cls.split(' ')[0]} ${s.w}x${s.h}@${s.l},${s.t} r=${s.radius} bd=${s.backdrop === 'none' ? 'none' : 'yes'}`;
          measured.push(`${vp.tag} ${name} ${meta}`);
          console.log(`  ${name.padEnd(26)} ${meta}`);

          // Behaviour is proved once per game, on the phone width the owner uses.
          if (vp.tag === '390' && dirTag === 'ltr') {
            for (const act of ['focused-caret', 'blurred-empty', 'blurred-draft', 'focus-switch', 'sticker']) {
              const ok2 = await load(cdp, `${GAMES_BASE}?${g.q}&chat=8&panel=chat`, '#root > *');
              if (ok2 === null) { failures.push(`${label}/${act}: NOTHING rendered`); continue; }
              failures.push(...await runBehaviour(cdp, act, `${label}/${act}`));
              checks++;
            }
          }
        }
      }
      cdp.close();
    }

    // ---- PHASE B verdict: one shell, one geometry, one inner DOM --------------------
    for (const [key, byGame] of shells) {
      const entries = [...byGame.entries()];
      if (entries.length < 2) continue;
      const [refName, ref] = entries[0];
      for (const [name, sig] of entries.slice(1)) {
        for (const field of ['cls', 'position', 'radius', 'backdrop', 'dom', 'w', 'h', 'l', 't']) {
          const a = ref[field], b = sig[field];
          const same = typeof a === 'number' ? Math.abs(a - b) <= 1 : a === b;
          if (!same) failures.push(`${key}: ${refName} and ${name} disagree on the chat ${field} — "${a}" vs "${b}"`);
        }
      }
      checks++;
    }
  } finally {
    chrome.kill();
    if (vite) vite.kill();
  }

  console.log(`\n${checks} social layout checks run.`);
  console.log('chat shell per game (the 38.0.13 contract):');
  for (const m of measured.filter((x) => /durak|fiftyone|poker/.test(x))) console.log(`  ${m}`);
  if (failures.length) {
    console.log(`\n${failures.length} violations:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('SOCIAL LAYOUT OK — one chat dialog for every game, focus decides the emoji.');
}

main().catch((e) => { console.error(e); process.exit(1); });
