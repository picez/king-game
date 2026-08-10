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

/** The default per-command budget. Unchanged from the value the social gate already used. */
export const CDP_TIMEOUT_MS = 20000;

/**
 * (38.0.16.2c.2) A CDP command that did not answer is a HARNESS failure, and it now says so.
 *
 * The old `send()` resolved with `{ __timeout: true }`. `evaluate()` turned that into
 * `undefined` and every caller carried on. The cost is not one lost command: `load()` polls
 * its marker `for (let i = 0; i < 200; i++) { await cdp.evaluate(...) }`, so ONE renderer
 * that stops answering becomes 200 × 20s = 66 minutes of silent waiting per attempt, twice
 * over for the retry. That is what a "hang" on the behaviour phase actually was — an
 * ignored return value multiplied by a polling loop, not a deadlock.
 *
 * A timeout is therefore thrown, carries everything needed to place it, and is never
 * convertible into a layout violation.
 */
export class CdpTimeoutError extends Error {
  constructor({ method, timeoutMs, targetId, context, pendingCount }) {
    super(`CDP command timed out after ${timeoutMs}ms: ${method}`
      + ` | context ${context}` + ` | target ${targetId}` + ` | ${pendingCount} command(s) pending`);
    this.name = 'CdpTimeoutError';
    Object.assign(this, { method, timeoutMs, targetId, context, pendingCount });
  }
}

/** The socket went away while commands were in flight — every one of them must reject. */
export class CdpClosedError extends Error {
  constructor({ method, targetId, context, reason }) {
    super(`CDP connection ${reason} with a command in flight: ${method}`
      + ` | context ${context} | target ${targetId}`);
    this.name = 'CdpClosedError';
    Object.assign(this, { method, targetId, context, reason });
  }
}

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
  /**
   * `socketFactory` exists so the timeout / close / pending-cleanup behaviour can be proved
   * against a controlled socket in `npm test`, with no browser and no real port.
   */
  constructor(url, targetId, { socketFactory = (u) => new WebSocket(u) } = {}) {
    this.ws = socketFactory(url);
    this.id = 0;
    this.pending = new Map();
    this.targetId = targetId;
    /** The scenario this session is currently driving — printed by every failure. */
    this.context = 'startup';
    this.dead = null;
  }
  /** Name what we are doing, so a timeout can say WHERE it happened, not only WHAT. */
  setContext(context) { this.context = context; return this; }

  /** Reject every command still in flight. Nothing may be left unresolved. */
  #failAllPending(reason) {
    this.dead = this.dead ?? reason;
    const inFlight = [...this.pending.values()];
    this.pending.clear();
    for (const entry of inFlight) {
      clearTimeout(entry.timer);
      entry.reject(new CdpClosedError({
        method: entry.method, targetId: this.targetId, context: this.context, reason,
      }));
    }
  }
  open() {
    return new Promise((res) => {
      this.ws.on('open', res);
      this.ws.on('message', (m) => {
        const o = JSON.parse(m.toString());
        const entry = o.id && this.pending.get(o.id);
        if (entry) { clearTimeout(entry.timer); this.pending.delete(o.id); entry.resolve(o); }
      });
      // A socket that dies with commands in flight used to leave those promises for ever.
      this.ws.on('close', () => this.#failAllPending('closed'));
      this.ws.on('error', () => this.#failAllPending('errored'));
    });
  }
  close() { try { this.ws.close(); } catch { /* already gone */ } this.#failAllPending('closed'); }

  send(method, params = {}, timeoutMs = CDP_TIMEOUT_MS) {
    if (this.dead) {
      return Promise.reject(new CdpClosedError({
        method, targetId: this.targetId, context: this.context, reason: this.dead,
      }));
    }
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpTimeoutError({
          method, timeoutMs, targetId: this.targetId, context: this.context,
          pendingCount: this.pending.size,
        }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) {
        clearTimeout(timer); this.pending.delete(id);
        reject(new CdpClosedError({ method, targetId: this.targetId, context: this.context, reason: `unsendable (${e.message})` }));
      }
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
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
export async function applyViewport(owned, vp, extra = {}) {
  await owned.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: !!vp.mobile, ...extra,
  });
  return owned;
}

/**
 * (38.0.16.2d) The identity + viewport proof, in one call, for gates that do not need the
 * social gate's full navigation lifecycle. Answers the four questions a measurement is
 * worthless without: is this OUR target, is it on the page we asked for, is the window the
 * size we requested, and does the page declare a viewport at all. Returns failure lines, so
 * a gate can refuse to measure exactly as `load()` does.
 */
export async function provePage(owned, vp, requestedUrl, label, thresholds = []) {
  const probe = await owned.cdp.evaluate(PROOF_PROBE(thresholds));
  return validateProof(probe, vp, thresholds, label, owned, requestedUrl);
}

/**
 * ONE round-trip that does the whole post-navigation proof on the already-loaded document:
 * scroll to the top, wait two frames, then collect viewport / meta / media / URL / grid /
 * scrollY together. Four separate CDP evaluates per navigation turned into one; no
 * invariant is dropped — `validateProof` below still checks every one of them.
 */
export const PROOF_PROBE = (thresholds) => `(async () => {
  window.scrollTo(0, 0);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return ${VIEWPORT_PROBE(thresholds)};
})()`;

/** Pure: turn one proof result into failure lines. No I/O, so it is trivially testable. */
export function validateProof(probe, vp, thresholds, label, owned, requestedUrl) {
  const out = [];
  const facts = (p) => `requested ${vp.w}x${vp.h} | target ${owned.targetId} | ${p?.url ?? requestedUrl ?? '?'}`
    + ` | inner ${p?.innerWidth ?? '?'} | client ${p?.clientWidth ?? '?'}`
    + ` | mm ${JSON.stringify(p?.mm ?? {})} | cols ${p?.gridColumns ?? '?'}`;
  // `mm` missing means the probe never resolved (e.g. a JSON.stringify(Promise) wrapper),
  // which is a harness bug, not a layout one — say so instead of reading through undefined.
  if (!probe || !probe.mm) {
    return [`${label}: the proof probe returned ${JSON.stringify(probe)} | target ${owned.targetId}`];
  }
  const add = (msg) => out.push(`${label}: ${msg} | ${facts(probe)}`);
  if (Math.abs(probe.innerWidth - vp.w) > 1) add(`innerWidth is ${probe.innerWidth}, asked for ${vp.w}`);
  if (Math.abs(probe.innerHeight - vp.h) > 1) add(`innerHeight is ${probe.innerHeight}, asked for ${vp.h}`);
  if (!probe.meta) add('the page has no <meta name="viewport">');
  for (const w of thresholds) {
    const expected = probe.innerWidth >= w;
    if (probe.mm[w] !== expected) add(`matchMedia(min-width:${w}px)=${probe.mm[w]} at innerWidth ${probe.innerWidth}`);
  }
  if (requestedUrl && !samePageUrl(probe.url, requestedUrl)) add(`asked for ${requestedUrl} but the page reports ${probe.url}`);
  if (probe.scrollY !== 0) add(`scrollY is ${probe.scrollY} after the reset`);
  return out;
}

/** Same document, ignoring how the host was spelled (localhost vs 127.0.0.1). */
export function samePageUrl(actual, requested) {
  try {
    const a = new URL(actual), b = new URL(requested);
    return a.pathname === b.pathname && a.search === b.search;
  } catch { return false; }
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

// (38.0.16.2c.2) Process ownership — spawning, port checks and tree cleanup — now lives in
// `scripts/lib/qa-processes.mjs`, shared by both gates. It was here only because the
// cleanup was written while chasing a CDP bug; it is not a CDP concern, and having one copy
// per gate is what let the shell-wrapper leak survive as long as it did.
