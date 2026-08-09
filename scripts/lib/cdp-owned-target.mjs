// ---------------------------------------------------------------------------
// (Stage 38.0.16.2c) An OWNED CDP page target, and the viewport it actually has.
//
// WHY THIS EXISTS. Every layout gate used to acquire its page like this:
//
//     const targets = await fetchJson('/json');
//     const page = targets.find((t) => t.type === 'page');
//
// That creates nothing and guarantees nothing. It attaches to whichever page target
// happens to be listed first — Chrome's start page, a leftover tab, a target another
// script created in the same browser — and it re-attaches by the same blind rule on every
// call, so a run can silently measure a DIFFERENT page than the one it emulated. A
// measurement is worthless if you cannot say which document it came from.
//
// So: create our own target, remember its id, only ever talk to that id, and prove after
// every navigation that the document really has the viewport we asked for. `selfTest()`
// in `scripts/social-target-selftest.mjs` demonstrates the difference against a decoy.
// ---------------------------------------------------------------------------
import { get, request } from 'node:http';
import { createRequire } from 'node:module';

const WebSocket = createRequire(`${process.cwd()}/package.json`)('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function devtools(port, path) {
  return new Promise((res, rej) => get(`http://127.0.0.1:${port}${path}`, (r) => {
    let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch { res(d); } });
  }).on('error', rej));
}

/** `PUT /json/new` — the only DevTools endpoint that CREATES a target and tells us its id. */
function createTarget(port, url = 'about:blank') {
  return new Promise((res, rej) => {
    const req = request({ host: '127.0.0.1', port, path: `/json/new?${encodeURIComponent(url)}`, method: 'PUT' }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(`/json/new: ${d.slice(0, 200)}`)); } });
    });
    req.on('error', rej);
    req.end();
  });
}
function closeTarget(port, id) {
  return devtools(port, `/json/close/${id}`).catch(() => {});
}

export async function waitDevtools(port, timeout = 20000) {
  const start = Date.now();
  for (;;) {
    try { return await devtools(port, '/json/version'); }
    catch { if (Date.now() - start > timeout) throw new Error('chrome devtools not up'); await sleep(150); }
  }
}

export class CdpSession {
  constructor(url, targetId) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.targetId = targetId; }
  open() {
    return new Promise((res) => {
      this.ws.on('open', res);
      this.ws.on('message', (m) => {
        const o = JSON.parse(m.toString());
        if (o.id && this.pending.has(o.id)) { this.pending.get(o.id)(o); this.pending.delete(o.id); }
      });
    });
  }
  close() { try { this.ws.close(); } catch { /* already gone */ } }
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((res) => {
      const done = (v) => { clearTimeout(t); this.pending.delete(id); res(v); };
      const t = setTimeout(() => done({ __timeout: true }), timeoutMs);
      this.pending.set(id, done);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r?.__timeout ? undefined : r.result?.result?.value;
  }
  async json(expression) {
    for (let i = 0; i < 2; i++) {
      const raw = await this.evaluate(`JSON.stringify(${expression})`);
      if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { /* retry once */ } }
      await sleep(300);
    }
    return null;
  }
}

/**
 * Create a page target of our own and attach to it. The returned handle knows its id, so
 * every later measurement can be tied to a document instead of to "whatever was first".
 */
export async function openOwnedPage(port, SessionClass = CdpSession) {
  await waitDevtools(port);
  const created = await createTarget(port);
  const id = created.id ?? created.targetId;
  if (!id || !created.webSocketDebuggerUrl) {
    throw new Error(`could not create an owned target: ${JSON.stringify(created).slice(0, 200)}`);
  }
  // The caller may bring its own richer session (the layout gate has real mouse/typing
  // helpers on top of the same protocol) — what matters is that it talks to OUR target.
  const cdp = new SessionClass(created.webSocketDebuggerUrl, id);
  cdp.targetId = id;
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // A headless page has no system focus. Real mouse input still focuses fields, but
  // emulating focus makes the page behave like a phone in the player's hand throughout.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  return {
    cdp,
    targetId: id,
    async close() { cdp.close(); await closeTarget(port, id); },
  };
}

/**
 * What the document ACTUALLY has, next to what we asked for. `clientWidth` is deliberately
 * reported beside `innerWidth`: `scrollbar-gutter: stable` makes them differ by ~15px, and
 * a media query answers on `innerWidth` while the layout only ever gets `clientWidth` — so
 * any threshold computed against the viewport is 15px optimistic.
 */
export const VIEWPORT_PROBE = (thresholds) => `(() => ({
  innerWidth: window.innerWidth, innerHeight: window.innerHeight,
  clientWidth: document.documentElement.clientWidth,
  clientHeight: document.documentElement.clientHeight,
  dpr: window.devicePixelRatio,
  meta: !!document.querySelector('meta[name="viewport"]'),
  url: location.href,
  mm: Object.fromEntries(${JSON.stringify(thresholds)}.map((w) => [w, matchMedia('(min-width: ' + w + 'px)').matches])),
  gridColumns: (() => { const l = document.querySelector('.room-layout'); return l ? getComputedStyle(l).gridTemplateColumns : 'n/a'; })(),
  scrollY: Math.round(window.scrollY),
}))()`;

/**
 * Apply the metrics, then PROVE them. Returns the probe so a caller can log it; pushes a
 * human-readable line into `failures` for anything inconsistent.
 * Every failure line carries: requested | targetId | targetUrl | innerWidth | clientWidth |
 * mmThreshold | gridColumns — the seven facts needed to tell a real layout bug from a
 * harness that measured the wrong document.
 */
export async function applyViewport(owned, vp, thresholds = []) {
  await owned.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: !!vp.mobile,
  });
  return owned;
}

export async function checkViewport(owned, vp, thresholds, label, failures) {
  const probe = await owned.cdp.json(VIEWPORT_PROBE(thresholds));
  const line = (msg) => failures.push(
    `${label}: ${msg} | requested ${vp.w}x${vp.h} | target ${owned.targetId} | ${probe?.url ?? '?'} `
    + `| inner ${probe?.innerWidth ?? '?'} | client ${probe?.clientWidth ?? '?'} `
    + `| mm ${JSON.stringify(probe?.mm ?? {})} | cols ${probe?.gridColumns ?? '?'}`);
  if (!probe) { failures.push(`${label}: viewport probe returned nothing | target ${owned.targetId}`); return null; }
  if (Math.abs(probe.innerWidth - vp.w) > 1) line(`innerWidth is ${probe.innerWidth}, asked for ${vp.w}`);
  if (Math.abs(probe.innerHeight - vp.h) > 1) line(`innerHeight is ${probe.innerHeight}, asked for ${vp.h}`);
  if (!probe.meta) line('the page has no <meta name="viewport">');
  for (const w of thresholds) {
    const expected = probe.innerWidth >= w;
    if (probe.mm[w] !== expected) line(`matchMedia(min-width:${w}px)=${probe.mm[w]} at innerWidth ${probe.innerWidth}`);
  }
  return probe;
}

/** Scroll back to the top so one scenario cannot inherit the previous one's position. */
export async function resetScroll(owned) {
  await owned.cdp.evaluate('window.scrollTo(0, 0)');
  await owned.cdp.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
}
