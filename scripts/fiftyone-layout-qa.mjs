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
  const imgs = [...document.images].filter((im) => im.getBoundingClientRect().width > 0.5);
  await Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())));
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
  const sheet = one('.social-sheet');
  const dialog = one('.permleave-dialog');
  const modalOpen = !!sheet || !!dialog;

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
    for (const p of all('.chat-drawer, .reaction-bar, .social-controls').map(rect)) {
      for (const el of content) if (hit(p, el)) add('panel-over-content', ov(p, el));
    }
  }
  // An open sheet must be a real modal: a backdrop, a close control, and its OWN scroll.
  if (sheet) {
    if (!document.querySelector('.social-sheet-backdrop')) add('sheet-no-backdrop', '');
    if (!document.querySelector('.social-sheet__close')) add('sheet-no-close', '');
    const body = document.querySelector('.social-sheet__body');
    if (body && body.scrollWidth > body.clientWidth + 1) add('sheet-inner-scroll-x', body.scrollWidth + '>' + body.clientWidth);
    if (sheet.b > window.innerHeight + 1) add('sheet-off-screen', Math.round(sheet.b) + '>' + window.innerHeight);
  }

  // 8. page-level horizontal overflow.
  if (document.documentElement.scrollWidth > vw + 1) add('page-overflow-x', document.documentElement.scrollWidth + '>' + vw);
  const screen = document.querySelector('.fiftyone-screen');
  if (screen && screen.scrollWidth > screen.clientWidth + 1) add('screen-overflow-x', screen.scrollWidth + '>' + screen.clientWidth);

  // 9. touch targets for everything this stage owns.
  const TAP = '.social-menu__launcher, .social-sheet button, .fiftyone-meld__ctrls button, .permleave-trigger, .permleave-dialog button';
  for (const b of all(TAP)) {
    const r = rect(b);
    if (r.w < 43.5 || r.h < 43.5) {
      add('touch-target', (b.className || '?').toString().split(' ')[0] + ' ' + Math.round(r.w) + 'x' + Math.round(r.h));
    }
  }

  return {
    violations: v, groups: groups.length, melds: melds.length, cards: slots.length,
    launcher: !!launcher, sheet: !!sheet, dialog: !!dialog, hasPrompt: !!prompt,
  };
})())`;

const VIEWPORTS = [
  { tag: '360', w: 360, h: 800, mobile: true },
  { tag: '390', w: 390, h: 844, mobile: true },
  { tag: 'desktop', w: 1280, h: 900, mobile: false },
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
    { name: '4p-reactions', q: `players=4&${SOCIAL}&panel=reactions` },
    // The destructive control lives in the sheet's footer, so the sheet is opened first.
    { name: '4p-confirm', q: `players=4&${SOCIAL}&panel=chat`, click: ['.permleave-trigger'], open: '.permleave-dialog' },
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

        for (const sel of sc.click ?? []) {
          const clicked = await cdp.evaluate(
            `(() => { const el = document.querySelector('${sel}'); if (!el) return false; el.click(); return true; })()`);
          if (!clicked) failures.push(`${vp.tag} ${sc.name}: cannot click ${sel}`);
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
        const meta = `g${res.groups}/m${res.melds}/c${res.cards}`;
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
