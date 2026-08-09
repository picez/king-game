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
// typing (`Input.insertText`), never `el.click()` — a synthetic `click()` cannot move
// focus, so it cannot tell a typist's tap from a bystander's.
//
// (38.0.15) The emoji destination is EXPLICIT: two labelled rows, «into your message» and
// «on the table». 38.0.13 derived it from focus instead, and one tap therefore did two
// different things depending on state the player cannot see — type a draft, scroll the
// history or let the phone dismiss the keyboard, and the next emoji flew onto the table
// rather than joining the sentence. Each row is now proved in BOTH focus states:
//   message row + caret  → inserted at the caret, nothing sent, focus and keyboard kept;
//   message row + blurred → APPENDED to the draft, nothing sent (the owner's case);
//   table row + typing   → exactly one reaction, draft, caret and focus untouched;
//   table row + blurred  → exactly one reaction, the empty draft stays empty;
//   a sticker is always chat media, focused or not, exactly once;
//   the picker button and every emoji button never steal focus;
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
  /**
   * A REAL mouse click at the element's centre — the only kind that moves focus. The
   * target is scrolled into view first, because since Stage 38.0.14 the social cluster is
   * IN FLOW: on a tall board a control can sit below the fold, which a player reaches by
   * scrolling. A click dispatched at off-screen coordinates would simply miss.
   */
  async click(sel) {
    // `scrollIntoView` alone is not enough for a target inside the picker's own scroller:
    // at 1366 the browser satisfied it by scrolling the PAGE and left the element clipped
    // below the picker (measured: thumb top 839, picker bottom 828, scrollTop 0), so the
    // click landed on whatever sat underneath. Centre it in its own scroller too — which
    // is exactly what a player's thumb does to reach the stickers.
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      for (let p = el.parentElement; p; p = p.parentElement) {
        const st = getComputedStyle(p);
        if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 1) {
          const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
          p.scrollTop += (r.top + r.height / 2) - (pr.top + pr.height / 2);
          break;
        }
      }
      return true;
    })()`);
    const box = await this.json(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null;
      let r = e.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) { e.scrollIntoView({ block: 'center' }); r = e.getBoundingClientRect(); }
      if (r.width < 1 || r.height < 1) return null;
      if (r.bottom < 0 || r.top > window.innerHeight) return null;
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
  const listNode = () => q('.chat-panel__list, .chat-dialog__list, .chat-drawer__list');
  const shellNode = () => { const l = listNode(); return l ? l.closest('.chat-panel, .chat-dialog, .chat-drawer, .social-sheet') : null; };
  const backdropNode = () => q('.chat-dialog-backdrop, .social-sheet-backdrop');
  const composeNode = () => q('.chat-panel__compose, .chat-dialog__compose, .chat-drawer__compose');
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
  const outer = [...document.querySelectorAll('.room-social__bar .social-fab, .social-controls__row .social-fab, .social-menu__launcher')];
  const chatBtns = outer.filter((b) => (b.textContent || '').includes('💬'));
  const emojiBtns = outer.filter((b) => (b.textContent || '').trim().startsWith('😀'));
  if (chatBtns.length !== 1) add('outer-chat-controls', String(chatBtns.length));
  if (emojiBtns.length !== 0) add('outer-reactions-control', String(emojiBtns.length));

  // 2. Tap targets of every social control.
  for (const b of outer) {
    const r = rect(b);
    if (live(r) && (r.w < 43.5 || r.h < 43.5)) add('control-small', Math.round(r.w) + 'x' + Math.round(r.h));
  }

  // 3. The manual picker-MODE switch stays gone (38.0.13): a destination is picked by the
  //    row a thumb lands on, never by a mode the player has to set and then remember.
  const html = document.body.innerHTML;
  for (const banned of ['chat-picker__mode', 'data-mode="message"', 'data-mode="table"']) {
    if (html.includes(banned)) add('picker-mode-switch', banned);
  }
  // 3b. (38.0.15 corrective — owner FAIL) The picker holds exactly ONE emoji container and
  //     each emoji EXACTLY ONCE. The rejected build had two labelled rows: measured on the
  //     real branches, emojiContainers 2 and 14 buttons for 7 emoji, every one of them
  //     twice. A duplicate must fail here whatever it is called, so the probe counts the
  //     containers by shape (any emoji-bearing block in the picker), not by one class name.
  if (q('.chat-picker')) {
    const btns = [...document.querySelectorAll('.chat-picker .reaction-bar__btn')];
    const boxes = new Set(btns.map((b) => b.parentElement));
    const chars = btns.map((b) => (b.textContent || '').trim());
    const dupes = [...new Set(chars.filter((c, i) => chars.indexOf(c) !== i))];
    if (boxes.size !== 1) add('emoji-containers', String(boxes.size));
    if (document.querySelectorAll('.chat-picker__emoji').length !== 1) {
      add('emoji-container-class', String(document.querySelectorAll('.chat-picker__emoji').length));
    }
    if (dupes.length) add('emoji-duplicated', dupes.join('') + ' in ' + btns.length + ' buttons');
    // No destination heading may survive — deleted, not hidden.
    if (q('.chat-picker__hint') || q('.chat-picker__section')) add('destination-heading', 'present');
    if (/У повідомлення|На стіл|Into your message|On the table|إلى رسالتك|على الطاولة|In die Nachricht|Auf den Tisch/
      .test(q('.chat-picker').textContent || '')) add('destination-label-text', 'present');
    for (const b of btns) {
      const r = rect(b);
      if (live(r) && (r.w < 43.5 || r.h < 43.5)) add('emoji-small', Math.round(r.w) + 'x' + Math.round(r.h));
    }
  }

  // 4. The open chat: history + composer + Send + picker button, inside the viewport.
  const shellEl = shellNode();
  const shell = shellEl ? rect(shellEl) : null;
  const list = listNode() ? rect(listNode()) : null;
  const compose = composeNode() ? rect(composeNode()) : null;
  const send = one('.chat-panel__compose [type="submit"], .chat-dialog__compose [type="submit"], .chat-drawer__compose [type="submit"]');
  const pickerBtn = one('.chat-picker-btn');
  const picker = one('.chat-picker');
  if (shell && list) {
    if (!live(list)) add('history-missing', 'zero size');
    if (!live(compose)) add('composer-missing', 'zero size');
    if (!live(send)) add('send-missing', 'zero size');
    if (!live(pickerBtn)) add('picker-button-missing', 'zero size');
    // (38.0.14) The panel is IN FLOW on a scrollable page, so it may legitimately run
    // past the fold — what may never happen is it starting off screen, or leaving the
    // viewport sideways, or the composer escaping the panel itself.
    if (shell.t > vh - S || shell.b < S) add('panel-off-screen', Math.round(shell.t) + '..' + Math.round(shell.b));
    if (shell.l < -S || shell.r > vw + S) add('panel-outside-viewport', Math.round(shell.l) + '..' + Math.round(shell.r));
    if (compose && (compose.t < shell.t - S || compose.b > shell.b + S)) {
      add('composer-out-of-panel', Math.round(compose.t) + '-' + Math.round(compose.b));
    }
  }

  // 5. With the picker open the HISTORY must survive beside it, and the composer stay put.
  const histVisible = visibleH(listNode());
  if (picker && live(picker)) {
    if (histVisible < 96) add('history-squeezed', Math.round(histVisible) + 'px');
    if (shell && histVisible / shell.h < 0.2) {
      add('history-share', Math.round(100 * histVisible / shell.h) + '% of ' + Math.round(shell.h));
    }
    if (picker.h > 0.5 * vh + S) add('picker-too-tall', Math.round(picker.h) + '>' + Math.round(0.5 * vh));
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
  // (38.0.14) Position/size are NOT part of it any more: the panel is in NORMAL FLOW, so
  // where it lands legitimately depends on each game's layout. What must be identical is
  // the component — its element, its flow behaviour, and its whole visual language.
  const sig = shellEl ? {
    cls: shellEl.className,
    position: st.position,
    radius: st.borderRadius,
    backdrop: bd ? getComputedStyle(bd).backgroundColor : 'none',
    bg: st.backgroundColor,
    border: st.borderTopWidth + ' ' + st.borderTopStyle + ' ' + st.borderTopColor,
    font: st.fontFamily + ' ' + st.fontSize + ' ' + st.color,
    gap: st.rowGap,
    pad: st.paddingTop + '/' + st.paddingBottom,
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
    attached: !!document.querySelector('.chat-attach'),
    emojiButtons: document.querySelectorAll('.chat-picker .reaction-bar__btn').length,
    uniqueEmoji: new Set([...document.querySelectorAll('.chat-picker .reaction-bar__btn')]
      .map((b) => (b.textContent || '').trim())).size,
  };
})())`;

const VIEWPORTS = [
  { tag: '360', w: 360, h: 800, mobile: true },
  { tag: '390', w: 390, h: 844, mobile: true },
  { tag: '768', w: 768, h: 1024, mobile: true },
  { tag: '1366', w: 1366, h: 900, mobile: false },
  { tag: '1920', w: 1920, h: 1080, mobile: false },
  { tag: '2560', w: 2560, h: 1440, mobile: false },
];

// (38.0.14) There are no layout variants left — one in-flow cluster serves every game.
const VARIANTS = ['inflow'];

/**
 * PHASE B: the REAL online branch of every game (Stage 38.0.14).
 * `action` is a LEGAL gameplay control the gate clicks WHILE the chat is open — the
 * proof that an open chat does not block the game. Games without one are still measured
 * geometrically.
 */
const GAMES = [
  { tag: 'king', q: 'game=king&seats=4', action: null },
  { tag: 'durak', q: 'game=durak&seats=4', action: '.hand-reorder-wrap .card' },
  { tag: 'deberc', q: 'game=deberc&seats=4', action: null },
  { tag: 'tarneeb', q: 'game=tarneeb&seats=4', action: null },
  { tag: 'preferans', q: 'game=preferans&seats=3', action: null },
  { tag: 'fiftyone', q: 'game=fiftyone&seats=4', action: '.fiftyone-actions .btn' },
  { tag: 'poker', q: 'game=poker&seats=4', action: '.poker-actions__primary button' },
];

/**
 * (38.0.16) The elements whose geometry may NOT change when a panel opens. Per game,
 * because "the table" is a different element in each — but the RULE is the same one:
 * closed, open and picker-open must agree to within 1px on x/y/width/height.
 */
const STAGE_GEO = {
  king: { stage: '.game-stage', board: '.game-body', hand: '.game-footer' },
  durak: { stage: '.game-stage', board: '.durak-board', felt: '.durak-board__felt',
           seat: '.durak-seat', deck: '.durak-deck', hand: '.hand-reorder-wrap', actions: '.durak-controls' },
  deberc: { stage: '.game-stage', board: '.durak-board', hand: '.hand-reorder-wrap' },
  tarneeb: { stage: '.game-stage', board: '.tarneeb-board', hand: '.hand-reorder-wrap' },
  preferans: { stage: '.game-stage', board: '.preferans-board', hand: '.hand-reorder-wrap' },
  fiftyone: { stage: '.game-stage', board: '.fiftyone-piles', melds: '.fiftyone-melds',
              hand: '.hand-reorder-wrap', actions: '.fiftyone-actions' },
  poker: { stage: '.game-stage', board: '.poker-table', hand: '.poker-hero__cards', actions: '.poker-actions' },
};

/**
 * Geometry in PAGE coordinates (rect + scroll), never viewport ones: below the rail
 * breakpoint the chat opens AFTER the scene, so the page can legitimately be scrolled
 * between states and a viewport-relative rect would report that scroll as a layout change.
 */
const geoProbe = (sels) => `JSON.stringify((() => {
  const out = {};
  for (const [k, sel] of ${JSON.stringify(Object.entries(sels))}) {
    const el = document.querySelector(sel);
    if (!el) { out[k] = null; continue; }
    const r = el.getBoundingClientRect();
    out[k] = { x: +(r.left + scrollX).toFixed(2), y: +(r.top + scrollY).toFixed(2),
               w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
  }
  out.__overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  return out;
})())`;

/** closed vs open vs picker-open: the same element, to within 1 CSS px, on all four axes. */
function geoDiff(closed, other, label) {
  const bad = [];
  for (const key of Object.keys(closed)) {
    if (key.startsWith('__')) continue;
    const a = closed[key], b = other[key];
    if (!a) continue;
    if (!b) { bad.push(`${key} disappeared when ${label}`); continue; }
    for (const axis of ['w', 'h', 'x', 'y']) {
      const d = +(b[axis] - a[axis]).toFixed(2);
      if (Math.abs(d) > 1) bad.push(`${key}.${axis} moved ${d}px when ${label} (${a[axis]} → ${b[axis]})`);
    }
  }
  if (other.__overflowX) bad.push(`horizontal overflow when ${label}`);
  return bad;
}

/** Everything a player must be able to see and press while the chat is open. */
const GAMEPLAY_ZONES = [
  '.game-body', '.game-footer', '.durak-board', '.durak-controls', '.deberc-firstdealer',
  '.tarneeb-board', '.tarneeb-centre', '.preferans-board', '.fiftyone-piles', '.fiftyone-melds',
  '.fiftyone-actions', '.poker-table', '.poker-actions', '.hand-reorder-wrap',
];

function scenarios() {
  return [
    { name: 'collapsed', q: 'panel=none' },
    { name: 'chat', q: 'panel=chat' },
    { name: 'picker', q: 'panel=chat', picker: true },
    { name: 'typing-caret', q: 'panel=chat', picker: true, act: 'typing-caret' },
    { name: 'blurred-draft', q: 'panel=chat', picker: true, act: 'blurred-draft' },
    { name: 'blurred-empty', q: 'panel=chat', picker: true, act: 'blurred-empty' },
    { name: 'opened-while-typing', q: 'panel=chat', picker: true, act: 'opened-while-typing' },
    { name: 'focus-switch', q: 'panel=chat', picker: true, act: 'focus-switch' },
    { name: 'sticker', q: 'panel=chat', picker: true, act: 'sticker' },
    { name: 'combined', q: 'panel=chat', picker: true, act: 'combined' },
    { name: 'rtl-picker', q: 'panel=chat&dir=rtl&lang=ar', picker: true },
    { name: 'utility', q: 'panel=utility&util=1' },
    { name: 'reaction-anchor', q: 'panel=none&react=1&seat=0&seats=4', anchor: 'reaction-anchor--left' },
  ];
}

/**
 * (Stage 38.0.14) The NON-BLOCKING probe. The owner's FAIL was a chat that dimmed the
 * table, swallowed every tap and froze the page scroll while the authoritative timer kept
 * running. This measures each of those separately, so a regression names itself:
 *   - a viewport backdrop exists at all;
 *   - the chat sits ON TOP of any gameplay zone;
 *   - `elementFromPoint` over a gameplay zone lands inside the chat (taps are swallowed);
 *   - html/body scrolling is locked;
 *   - the chat panel is positioned out of flow;
 *   - the chat declares modal semantics.
 */
const NONBLOCKING = `JSON.stringify((() => {
  ${HELPERS}
  const v = [];
  const add = (kind, detail) => v.push(kind + ': ' + detail);
  const vw = window.innerWidth, vh = window.innerHeight;
  const zones = ${JSON.stringify(GAMEPLAY_ZONES)};

  const panelEl = shellNode();
  const panel = panelEl ? rect(panelEl) : null;

  // 1. No backdrop, and no modal semantics.
  const backdrop = backdropNode();
  if (backdrop) {
    const br = rect(backdrop);
    add('chat-backdrop', Math.round(br.w) + 'x' + Math.round(br.h) + ' ' + getComputedStyle(backdrop).backgroundColor);
  }
  if (panelEl && panelEl.getAttribute('aria-modal') === 'true') add('chat-aria-modal', 'true');

  // 2. The page scroll is NOT locked.
  for (const el of [document.documentElement, document.body]) {
    const st = getComputedStyle(el);
    if (st.overflow === 'hidden' || st.overflowY === 'hidden') {
      add('scroll-locked', el.tagName.toLowerCase() + ' overflow=' + st.overflow + '/' + st.overflowY);
    }
  }

  // 3. The chat panel takes LAYOUT SPACE — it is never an out-of-flow overlay.
  if (panelEl) {
    const pos = getComputedStyle(panelEl).position;
    if (pos === 'fixed' || pos === 'absolute' || pos === 'sticky') add('chat-out-of-flow', pos);
    for (const p of [panelEl.parentElement, panelEl.parentElement && panelEl.parentElement.parentElement]) {
      if (!p) continue;
      const ps = getComputedStyle(p);
      if ((ps.position === 'fixed' || ps.position === 'absolute')
        && rect(p).w > 0.9 * vw && rect(p).h > 0.9 * vh) {
        add('chat-in-viewport-overlay', (p.className || p.tagName).toString().split(' ')[0] + ' ' + ps.position);
      }
    }
  }

  // 4. The chat and the launcher cluster never sit on a gameplay zone.
  const cluster = q('.room-social__bar, .social-controls, .social-menu');
  const clusterR = cluster ? rect(cluster) : null;
  const hits = [];
  for (const sel of zones) {
    for (const el of document.querySelectorAll(sel)) {
      const r = rect(el);
      if (!live(r)) continue;
      if (panel && hit(panel, r)) {
        hits.push(sel);
        add('chat-over-gameplay', sel + ' ' + Math.round(Math.min(panel.r, r.r) - Math.max(panel.l, r.l))
          + 'x' + Math.round(Math.min(panel.b, r.b) - Math.max(panel.t, r.t)));
      }
      if (clusterR && hit(clusterR, r)) add('launcher-over-gameplay', sel);
    }
  }

  // 5. Taps over gameplay must reach GAMEPLAY. elementFromPoint skips pointer-events:none
  //    layers, so the floating reaction layer is correctly ignored here.
  const swallowed = [];
  for (const sel of zones) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = rect(el);
    if (!live(r)) continue;
    for (const [x, y] of [[r.l + r.w / 2, r.t + Math.min(r.h / 2, 24)], [r.l + r.w / 2, r.b - 4]]) {
      if (x < 0 || y < 0 || x > vw || y > vh) continue;
      const top = document.elementFromPoint(x, y);
      if (!top) continue;
      if (top.closest('.chat-panel, .chat-dialog, .chat-dialog-backdrop, .social-sheet, .social-sheet-backdrop')) {
        swallowed.push(sel);
        add('tap-swallowed', sel + ' @' + Math.round(x) + ',' + Math.round(y)
          + ' -> ' + (top.className || top.tagName).toString().split(' ')[0]);
      }
    }
  }

  // 6. The page still never scrolls sideways.
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) add('page-scroll-x', de.scrollWidth + '>' + de.clientWidth);

  return {
    violations: v,
    backdrop: !!backdrop,
    panelPos: panelEl ? getComputedStyle(panelEl).position : null,
    panelH: panel ? Math.round(panel.h) : 0,
    overlaps: [...new Set(hits)],
    swallowed: [...new Set(swallowed)],
    docOverflow: getComputedStyle(document.documentElement).overflow,
  };
})())`;

const EMOJI = '.chat-picker .reaction-bar__btn';
const SEND = '.chat-panel__compose [type="submit"]';
const STICKER = '.chat-picker .chat-media-thumb';
const HISTORY = '.chat-panel__list, .chat-dialog__list, .chat-drawer__list';

/**
 * (38.0.15 corrective) ONE emoji set whose destination follows what the player was doing
 * when the press began, driven with REAL input — a synthetic `el.click()` cannot move
 * focus, so it cannot tell a typist's tap from a bystander's. The intent is captured on
 * `pointerdown`, which is the first event of the gesture: on a phone the tap itself can
 * dismiss the keyboard, and a blur landing between the finger and the `click` would
 * otherwise flip the destination after the player had already chosen it.
 * Returns the violations it found so the caller can label them with viewport/variant/game.
 */
async function runBehaviour(cdp, act, label) {
  const bad = [];
  const state = async () => JSON.parse(await cdp.evaluate(STATE));
  const setCaret = (a, b) => cdp.evaluate(
    `(() => { const el = document.querySelector('.chat-input'); if (!el) return false; el.setSelectionRange(${a}, ${b}); return true; })()`);

  if (act === 'typing-caret') {
    // Typing: the caret sits between "a" and "b". The emoji lands there, wipes nothing,
    // sends nothing, and the field keeps focus AND the keyboard. Then Send posts ONE chat
    // message carrying the emoji — the only way anything leaves this branch.
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
    if (afterPicker.emojiButtons !== afterPicker.uniqueEmoji) {
      bad.push(`${afterPicker.emojiButtons} emoji buttons for ${afterPicker.uniqueEmoji} emoji`);
    }
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const after = await state();
    if (!/^a.+b$/u.test(after.text ?? '')) bad.push(`emoji did not land at the caret (value="${after.text}")`);
    if (!after.focused) bad.push(`the emoji button STOLE focus (active=${after.active})`);
    if (after.calls.length !== 0) bad.push(`typing + emoji SENT something (${JSON.stringify(after.calls)})`);
    const typed = after.text;
    if (!await cdp.click(SEND)) bad.push('cannot press Send');
    const sent = await state();
    const chats = sent.calls.filter((c) => c.kind === 'chat');
    if (chats.length !== 1 || chats[0].value !== typed) {
      bad.push(`Send posted ${JSON.stringify(chats)}, expected one "${typed}"`);
    }
    if (sent.text !== '') bad.push(`Send left "${sent.text}" in the field`);
  }

  if (act === 'blurred-draft') {
    // A draft is typed, then the field loses focus (here: a tap on the history; on a phone
    // the keyboard closing does the same). The SAME emoji now goes to the table — once —
    // the non-empty draft is untouched, and the field is not pulled back into focus.
    if (!await cdp.click('.chat-input')) bad.push('cannot click the input');
    await cdp.type('привіт');
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    if (!await cdp.click(HISTORY)) bad.push('cannot click the history');
    const blurred = await state();
    if (blurred.focused) bad.push('tapping the history did not blur the field');
    if (!blurred.pickerOpen) bad.push('tapping the history closed the picker');
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const after = await state();
    const reacts = after.calls.filter((c) => c.kind === 'react');
    if (reacts.length !== 1) bad.push(`react fired ${reacts.length}x`);
    if (after.text !== 'привіт') bad.push(`a table reaction changed the draft ("${after.text}")`);
    if (after.focused) bad.push('a table reaction pulled focus into the field');
  }

  if (act === 'blurred-empty') {
    // Picker opened without ever touching the field → the emoji goes to the table once and
    // the empty draft stays empty.
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    const opened = await state();
    if (opened.focused) bad.push('the picker button focused the field on its own');
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const after = await state();
    const reacts = after.calls.filter((c) => c.kind === 'react');
    if (reacts.length !== 1) bad.push(`react fired ${reacts.length}x`);
    if (after.text !== '') bad.push(`the field gained text ("${after.text}")`);
  }

  if (act === 'opened-while-typing') {
    // The picker is opened FROM an active field: the opener must not take the caret, so the
    // very first emoji still belongs to the message.
    if (!await cdp.click('.chat-input')) bad.push('cannot click the input');
    await cdp.type('hi');
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const after = await state();
    if (after.calls.length !== 0) bad.push(`SENT something (${JSON.stringify(after.calls)})`);
    if ((after.text ?? '') === 'hi') bad.push('nothing was inserted');
    if (!(after.text ?? '').startsWith('hi')) bad.push(`the draft was damaged ("${after.text}")`);
  }

  if (act === 'focus-switch') {
    // One session, both destinations, one emoji set: type → insert; tap the history → table.
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    if (!await cdp.click('.chat-input')) bad.push('cannot click the input');
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const inserted = await state();
    if ((inserted.text ?? '').length === 0) bad.push('a typist\'s tap inserted nothing');
    if (inserted.calls.length !== 0) bad.push('a typist\'s tap SENT something');
    if (!await cdp.click(HISTORY)) bad.push('cannot click the history');
    if (!await cdp.click(EMOJI)) bad.push('cannot click an emoji');
    const after = await state();
    if (after.calls.filter((c) => c.kind === 'react').length !== 1) bad.push('the blurred tap did not send exactly one reaction');
    if (after.text !== inserted.text) bad.push(`the blurred tap changed the message ("${after.text}")`);
  }

  if (act === 'sticker') {
    // (38.0.16) With NO draft a sticker is still a one-tap message of its own.
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    if (!await cdp.click(STICKER)) bad.push('cannot click a sticker');
    const after = await state();
    const media = after.calls.filter((c) => c.kind === 'media');
    if (media.length !== 1) bad.push(`sticker fired ${media.length}x`);
    if (after.calls.some((c) => c.kind === 'react')) bad.push('a sticker also sent a table reaction');
    if (after.text !== '') bad.push(`a sticker wrote into the draft ("${after.text}")`);
    if (after.attached) bad.push('a sticker attached itself to an empty draft instead of sending');
  }

  if (act === 'combined') {
    // (38.0.16) THE new case: a typed line PLUS an animated sticker, sent as ONE message.
    if (!await cdp.click('.chat-input')) bad.push('cannot click the input');
    await cdp.type('hi');
    if (!await cdp.click('.chat-picker-btn')) bad.push('cannot click the picker button');
    if (!await cdp.click(STICKER)) bad.push('cannot click a sticker');
    const attached = await state();
    if (attached.calls.length !== 0) bad.push(`attaching SENT something (${JSON.stringify(attached.calls)})`);
    if (!attached.attached) bad.push('no attachment preview appeared');
    if (attached.text !== 'hi') bad.push(`attaching changed the draft ("${attached.text}")`);
    // A second sticker REPLACES the first — it never posts anything.
    const thumbs = await cdp.json(`document.querySelectorAll('${STICKER}').length`);
    if (thumbs > 1) {
      if (!await cdp.click(`${STICKER}:nth-of-type(2)`)) bad.push('cannot click a second sticker');
      const replaced = await state();
      if (replaced.calls.length !== 0) bad.push('replacing the sticker SENT something');
      if (!replaced.attached) bad.push('replacing the sticker dropped the attachment');
    }
    // One Send → exactly ONE chat call carrying BOTH halves; both are then cleared.
    if (!await cdp.click(SEND)) bad.push('cannot press Send');
    const sent = await state();
    const chats = sent.calls.filter((c) => c.kind === 'chat');
    if (chats.length !== 1) bad.push(`Send produced ${chats.length} chat messages, expected 1`);
    if (sent.calls.some((c) => c.kind === 'media')) bad.push('Send ALSO posted a separate media message');
    if (chats[0] && chats[0].value !== 'hi') bad.push(`the text half is "${chats[0].value}"`);
    if (chats[0] && !chats[0].mediaId) bad.push('the message carried no attachment');
    if (sent.text !== '') bad.push(`Send left "${sent.text}" in the field`);
    if (sent.attached) bad.push('Send left the attachment behind');
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

/**
 * Navigate and wait for the page to exist. (38.0.16.1) The gate now performs ~250
 * navigations per run — 7 games × 6 viewports × 2 directions plus the behaviour scenarios —
 * and against a DEV server an occasional transform takes longer than the old 8s window, so
 * single combinations failed as "NOTHING rendered" at random (measured twice, on different
 * combinations, with no code between the runs). A flaky gate is a useless gate: the window
 * is 20s and one reload is retried before giving up.
 */
async function load(cdp, url, marker) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await cdp.send('Page.navigate', { url });
    for (let i = 0; i < 200; i++) {
      if (await cdp.evaluate(`!!document.querySelector('${marker}')`)) {
        if (LEGACY) {
          await cdp.evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(LEGACY_CSS)}; document.head.appendChild(s); return true; })()`);
        }
        const settled = await cdp.evaluate(SETTLE);
        return settled?.ready === true;
      }
      await sleep(100);
    }
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
        for (const sc of scenarios().filter((x) => !ONLY || `${variant}/${x.name}`.includes(ONLY))) {
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

          // (38.0.16.1) THE BASELINE INVARIANT. 38.0.16 only compared closed/open/picker to
          // each other, and its permanently reserved 22.5rem rail satisfied that while
          // shrinking all three: at 1920 the 51 board fell 1904 → 1513px with the chat SHUT.
          // So the rule is now absolute, not relative — the game stage occupies the WHOLE
          // room layout in every state. A chat may cost the game nothing, ever, and no
          // reservation may be made on viewport width alone.
          const geoSels = STAGE_GEO[g.tag];
          const stageFull = async (state) => {
            const m = await cdp.json(`(() => {
              const l = document.querySelector('.room-layout'), st = document.querySelector('.game-stage');
              if (!l || !st) return null;
              const lr = l.getBoundingClientRect(), sr = st.getBoundingClientRect();
              return { layout: +lr.width.toFixed(2), stage: +sr.width.toFixed(2),
                       x: +(sr.left - lr.left).toFixed(2) };
            })()`);
            if (!m) return [`no room layout / stage (${state})`];
            const bad = [];
            if (Math.abs(m.stage - m.layout) > 1) {
              bad.push(`the stage is ${m.stage}px inside a ${m.layout}px layout (${state}) — ${(m.layout - m.stage).toFixed(2)}px reserved away from the game`);
            }
            if (Math.abs(m.x) > 1) bad.push(`the stage starts ${m.x}px into the layout (${state})`);
            return bad;
          };
          for (const v of await stageFull('chat closed')) failures.push(`${label}: ${v}`);
          checks++;
          const geoClosed = JSON.parse(await cdp.evaluate(geoProbe(geoSels)));

          // Open the chat through the game's OWN launcher — the production path.
          const launcher = '.room-social__bar .social-fab, .social-menu__launcher, .social-controls__row .social-fab';
          const opened = await cdp.evaluate(`(() => {
            const btns = [...document.querySelectorAll('${launcher}')].filter((b) => (b.textContent || '').includes('💬'));
            if (btns.length !== 1) return btns.length;
            btns[0].click();
            return true;
          })()`);
          if (opened !== true) { failures.push(`${label}: expected exactly one 💬 launcher, found ${opened}`); continue; }
          await cdp.evaluate(SETTLE);
          const geoOpen = JSON.parse(await cdp.evaluate(geoProbe(geoSels)));
          if (!await cdp.click('.chat-picker-btn')) failures.push(`${label}: cannot open the picker`);
          await cdp.evaluate(SETTLE);
          const geoPicker = JSON.parse(await cdp.evaluate(geoProbe(geoSels)));

          // THE Stage 38.0.16 invariant: opening a panel may make the DOCUMENT taller, and
          // nothing else. The game's own geometry is the same in all three states.
          for (const v of geoDiff(geoClosed, geoOpen, 'the chat opened')) failures.push(`${label}: ${v}`);
          for (const v of geoDiff(geoClosed, geoPicker, 'the picker opened')) failures.push(`${label}: ${v}`);
          for (const v of await stageFull('chat open')) failures.push(`${label}: ${v}`);
          checks++;
          // The measured scene width, printed for every game/viewport — the table the owner
          // reads to see that 51 and Preferans are full width again.
          if (geoClosed.board) measured.push(`SCENE ${vp.tag} ${name} board ${geoClosed.board.w}x${geoClosed.board.h}`);
          checks += 2;

          const res = JSON.parse(await cdp.evaluate(PROBE));
          checks++;
          if (!res.sig) { failures.push(`${label}: the chat never opened`); continue; }
          for (const violation of res.violations) failures.push(`${label}: ${violation}`);

          // ---- Stage 38.0.14: the chat must not block the game ------------------------
          const nb = JSON.parse(await cdp.evaluate(NONBLOCKING));
          checks++;
          for (const violation of nb.violations) failures.push(`${label}: ${violation}`);

          // A LEGAL gameplay control is clicked WITH THE CHAT OPEN. It must reach the
          // game exactly once, and the chat must survive both the click and the
          // STATE_UPDATE that a real server would send straight after it.
          if (g.action) {
            const before = await cdp.json('(window.__gameActions || []).length');
            // Scroll it into view first: the panel takes layout space by design, so the
            // hand/action row may sit below the fold — reachable, which is the point.
            await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(g.action)});
              if (el) el.scrollIntoView({ block: 'center' }); return true; })()`);
            await cdp.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
            const reachable = await cdp.json(`(() => {
              const el = document.querySelector(${JSON.stringify(g.action)});
              if (!el) return 'missing';
              const r = el.getBoundingClientRect();
              const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 18));
              if (!top) return 'off-screen';
              return top === el || el.contains(top) || top.contains(el) ? true
                : (top.className || top.tagName).toString();
            })()`);
            if (reachable !== true) failures.push(`${label}: the legal action ${g.action} is not hittable (${reachable})`);
            if (!await cdp.click(g.action)) failures.push(`${label}: cannot click ${g.action}`);
            const after = await cdp.json('(window.__gameActions || []).length');
            if (after !== before + 1) {
              failures.push(`${label}: clicking ${g.action} with the chat open reached the game ${after - before}x (expected 1)`);
            }
            const openAfter = await cdp.json("!!(document.querySelector('.chat-panel__list'))");
            if (!openAfter) failures.push(`${label}: making a move CLOSED the chat`);
            // …and a STATE_UPDATE (new state object + a ticking timer) leaves it open.
            const timerBefore = await cdp.json("(document.querySelector('.probe-timer') || {}).textContent || ''");
            await cdp.evaluate('window.__pushState && window.__pushState()');
            await cdp.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
            const timerAfter = await cdp.json("(document.querySelector('.probe-timer') || {}).textContent || ''");
            const stillOpen = await cdp.json("!!(document.querySelector('.chat-panel__list'))");
            if (!stillOpen) failures.push(`${label}: a STATE_UPDATE CLOSED the chat`);
            if (timerBefore === timerAfter) failures.push(`${label}: the timer did not advance across the STATE_UPDATE ("${timerAfter}")`);
            checks++;
          }

          const key = `${vp.tag}/${dirTag}`;
          if (!shells.has(key)) shells.set(key, new Map());
          shells.get(key).set(g.tag, res.sig);
          if (SHOTS) {
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            if (shot?.result?.data) writeFileSync(`${SHOTS}/${LEGACY ? 'RED-' : ''}${vp.tag}-${g.tag}-${dirTag}-chat.png`, Buffer.from(shot.result.data, 'base64'));
          }
          const s = res.sig;
          const meta = `${s.cls.split(' ')[0]} pos=${s.position} r=${s.radius} bd=${s.backdrop === 'none' ? 'none' : 'YES'}`
            + ` h${nb.panelH} over[${nb.overlaps.join(',') || '-'}] swallow[${nb.swallowed.join(',') || '-'}]`;
          measured.push(`${vp.tag} ${name} ${meta}`);
          console.log(`  ${name.padEnd(26)} ${meta}`);

          // (38.0.15 corrective) Behaviour is proved on REAL branches at BOTH phone widths
          // and in BOTH directions. The full set runs at 390 LTR — the width the owner
          // reports from — and the two branch-deciding cases run at 360 and in Arabic RTL,
          // where the picker wraps differently. Nothing is capped silently: the reduced set
          // is named in the log line below.
          const FULL = ['typing-caret', 'blurred-draft', 'blurred-empty', 'opened-while-typing', 'focus-switch', 'sticker', 'combined'];
          const CORE = ['typing-caret', 'blurred-draft'];
          const acts = ['360', '390'].includes(vp.tag) && g.action
            ? (vp.tag === '390' && dirTag === 'ltr' ? FULL : CORE)
            : [];
          if (acts.length) {
            console.log(`    behaviour: ${acts.join(', ')}`);
            for (const act of acts) {
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
        for (const field of ['cls', 'position', 'radius', 'backdrop', 'bg', 'border', 'font', 'gap', 'pad', 'dom']) {
          const a = ref[field], b = sig[field];
          if (a !== b) failures.push(`${key}: ${refName} and ${name} disagree on the chat ${field} — "${a}" vs "${b}"`);
        }
      }
      checks++;
    }
  } finally {
    chrome.kill();
    if (vite) vite.kill();
  }

  console.log(`\n${checks} social layout checks run.`);
  console.log('chat shell per game (one panel, identical everywhere):');
  for (const m of measured.filter((x) => /king|durak|deberc|tarneeb|preferans|fiftyone|poker/.test(x))) console.log(`  ${m}`);
  if (failures.length) {
    console.log(`\n${failures.length} violations:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('SOCIAL LAYOUT OK — one chat, ONE emoji set, and the press decides where an emoji goes.');
}

main().catch((e) => { console.error(e); process.exit(1); });
