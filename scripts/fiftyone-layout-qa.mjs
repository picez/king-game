// ---------------------------------------------------------------------------
// Fifty-One LAYOUT QA gate (Stage 38.0.4, rebuilt for Stage 38.0.5.1).
//
//   node scripts/fiftyone-layout-qa.mjs [--legacy] [--shots <dir>] [--only <substr>]
//
// WHY IT WAS REBUILT. The 38.0.4 gate was green while the owner's phone was not, because
// it measured a PARTIAL table: no `dangerSlot`, no chat history, no open panel, no
// confirmation dialog, no card-face theme, no text scaling, one paint only, and it looked
// only at the direct `.fiftyone-meldcard` wrappers — never the inner `.card`, the
// `.card__art`, the joker badge or the controls. This version mounts the PRODUCTION
// online branch (scripts/layout-harness/fiftyone.tsx) and measures every one of those.
//
// It asserts on real `getBoundingClientRect()` values in a real browser AFTER
// `document.fonts.ready`, after every visible image has `decode()`d, and after two
// animation frames — screenshots are evidence, not the assertion. `--legacy` re-applies
// the pre-fix CSS so the RED can be reproduced on demand instead of being described.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const WebSocket = createRequire(`${process.cwd()}/package.json`)('ws');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9252;
const VITE_PORT = 5199;
const BASE = `http://localhost:${VITE_PORT}/scripts/layout-harness/fiftyone.html`;

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

// --- settle: fonts, decoded artwork, the harness's own update sequence, 2 frames ------
const SETTLE = `(async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  for (let i = 0; i < 60 && window.__f51ready !== true; i++) await new Promise(r => setTimeout(r, 50));
  // Only what the viewport actually shows: the sticker grid mounts the whole catalog
  // with loading="lazy", and decode() on an off-screen sticker the browser has
  // deliberately not fetched never settles (it would hang the whole settle step).
  const imgs = [...document.images].filter((im) => {
    const r = im.getBoundingClientRect();
    return r.width > 0.5 && r.bottom > 0 && r.top < window.innerHeight
      && r.right > 0 && r.left < window.innerWidth;
  });
  await Promise.all(imgs.map((im) => Promise.race([
    im.decode ? im.decode().catch(() => {}) : Promise.resolve(),
    new Promise((r) => setTimeout(r, 2000)),
  ])));
  await new Promise((r) => requestAnimationFrame(() => r()));
  await new Promise((r) => requestAnimationFrame(() => r()));
  return { images: imgs.length, ready: window.__f51ready === true };
})()`;

// --- the in-page probe -------------------------------------------------------
const PROBE = `JSON.stringify((() => {
  const S = 0.5;                                   // sub-pixel tolerance
  const vw = window.innerWidth;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const live = (r) => r.w > 0.5 && r.h > 0.5;
  const all = (sel, root) => [...(root || document).querySelectorAll(sel)].filter((e) => live(rect(e)));
  const one = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = rect(el); return live(r) ? r : null; };
  const hit = (a, b) => !!a && !!b && a.l < b.r - S && b.l < a.r - S && a.t < b.b - S && b.t < a.b - S;
  const ov = (a, b) => Math.round(Math.min(a.r, b.r) - Math.max(a.l, b.l)) + 'x' + Math.round(Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const inside = (child, parent) =>
    child.l >= parent.l - S && child.r <= parent.r + S && child.t >= parent.t - S && child.b <= parent.b + S;

  const v = [];
  const add = (kind, detail) => v.push(kind + ': ' + detail);

  const groups = all('.fiftyone-meldgroup');
  const melds = all('.fiftyone-meld');
  const prompt = one('.fiftyone-prompt');
  const actions = one('.fiftyone-actions');
  const hand = one('.hand-reorder') || one('.fiftyone-hand') || one('.hand');
  const scoreboard = one('.fiftyone-scoreboard');
  const piles = one('.fiftyone-piles');
  const launcher = one('.social-menu');
  // (38.0.13) 51's social surfaces are now the SHARED chat dialog (💬) and the ☰ menu
  // sheet (voice / quit). Both are modals; either one counts as "a modal is open".
  const chatDlg = one('.chat-dialog');
  const sheet = one('.social-sheet');
  const dialog = one('.permleave-dialog');
  const modalOpen = !!sheet || !!chatDlg || !!dialog;

  // Every card slot on the table, with its inner card / artwork / joker badge.
  const slots = [];
  melds.forEach((meld, mi) => {
    const row = meld.querySelector('.fiftyone-meld__cards');
    if (!row) return;
    const rowRect = rect(row);
    const label = 'meld' + mi;
    const cards = all('.fiftyone-meldcard', row).map((el) => ({ el, r: rect(el) }));
    if (!cards.length) add('meld-empty', label);

    for (const { el, r } of cards) {
      slots.push({ r, label });
      // 1. the slot must be FULLY inside its row's visible box…
      if (!inside(r, rowRect)) {
        add('card-clipped', label + ' ' + Math.round(r.l) + '..' + Math.round(r.r) + '/' + Math.round(r.b)
          + ' vs row ' + Math.round(rowRect.l) + '..' + Math.round(rowRect.r) + '/' + Math.round(rowRect.b));
      }
      if (r.w < 28 || r.h < 40) add('card-squeezed', label + ' ' + Math.round(r.w) + 'x' + Math.round(r.h));
      // …and be inside the meld block, and inside its owner group.
      const mr = rect(meld);
      if (!inside(r, mr)) add('card-outside-meld', label);

      // 2. the inner .card must sit inside its slot, keep the face aspect, and its
      //    artwork + joker badge must stay inside the card.
      const card = el.querySelector('.card');
      if (card) {
        const cr = rect(card);
        if (!inside(cr, r)) add('card-outside-slot', label + ' card ' + Math.round(cr.w) + 'x' + Math.round(cr.h)
          + ' vs slot ' + Math.round(r.w) + 'x' + Math.round(r.h));
        const aspect = cr.h / cr.w;
        if (aspect < 1.45 || aspect > 1.75) add('card-aspect', label + ' ' + aspect.toFixed(2));
        const art = card.querySelector('.card__art');
        if (art) {
          const ar = rect(art);
          if (!inside(ar, cr)) add('art-outside-card', label + ' art ' + Math.round(ar.l) + '..' + Math.round(ar.r)
            + ' vs card ' + Math.round(cr.l) + '..' + Math.round(cr.r));
          const st = getComputedStyle(art);
          if (st.transform && st.transform.includes('-1,')) add('art-mirrored', label + ' ' + st.transform);
        }
      }
      const badge = el.querySelector('.fiftyone-meldcard__jbadge');
      if (badge) {
        const br = rect(badge);
        if (live(br) && !inside(br, r)) add('joker-badge-outside', label);
      }
    }

    // 3. no hidden inner scroll anywhere in the meld block.
    for (const el of [meld, row, ...row.children]) {
      if (el.scrollWidth > Math.ceil(el.clientWidth) + 1 && el.clientWidth > 0) {
        add('inner-scroll-x', label + ' ' + el.className + ' ' + el.scrollWidth + '>' + el.clientWidth);
      }
    }

    // 4. the meld's controls may never sit on its cards.
    for (const ctrl of all('.fiftyone-meld__ctrls', meld)) {
      const cr = rect(ctrl);
      for (const { r } of cards) if (hit(cr, r)) add('ctrl-over-card', label + ' ' + ov(cr, r));
    }
  });

  // 5. NO TWO CARDS ANYWHERE may overlap, and same-row neighbours keep a positive gap.
  const sorted = [...slots].sort((a, b) => (a.r.t - b.r.t) || (a.r.l - b.r.l));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i].r, b = sorted[j].r;
      if (b.t > a.b + 2) break;                    // rows below can no longer touch
      if (hit(a, b)) add('card-overlap', sorted[i].label + '|' + sorted[j].label + ' ' + ov(a, b));
      if (Math.abs(a.t - b.t) < 2 && b.l - a.r < 1 && b.l >= a.l) {
        add('no-gap', sorted[i].label + ' ' + Math.round(b.l - a.r) + 'px');
      }
    }
  }

  // 6. meld blocks and owner GROUPS must not intersect each other.
  const mrs = melds.map(rect);
  for (let i = 0; i < mrs.length; i++) {
    for (let j = i + 1; j < mrs.length; j++) if (hit(mrs[i], mrs[j])) add('meld-overlap', i + '|' + j + ' ' + ov(mrs[i], mrs[j]));
  }
  const grs = groups.map(rect);
  for (let i = 0; i < grs.length; i++) {
    for (let j = i + 1; j < grs.length; j++) if (hit(grs[i], grs[j])) add('group-overlap', i + '|' + j + ' ' + ov(grs[i], grs[j]));
  }
  // every meld must live inside exactly one group box
  melds.forEach((m, i) => {
    const r = rect(m);
    if (grs.length && !grs.some((g) => inside(r, g))) add('meld-outside-group', 'meld' + i);
  });

  // 7. COLLAPSED social UI never covers gameplay. An OPEN sheet/dialog is a modal and
  //    is allowed to — that is the point of it.
  const content = [...mrs, ...grs, prompt, actions, hand, scoreboard, piles].filter(Boolean);
  if (launcher && !modalOpen) {
    for (const el of content) if (hit(launcher, el)) add('social-over-content', ov(launcher, el));
  }
  if (!modalOpen) {
    for (const p of all('.chat-dialog, .reaction-bar, .social-controls').map(rect)) {
      for (const el of content) if (hit(p, el)) add('panel-over-content', ov(p, el));
    }
  }
  // An open modal must be a real one: a backdrop, a close control, and its OWN scroll.
  if (sheet) {
    if (!document.querySelector('.social-sheet-backdrop')) add('sheet-no-backdrop', '');
    if (!document.querySelector('.social-sheet__close')) add('sheet-no-close', '');
    const body = document.querySelector('.social-sheet__body');
    if (body && body.scrollWidth > body.clientWidth + 1) add('sheet-inner-scroll-x', body.scrollWidth + '>' + body.clientWidth);
    if (sheet.b > window.innerHeight + 1) add('sheet-off-screen', Math.round(sheet.b) + '>' + window.innerHeight);
  }
  if (chatDlg) {
    if (!document.querySelector('.chat-dialog-backdrop')) add('chat-no-backdrop', '');
    if (!document.querySelector('.chat-dialog__close')) add('chat-no-close', '');
    if (chatDlg.b > window.innerHeight + 1) add('chat-off-screen', Math.round(chatDlg.b) + '>' + window.innerHeight);
    if (chatDlg.l < -S || chatDlg.r > vw + S) add('chat-outside-viewport', Math.round(chatDlg.l) + '..' + Math.round(chatDlg.r));
    // (38.0.13) The manual picker-mode switch must never come back.
    for (const banned of ['chat-picker__mode', 'data-mode="table"']) {
      if (document.body.innerHTML.includes(banned)) add('picker-mode-switch', banned);
    }
  }

  // 8. page-level horizontal overflow.
  if (document.documentElement.scrollWidth > vw + 1) add('page-overflow-x', document.documentElement.scrollWidth + '>' + vw);
  const screen = document.querySelector('.fiftyone-screen');
  if (screen && screen.scrollWidth > screen.clientWidth + 1) add('screen-overflow-x', screen.scrollWidth + '>' + screen.clientWidth);

  // 9. touch targets for everything this stage owns.
  const TAP = '.social-menu__launcher, .social-sheet button, .chat-dialog button, .fiftyone-meld__ctrls button, .permleave-trigger, .permleave-dialog button';
  for (const b of all(TAP)) {
    const r = rect(b);
    if (r.w < 43.5 || r.h < 43.5) {
      add('touch-target', (b.className || '?').toString().split(' ')[0] + ' ' + Math.round(r.w) + 'x' + Math.round(r.h));
    }
  }

  // 10. (38.0.9) STICKER GRID — a square cell whose image is fully visible, never a strip.
  const stickerBtns = all('.chat-media-thumb');
  const stickerGrid = document.querySelector('.reaction-bar__stickers');
  for (const b of stickerBtns) {
    const br = rect(b);
    const ratio = br.w / br.h;
    if (ratio < 0.75 || ratio > 1.34) add('sticker-not-square', Math.round(br.w) + 'x' + Math.round(br.h) + ' r=' + ratio.toFixed(2));
    if (br.w < 43.5 || br.h < 43.5) add('sticker-small', Math.round(br.w) + 'x' + Math.round(br.h));
    const img = b.querySelector('img');
    if (img) {
      const ir = rect(img);
      if (!inside(ir, br)) add('sticker-img-outside', Math.round(ir.h) + ' in ' + Math.round(br.h));
      // The visible image must not be a thin band of its own square box.
      if (ir.w > 0.5 && ir.h / ir.w < 0.5) add('sticker-img-strip', Math.round(ir.w) + 'x' + Math.round(ir.h));
      // …and it must actually fill most of the cell it was given.
      if (br.h > 0.5 && ir.h / br.h < 0.5) add('sticker-img-squashed', Math.round(ir.h) + '/' + Math.round(br.h));
      // Under object-fit:contain the BOX is the cell (square by design) and the painted
      // content keeps its own aspect inside it — so the check is that the box FILLS the
      // cell, which is what makes a lazy/undecoded sticker unable to shift the layout.
      if (br.w > 0.5 && (ir.w / br.w < 0.7 || ir.h / br.h < 0.7)) {
        add('sticker-img-underfills', Math.round(ir.w) + 'x' + Math.round(ir.h) + ' in ' + Math.round(br.w) + 'x' + Math.round(br.h));
      }
    }
  }
  const sbr = stickerBtns.map(rect);
  for (let i = 0; i < sbr.length; i++) {
    for (let j = i + 1; j < sbr.length; j++) if (hit(sbr[i], sbr[j])) add('sticker-overlap', i + '|' + j);
  }
  if (stickerGrid && stickerGrid.scrollWidth > stickerGrid.clientWidth + 1) {
    add('sticker-grid-scroll-x', stickerGrid.scrollWidth + '>' + stickerGrid.clientWidth);
  }
  // Emoji buttons are tap targets too.
  for (const b of all('.reaction-bar__btn')) {
    const r = rect(b);
    if (r.w < 43.5 || r.h < 43.5) add('emoji-small', Math.round(r.w) + 'x' + Math.round(r.h));
  }

  // 11. (38.0.12) The sheet has exactly ONE scrolling region, and the composer stays
  // reachable: the owner's phone showed two scrollbars side by side, and an expanded
  // sticker grid used to push the text field out of the sheet.
  const sheetEl = document.querySelector('.chat-dialog') || document.querySelector('.social-sheet');
  // The conversation and the picker each bound themselves; NOTHING inside either of
  // them may add a scrollbar of its own.
  for (const root of ['.social-sheet__body', '.chat-picker', '.chat-dialog__list']) {
    const region = document.querySelector(root);
    if (!region) continue;
    for (const el of region.querySelectorAll('*')) {
      const st = getComputedStyle(el);
      const scrolls = (st.overflowY === 'auto' || st.overflowY === 'scroll')
        && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1;
      if (scrolls) add('sheet-nested-scroll', root + ' > ' + (el.className || '?').toString().split(' ')[0]);
    }
  }
  // (38.0.12) With the picker open the conversation must SURVIVE beside it — the owner's
  // FAIL was a sheet where the history had effectively vanished.
  // The list may be taller than the box that CLIPS it (the sheet body scrolls it), so
  // measure the VISIBLE band, not the element.
  const visibleH = (el) => {
    if (!el) return 0;
    const r = rect(el);
    let clip = el.parentElement, box = r;
    while (clip) {
      const st = getComputedStyle(clip);
      if (st.overflowY === 'auto' || st.overflowY === 'scroll' || st.overflowY === 'hidden') {
        const cr = rect(clip);
        box = { t: Math.max(box.t, cr.t), b: Math.min(box.b, cr.b) };
      }
      clip = clip.parentElement;
    }
    return Math.max(0, box.b - box.t);
  };
  const pickerEl = document.querySelector('.chat-picker');
  const historyEl = document.querySelector('.chat-dialog__list');
  if (pickerEl && historyEl) {
    const hv = visibleH(historyEl);
    if (hv < 96) add('history-squeezed', Math.round(hv) + 'px');
    const panelEl = document.querySelector('.chat-dialog');
    if (panelEl) {
      const pr = rect(panelEl);
      if (pr.h > 0.5 && hv / pr.h < 0.2) add('history-share', Math.round(100 * hv / pr.h) + '%');
    }
  }
  const compose = document.querySelector('.chat-dialog__compose');
  if (sheetEl && compose) {
    const cr = rect(compose);
    const sr = rect(sheetEl);
    if (!live(cr)) add('compose-hidden', 'zero size');
    else if (cr.b > sr.b + S || cr.t < sr.t - S) {
      add('compose-out-of-sheet', Math.round(cr.t) + '-' + Math.round(cr.b) + ' in ' + Math.round(sr.t) + '-' + Math.round(sr.b));
    }
  }

  // 11. (38.0.9) MELD GROUP COMPACTNESS — a group must hug its own content.
  groups.forEach((g, gi) => {
    const gr = rect(g);
    const inner = all('.fiftyone-meld', g).map(rect);
    if (inner.length === 0) return;
    const contentBottom = Math.max(...inner.map((x) => x.b));
    const contentRight = Math.max(...inner.map((x) => x.r));
    const head = g.querySelector('.fiftyone-meldgroup__head');
    const headRight = head ? rect(head).r : contentRight;
    const widest = Math.max(contentRight, headRight);
    // The box ends just after its last meld — no tall empty tail.
    if (gr.b - contentBottom > 26) add('group-empty-bottom', 'g' + gi + ' ' + Math.round(gr.b - contentBottom) + 'px');
    // …and just after its widest row, unless the viewport forces a full-width column.
    if (vw >= 560 && gr.r - widest > 48) add('group-empty-right', 'g' + gi + ' ' + Math.round(gr.r - widest) + 'px');
    // A SHORT meld must never span half a wide screen. Width is judged by the widest CARD
    // ROW: a 13-card run legitimately needs the space, a 3-card set never does.
    const widestRow = Math.max(0, ...all('.fiftyone-meld__cards', g).map((row) => all('.fiftyone-meldcard', row).length));
    if (vw >= 1000 && widestRow > 0 && widestRow <= 6 && gr.w > vw * 0.45) {
      add('group-too-wide', 'g' + gi + ' ' + Math.round(gr.w) + ' of ' + vw + ' for ' + widestRow + ' cards');
    }
  });
  // Groups on the SAME row are top-aligned and are not stretched to a common height.
  const grs2 = groups.map(rect);
  for (let i = 0; i < grs2.length; i++) {
    for (let j = i + 1; j < grs2.length; j++) {
      const a = grs2[i], b = grs2[j];
      if (Math.abs(a.t - b.t) > 2) continue;            // different rows
      const ca = Math.max(...all('.fiftyone-meld', groups[i]).map((x) => rect(x).b), a.t);
      const cb = Math.max(...all('.fiftyone-meld', groups[j]).map((x) => rect(x).b), b.t);
      const contentDiff = Math.abs((ca - a.t) - (cb - b.t));
      if (contentDiff > 40 && Math.abs(a.h - b.h) < 4) {
        add('group-stretched', i + '|' + j + ' equal h=' + Math.round(a.h) + ' but content differs by ' + Math.round(contentDiff));
      }
    }
  }

  return {
    violations: v, groups: groups.length, melds: melds.length, cards: slots.length,
    launcher: !!launcher, sheet: !!sheet || !!chatDlg, chat: !!chatDlg, dialog: !!dialog, hasPrompt: !!prompt,
    stickers: stickerBtns.length,
    hist: Math.round(visibleH(document.querySelector('.chat-dialog__list'))),
    pick: (function(){ const h = document.querySelector('.chat-picker'); return h ? Math.round(rect(h).h) : 0; })(),
    groupBoxes: groups.map((g) => { const r = rect(g); return Math.round(r.w) + 'x' + Math.round(r.h); }),
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

const SOCIAL = 'social=sheet&chat=7&updates=1';

/** Each scenario: a query string, plus optional clicks to perform before measuring. */
function scenarios() {
  const list = [
    { name: '2p', q: 'players=2' },
    { name: '3p', q: 'players=3' },
    { name: '4p', q: 'players=4' },
    { name: '4p-collapsed', q: `players=4&${SOCIAL}` },
    { name: '4p-chat', q: `players=4&${SOCIAL}&panel=chat` },
    // (38.0.12) The picker opens from INSIDE the chat and stays open while you use it;
    // an emoji types into the message, a sticker sends. The conversation, the composer
    // and the picker are all usable at once.
    { name: '4p-picker', q: `players=4&${SOCIAL}&panel=chat`, click: ['.chat-picker-btn'], stillOpen: true, pickerOpen: true },
    // (38.0.13) An emoji is TEXT only while the message field is ACTIVE, so the field is
    // focused first; blurred, the same tap would (correctly) fly to the table instead.
    { name: '4p-emoji-click', q: `players=4&${SOCIAL}&panel=chat`, click: ['.chat-picker-btn', 'focus:.chat-input', '.reaction-bar__btn'], stillOpen: true, pickerOpen: true, typed: true },
    { name: '4p-sticker-click', q: `players=4&${SOCIAL}&panel=chat`, click: ['.chat-picker-btn', '.chat-media-thumb'], stillOpen: true, pickerOpen: true },
    { name: '4p-chat-media', q: `players=4&${SOCIAL}&panel=chat`, click: ['.chat-picker-btn'], pickerOpen: true },
    // (38.0.9) Meld-group compactness: the owner's screenshot shapes.
    { name: 'single-meld', q: 'players=4&melds=single' },
    { name: 'uneven-groups', q: 'players=4&melds=uneven' },
    { name: 'uneven-rtl', q: 'players=4&melds=uneven&dir=rtl&lang=ar' },
    { name: '2p-single', q: 'players=2&melds=single' },
    // (38.0.13) The destructive control lives in the ☰ MENU sheet's footer (the chat
    // dialog is chat and nothing else), so the menu is opened first.
    { name: '4p-menu', q: `players=4&${SOCIAL}&panel=utility` },
    { name: '4p-confirm', q: `players=4&${SOCIAL}&panel=utility`, click: ['.permleave-trigger'], open: '.permleave-dialog' },
    { name: '4p-longrun', q: 'players=4&melds=long' },
    { name: '4p-longrun-social', q: `players=4&melds=long&${SOCIAL}` },
    { name: '4p-jokers', q: 'players=4&melds=jokers' },
    { name: '4p-sameowner', q: `players=4&melds=sameowner&${SOCIAL}` },
    { name: '4p-clean', q: 'players=4&faces=clean' },
    { name: '3p-clean-social', q: `players=3&faces=clean&${SOCIAL}` },
    { name: '4p-zoom', q: `players=4&fontScale=21&${SOCIAL}` },
    { name: '4p-rtl', q: 'players=4&dir=rtl&lang=ar' },
    { name: '4p-rtl-social', q: `players=4&dir=rtl&lang=ar&${SOCIAL}` },
    { name: '4p-rtl-chat', q: `players=4&dir=rtl&lang=ar&${SOCIAL}&panel=chat` },
    { name: '2p-empty', q: 'players=2&melds=redacted' },
  ];
  return list.map((s) => ({ ...s, q: LEGACY ? `${s.q}&legacy=1` : s.q }));
}

async function run() {
  let alreadyUp = false;
  try { await waitHttp(`${BASE}?players=4`, 1500); alreadyUp = true; } catch { /* start one */ }
  const vite = alreadyUp ? null : spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(VITE_PORT), '--strictPort'],
    { stdio: 'ignore', shell: process.platform === 'win32' });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${process.env.TEMP || '/tmp'}/kg-f51-qa`, 'about:blank',
  ], { stdio: 'ignore' });

  const failures = [];
  let checks = 0;
  try {
    await waitHttp(`${BASE}?players=4`, 90000);
    await waitDevtools();
    for (const vp of VIEWPORTS) {
      const targets = await fetchJson('/json');
      const page = targets.find((t) => t.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      // A headless page has no system focus, so `el.focus()` sets `activeElement` but
      // fires NO focus event — and since 38.0.13 the focus EVENT is what tells the chat
      // where an emoji should go. Emulating focus makes the gate see what a phone sees.
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile, screenWidth: vp.w, screenHeight: vp.h });
      console.log(`\n[${vp.tag} ${vp.w}x${vp.h}]${LEGACY ? ' (LEGACY / RED)' : ''}`);

      for (const sc of scenarios().filter((x) => !ONLY || x.name.includes(ONLY))) {
        await cdp.send('Page.navigate', { url: `${BASE}?${sc.q}` });
        // The empty-table scenario has no melds by design — wait for the screen instead.
        const anchor = sc.q.includes('melds=redacted') ? '.fiftyone-screen' : '.fiftyone-meld';
        let mounted = false;
        for (let i = 0; i < 60; i++) {
          if (await cdp.evaluate(`!!document.querySelector('${anchor}')`)) { mounted = true; break; }
          await sleep(100);
        }
        if (!mounted) { failures.push(`${vp.tag} ${sc.name}: NOTHING rendered (harness broken)`); continue; }

        const settled = await cdp.evaluate(SETTLE);
        if (!settled || settled.ready !== true) failures.push(`${vp.tag} ${sc.name}: harness never signalled ready`);

        for (const step of sc.click ?? []) {
          // `focus:<sel>` FOCUSES instead of clicking: `HTMLElement.click()` never moves
          // focus, and since 38.0.13 focus is what an emoji tap reads.
          const focusing = step.startsWith('focus:');
          const sel = focusing ? step.slice(6) : step;
          const done = await cdp.evaluate(
            `(() => { const el = document.querySelector('${sel}'); if (!el) return false; el.${focusing ? 'focus' : 'click'}(); return true; })()`);
          if (!done) failures.push(`${vp.tag} ${sc.name}: cannot ${focusing ? 'focus' : 'click'} ${sel}`);
        }
        if (sc.open) {
          let opened = false;
          for (let i = 0; i < 30; i++) {
            if (await cdp.evaluate(`!!document.querySelector('${sc.open}')`)) { opened = true; break; }
            await sleep(50);
          }
          if (!opened) failures.push(`${vp.tag} ${sc.name}: ${sc.open} never appeared`);
          await cdp.evaluate(SETTLE);
        }

        // (38.0.9/38.0.12) An emoji/sticker click must leave the CHAT open, and the
        // in-chat picker with it — the player keeps typing and sending.
        if (sc.stillOpen) {
          const open = await cdp.evaluate("!!document.querySelector('.chat-dialog')");
          const title = await cdp.evaluate("(document.querySelector('.chat-dialog__title')||{}).textContent||''");
          if (!open) failures.push(`${vp.tag} ${sc.name}: the chat CLOSED after the click`);
          else if (!/💬|Chat|الدردشة|Чат/.test(String(title))) {
            failures.push(`${vp.tag} ${sc.name}: the chat lost focus (title="${title}")`);
          }
          await cdp.evaluate(SETTLE);
        }
        if (sc.pickerOpen) {
          const picker = await cdp.evaluate("!!document.querySelector('.chat-picker')");
          if (!picker) failures.push(`${vp.tag} ${sc.name}: the in-chat picker is not open`);
          await cdp.evaluate(SETTLE);
        }
        // An emoji is TEXT here: it must land in the message being composed.
        if (sc.typed) {
          const typed = await cdp.evaluate("(document.querySelector('.chat-input')||{}).value||''");
          if (!String(typed).trim()) failures.push(`${vp.tag} ${sc.name}: the emoji did not reach the message box`);
        }

        const res = JSON.parse(await cdp.evaluate(PROBE));
        checks++;
        // A scenario that claims social UI must actually have mounted it — otherwise the
        // gate would be measuring a table that production never shows.
        if (sc.q.includes('social=sheet') && !res.launcher) failures.push(`${vp.tag} ${sc.name}: social launcher missing`);
        if (sc.name.endsWith('-chat') || sc.name.endsWith('-reactions')) {
          if (!res.sheet) failures.push(`${vp.tag} ${sc.name}: the sheet did not open`);
        }
        if (sc.name === '4p-confirm' && !res.dialog) failures.push(`${vp.tag} ${sc.name}: no confirmation dialog`);
        for (const violation of res.violations) failures.push(`${vp.tag} ${sc.name}: ${violation}`);
        if (SHOTS) {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          if (shot?.result?.data) writeFileSync(`${SHOTS}/${LEGACY ? 'RED-' : ''}${vp.tag}-${sc.name}.png`, Buffer.from(shot.result.data, 'base64'));
        }
        const meta = `g${res.groups}/m${res.melds}/c${res.cards}` + (res.pick ? `/h${res.hist}/p${res.pick}` : ``);
        console.log(`  ${sc.name.padEnd(18)} ${meta.padEnd(12)} ${res.violations.length ? `FAIL(${res.violations.length}) ${res.violations.slice(0, 2).join(' | ')}` : 'ok'}`);
      }
      cdp.close();          // an open CDP socket keeps node's event loop alive forever
    }
  } finally {
    chrome.kill();
    if (vite) vite.kill();
  }

  console.log(`\n${checks} Fifty-One layout checks run.`);
  if (failures.length) {
    const byKind = new Map();
    for (const f of failures) {
      const kind = (f.match(/: ([a-z][a-z-]+):/) ?? [, 'other'])[1];
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    console.log(`\n${failures.length} VIOLATION(S) by kind:`);
    for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(5)}  ${kind}`);
    console.log('\nfirst 60:');
    for (const f of failures.slice(0, 60)) console.log('  - ' + f);
    if (failures.length > 60) console.log(`  … ${failures.length - 60} more`);
    process.exitCode = 1;
  } else {
    console.log('FIFTY-ONE LAYOUT OK — grouped melds fully visible, no overlap/clipping/inner scroll, social clear of the game.');
  }
  return failures.length ? 1 : 0;
}

// Exit explicitly: a killed Chrome can leave stray handles that would otherwise hang node.
process.exit(await run());
