// ---------------------------------------------------------------------------
// Online social visual-QA shots (Stage 12.7, REBUILT in Stage 38.0.16).
//
//   node scripts/social-shots.mjs [outDir]      (npm run social-shots)
//
// WHY IT WAS REBUILT. The old script drove a real server + built preview and clicked
// `.chat-dialog`, `.chat-media-btn` and `.social-controls--raised` — every one of them
// deleted in 38.0.13/38.0.14. It also swallowed every miss: selectors that no longer
// existed were reported as "absent" and the run still exited 0, so it looked like passing
// QA while photographing nothing. It is now strict: a missing element is a FAILURE and the
// process exits non-zero.
//
// It mounts the same production composition the gates use (the layout harness: a stable
// `.game-stage` beside a `.social-region`) and captures, for Durak, Fifty-One and Poker at
// 390x844 and 1920x1080:
//     1-closed    the game with the chat shut
//     2-open      the chat open — the game must look identical to 1-closed
//     3-picker    the emoji set + sticker grid open
//     4-combined  a typed line with an animated sticker ATTACHED, before sending
//     5-sent      the same message posted — ONE bubble carrying text and the sticker
// ---------------------------------------------------------------------------

import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openOwnedPage, applyViewport, provePage, CdpSession } from './lib/cdp-owned-target.mjs';
import { runWithQaRuntime } from './lib/qa-processes.mjs';

const OUT = process.argv[2] || '.shots/social';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9262;
const VITE_PORT = 5212;
const BASE = `http://localhost:${VITE_PORT}/scripts/layout-harness/social-games.html`;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, timeout = 120000) {
  const start = Date.now();
  for (;;) {
    try { await new Promise((res, rej) => get(url, (r) => { r.resume(); res(r.statusCode); }).on('error', rej)); return; }
    catch { if (Date.now() - start > timeout) throw new Error(`not up: ${url}`); await sleep(200); }
  }
}

/**
 * (38.0.16.2d) The shared session, plus the real mouse and keyboard this script needs.
 * Command lifetime — the budget, the typed timeout, rejecting every pending command when the
 * socket dies — comes from `CdpSession`: one implementation for every gate.
 */
class CDP extends CdpSession {
  async click(sel) {
    await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false; el.scrollIntoView({ block: 'center' });
      for (let p = el.parentElement; p; p = p.parentElement) {
        const st = getComputedStyle(p);
        if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 1) {
          const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
          p.scrollTop += (r.top + r.height / 2) - (pr.top + pr.height / 2); break;
        }
      } return true; })()`);
    await this.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const box = await this.json(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null; const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) return null;
      return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 18) }; })()`);
    if (!box) return false;
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await this.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    return true;
  }
  async type(text) {
    await this.send('Input.insertText', { text });
    await this.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  }
}

const Q = {
  durak: 'game=durak&seats=4',
  fiftyone: 'game=fiftyone&seats=4',
  preferans: 'game=preferans&seats=3',
  // (38.0.16.3) Worst case for the two games that DECLARE a scene: King at its maximum four
  // players, Poker at six seats — the counts the footprint audit measured.
  poker: 'game=poker&seats=6',
  king: 'game=king&seats=4',
};
const VP = {
  360: { w: 360, h: 800, mobile: true },
  390: { w: 390, h: 844, mobile: true },
  1366: { w: 1366, h: 768, mobile: false },
  // (38.0.16.3) The two sidecar thresholds and the width just below each, so the switch
  // itself is reviewable by eye and not only by the gate's numbers.
  1471: { w: 1471, h: 1080, mobile: false },
  1472: { w: 1472, h: 1080, mobile: false },
  1667: { w: 1667, h: 1080, mobile: false },
  1668: { w: 1668, h: 1080, mobile: false },
  1920: { w: 1920, h: 1080, mobile: false },
  2560: { w: 2560, h: 1440, mobile: false },
};
/** (38.0.16.1) The set the owner reviews, plus one Arabic RTL phone and one RTL desktop. */
const COMBOS = [
  ['durak', 360, 'ltr'], ['durak', 390, 'ltr'], ['durak', 1366, 'ltr'], ['durak', 1920, 'ltr'],
  ['fiftyone', 360, 'ltr'], ['fiftyone', 390, 'ltr'], ['fiftyone', 1920, 'ltr'], ['fiftyone', 2560, 'ltr'],
  ['preferans', 390, 'ltr'], ['preferans', 1920, 'ltr'], ['preferans', 2560, 'ltr'],
  ['poker', 390, 'ltr'], ['poker', 1366, 'ltr'], ['poker', 1920, 'ltr'],
  ['durak', 390, 'rtl'], ['durak', 1920, 'rtl'],
  // (38.0.16.3) The adaptive sidecar: fallback on a phone, fallback one pixel below the
  // threshold, the sidecar at the threshold, and both real desktop widths — in both
  // directions, because the side band mirrors.
  ['king', 390, 'ltr'], ['king', 1667, 'ltr'], ['king', 1668, 'ltr'],
  ['king', 1920, 'ltr'], ['king', 2560, 'ltr'],
  ['king', 390, 'rtl'], ['king', 1920, 'rtl'],
  ['poker', 1471, 'ltr'], ['poker', 1472, 'ltr'], ['poker', 2560, 'ltr'],
  ['poker', 390, 'rtl'], ['poker', 1920, 'rtl'],
];
const LAUNCHER = '.room-social__bar .social-fab';
const CHAT = '.chat-panel';
const PICKER = '.chat-picker';
const STICKER = '.chat-picker .chat-media-thumb';
const ATTACH = '.chat-attach';
const SEND = '.chat-panel__compose [type="submit"]';

async function main() {
  const failures = [];
  let shots = 0;
  // (38.0.16.2d) The screenshot gate OWNS its dev server, its browser and its page. It used
  // to start vite through `spawn('npx vite …', { shell: true })` — on Windows that is
  // cmd.exe, so the pid was the SHELL — share a fixed Chrome profile, attach to whichever
  // page target was listed first, and clean up with `chrome.kill()`. Measured on 7cd54a0:
  // after it printed SOCIAL SHOTS OK the PROCESS NEVER EXITED (killed at 300s), port 9262 was
  // still held by Chrome pid 34136 (bootstrap parent 52688 already gone), port 5212 was still
  // held on `[::1]`, seven marked processes were alive and the profile was still on disk.
  await runWithQaRuntime({
    name: 'kg-social-shots', vitePort: VITE_PORT, cdpPort: CDP_PORT, chromePath: CHROME, failures,
  }, async () => {
    await waitHttp(BASE);
    const owned = await openOwnedPage(CDP_PORT, CDP);
    const cdp = owned.cdp;
    try {
    for (const [game, vpTag, dir] of COMBOS) {
      const vp = VP[vpTag];
      const g = { tag: game, q: Q[game] + (dir === 'rtl' ? '&dir=rtl&lang=ar' : '') };
      {
        cdp.setContext(`${vpTag}-${dir}-${game}`);
        await applyViewport(owned, vp);
        const tag = `${vpTag}-${dir}-${game}`;
        const fail = (m) => failures.push(`${tag}: ${m}`);
        /** A shot is only taken once the state it is supposed to show actually exists. */
        const shot = async (name, required) => {
          for (const sel of required) {
            if (!await cdp.evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)) {
              fail(`${name}: ${sel} is missing — nothing to photograph`);
              return false;
            }
          }
          const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
          if (!s?.result?.data) { fail(`${name}: the screenshot came back empty`); return false; }
          writeFileSync(`${OUT}/${tag}-${name}.png`, Buffer.from(s.result.data, 'base64'));
          shots++;
          return true;
        };

        await cdp.send('Page.navigate', { url: `${BASE}?${g.q}&chat=6&panel=none` });
        let ready = false;
        for (let i = 0; i < 150; i++) {
          if (await cdp.evaluate(`!!window.__socialReady && !!document.querySelector('${LAUNCHER}')`)) { ready = true; break; }
          await sleep(100);
        }
        if (!ready) { fail('the page never rendered'); continue; }

        await shot('1-closed', ['.game-stage', LAUNCHER]);

        await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('${LAUNCHER}')]
          .filter((x) => (x.textContent || '').includes('💬')); if (b[0]) b[0].click(); return !!b[0]; })()`);
        await cdp.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
        if (!await shot('2-open', [CHAT, '.chat-panel__list', '.chat-panel__compose'])) continue;

        if (!await cdp.click('.chat-picker-btn')) fail('cannot open the picker');
        if (!await shot('3-picker', [PICKER, '.chat-picker__emoji', STICKER])) continue;

        // A typed line + an ATTACHED animated sticker, before sending.
        if (!await cdp.click('.chat-input')) fail('cannot focus the message field');
        await cdp.type('привіт');
        if (!await cdp.click(STICKER)) fail('cannot pick a sticker');
        if (!await shot('4-combined', [ATTACH, '.chat-attach__img', '.chat-attach__remove'])) continue;

        // …and the same message posted: ONE bubble carrying both halves.
        const before = (await cdp.json('(window.__socialCalls || []).length')) ?? 0;
        if (!await cdp.click(SEND)) fail('cannot press Send');
        const calls = await cdp.json('window.__socialCalls || []');
        const posted = calls.slice(before);
        if (posted.length !== 1) fail(`Send produced ${posted.length} calls, expected exactly 1`);
        if (posted[0] && !posted[0].mediaId) fail('the sent message carried no attachment');
        // The harness records the send instead of echoing it, so paint the resulting bubble
        // from the SAME payload the server would have broadcast — one message, both halves.
        await cdp.evaluate(`window.__appendCombined && window.__appendCombined(${JSON.stringify('привіт')})`);
        await cdp.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
        await shot('5-sent', ['.chat-msg__text', '.chat-msg__media']);
      }
    }
    } finally {
      await owned.close();
    }
  });
  console.log(`${shots} screenshots → ${OUT}`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('SOCIAL SHOTS OK — closed / open / picker / combined / sent captured for Durak, 51 and Poker.');
  }
}
main();
