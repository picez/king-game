// ---------------------------------------------------------------------------
// (Stage 38.0.16.2c.2) CDP command lifetime + the atomic post-navigation proof.
//
// These run against a CONTROLLED socket, so they need no browser, no port and no Chrome —
// `npm test` runs them on CI. The end-to-end version (the real gate dying fast and giving
// its ports back) is phases 7-8 of `npm run layout:selftest`.
//
// What they guard: `send()` used to RESOLVE `{ __timeout: true }` on a timeout. Callers
// ignored it, and `load()` polls its marker 200 times, so a single unanswered command became
// 200 × 20s of silent waiting per attempt — a "hang" that was really an ignored return value
// multiplied by a loop.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from 'vitest';
import {
  CdpSession, CdpTimeoutError, CdpClosedError, CDP_TIMEOUT_MS,
  PROOF_PROBE, VIEWPORT_PROBE, validateProof, samePageUrl,
} from './cdp-owned-target.mjs';

/** A socket that records what was sent and answers only when the test says so. */
function fakeSocket({ autoOpen = true } = {}) {
  const handlers = new Map();
  const sock = {
    sent: [],
    on(event, fn) { handlers.set(event, [...(handlers.get(event) ?? []), fn]); return sock; },
    emit(event, ...a) { for (const fn of handlers.get(event) ?? []) fn(...a); },
    send(raw) { sock.sent.push(JSON.parse(raw)); },
    close() { sock.emit('close'); },
  };
  if (autoOpen) queueMicrotask(() => sock.emit('open'));
  return sock;
}
async function session(sock, targetId = 'TARGET-1') {
  const cdp = new CdpSession('ws://unused', targetId, { socketFactory: () => sock });
  await cdp.open();
  return cdp;
}
const reply = (sock, id, result) => sock.emit('message', Buffer.from(JSON.stringify({ id, result })));

describe('CdpSession.send — a command that answers', () => {
  it('resolves with the reply and leaves nothing pending', async () => {
    const sock = fakeSocket();
    const cdp = await session(sock);
    const p = cdp.send('Runtime.evaluate', { expression: '1' });
    expect(cdp.pending.size).toBe(1);
    reply(sock, sock.sent[0].id, { result: { value: 7 } });
    await expect(p).resolves.toMatchObject({ result: { result: { value: 7 } } });
    expect(cdp.pending.size).toBe(0);
  });

  it('evaluate returns the value, not a sentinel', async () => {
    const sock = fakeSocket();
    const cdp = await session(sock);
    const p = cdp.evaluate('1 + 1');
    reply(sock, sock.sent[0].id, { result: { value: 2 } });
    await expect(p).resolves.toBe(2);
  });
});

describe('CdpSession.send — a command that never answers', () => {
  it('REJECTS with a typed error instead of resolving a sentinel', async () => {
    vi.useFakeTimers();
    try {
      const sock = fakeSocket();
      const cdp = await session(sock, 'ABC123');
      cdp.setContext('390 | durak | ltr | typing-caret');
      const p = cdp.send('Input.dispatchMouseEvent', {}, 1000);
      const seen = p.catch((e) => e);
      await vi.advanceTimersByTimeAsync(1001);
      const err = await seen;
      expect(err).toBeInstanceOf(CdpTimeoutError);
      expect(err.method).toBe('Input.dispatchMouseEvent');
      expect(err.timeoutMs).toBe(1000);
      expect(err.targetId).toBe('ABC123');
      expect(err.context).toBe('390 | durak | ltr | typing-caret');
      expect(err.pendingCount).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('names method, context, target, budget and pending count in the message', async () => {
    vi.useFakeTimers();
    try {
      const sock = fakeSocket();
      const cdp = await session(sock, 'ABC123');
      cdp.setContext('390 durak/ltr/sticker');
      const other = cdp.send('Runtime.evaluate', {}, 60000).catch(() => 'ignored');
      const p = cdp.send('Page.captureScreenshot', {}, 1000).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1001);
      const err = await p;
      expect(err.message).toContain('Page.captureScreenshot');
      expect(err.message).toContain('390 durak/ltr/sticker');
      expect(err.message).toContain('ABC123');
      expect(err.message).toContain('1000ms');
      // The OTHER command is still in flight, and the error says so.
      expect(err.message).toContain('1 command(s) pending');
      cdp.close();
      await other;
    } finally { vi.useRealTimers(); }
  });

  it('removes the pending entry, so a late reply cannot resurrect it', async () => {
    vi.useFakeTimers();
    try {
      const sock = fakeSocket();
      const cdp = await session(sock);
      const p = cdp.send('Runtime.evaluate', {}, 1000).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1001);
      await p;
      expect(cdp.pending.size).toBe(0);
      // A reply arriving after the timeout must be dropped without throwing.
      expect(() => reply(sock, sock.sent[0].id, { result: { value: 1 } })).not.toThrow();
      expect(cdp.pending.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('a timeout does not stop the session from reporting the next one', async () => {
    vi.useFakeTimers();
    try {
      const sock = fakeSocket();
      const cdp = await session(sock);
      const first = cdp.send('A.one', {}, 500).catch((e) => e.method);
      await vi.advanceTimersByTimeAsync(501);
      expect(await first).toBe('A.one');
      const second = cdp.send('B.two', {}, 500).catch((e) => e.method);
      await vi.advanceTimersByTimeAsync(501);
      expect(await second).toBe('B.two');
    } finally { vi.useRealTimers(); }
  });

  it('the default budget was not quietly raised', () => {
    expect(CDP_TIMEOUT_MS).toBe(20000);
  });
});

describe('CdpSession — a socket that dies with commands in flight', () => {
  it('rejects EVERY pending command on close, and empties the map', async () => {
    const sock = fakeSocket();
    const cdp = await session(sock, 'T9');
    cdp.setContext('phase under test');
    const a = cdp.send('A.one', {}, 60000).catch((e) => e);
    const b = cdp.send('B.two', {}, 60000).catch((e) => e);
    expect(cdp.pending.size).toBe(2);
    sock.emit('close');
    const [ea, eb] = [await a, await b];
    for (const e of [ea, eb]) {
      expect(e).toBeInstanceOf(CdpClosedError);
      expect(e.targetId).toBe('T9');
      expect(e.context).toBe('phase under test');
      expect(e.reason).toBe('closed');
    }
    expect(ea.method).toBe('A.one');
    expect(eb.method).toBe('B.two');
    expect(cdp.pending.size).toBe(0);
  });

  it('rejects pending commands on a socket error too', async () => {
    const sock = fakeSocket();
    const cdp = await session(sock);
    const p = cdp.send('A.one', {}, 60000).catch((e) => e);
    sock.emit('error', new Error('ECONNRESET'));
    expect((await p).reason).toBe('errored');
    expect(cdp.pending.size).toBe(0);
  });

  it('refuses to send on a dead session instead of hanging until the budget', async () => {
    const sock = fakeSocket();
    const cdp = await session(sock);
    sock.emit('close');
    await expect(cdp.send('A.one')).rejects.toBeInstanceOf(CdpClosedError);
    expect(cdp.pending.size).toBe(0);
  });

  it('close() while idle is harmless and still leaves nothing pending', async () => {
    const sock = fakeSocket();
    const cdp = await session(sock);
    expect(() => cdp.close()).not.toThrow();
    expect(cdp.pending.size).toBe(0);
  });

  it('an unsendable command rejects rather than sitting in the map', async () => {
    const sock = fakeSocket();
    sock.send = () => { throw new Error('socket is closing'); };
    const cdp = await session(sock);
    const e = await cdp.send('A.one').catch((x) => x);
    expect(e).toBeInstanceOf(CdpClosedError);
    expect(e.reason).toContain('socket is closing');
    expect(cdp.pending.size).toBe(0);
  });
});

describe('the post-navigation proof is atomic', () => {
  it('is one async expression that RESOLVES — never a stringified promise', () => {
    const probe = PROOF_PROBE([1440, 1620]);
    expect(probe.startsWith('(async () =>')).toBe(true);
    // The thresholds are baked in at build time, so nothing is left to stringify at runtime.
    expect(probe).not.toContain('JSON.stringify(');
    expect(probe).toContain('window.scrollTo(0, 0)');
    expect(probe).toContain('requestAnimationFrame');
    expect(probe).toContain('matchMedia');
    expect(probe).toContain('[1440,1620]');
  });

  it('carries every fact the validator needs', () => {
    for (const key of ['innerWidth', 'innerHeight', 'clientWidth', 'meta', 'url', 'mm', 'gridColumns', 'scrollY']) {
      expect(VIEWPORT_PROBE([1440])).toContain(key);
    }
  });
});

describe('validateProof', () => {
  const vp = { w: 390, h: 844 };
  const owned = { targetId: 'TID' };
  const URL_ = 'http://localhost:5201/scripts/layout-harness/social-games.html?game=durak';
  const good = {
    innerWidth: 390, innerHeight: 844, clientWidth: 375, clientHeight: 844, dpr: 1,
    meta: true, url: URL_, mm: { 1440: false, 1620: false }, gridColumns: '390px', scrollY: 0,
  };
  const run = (p, over = {}) => validateProof({ ...p, ...over }, vp, [1440, 1620], 'L', owned, URL_);

  it('passes a correct proof', () => {
    expect(run(good)).toEqual([]);
  });

  it('names a malformed probe as a HARNESS failure, not a layout one', () => {
    for (const bad of [undefined, null, {}, { innerWidth: 390 }]) {
      const lines = validateProof(bad, vp, [1440], 'L', owned, URL_);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('the proof probe returned');
      expect(lines[0]).toContain('TID');
      // Non-empty is exactly what keeps `proved: false` and stops geometry from running.
      expect(lines.length).toBeGreaterThan(0);
    }
  });

  it('catches a wrong viewport, a missing meta tag and a lying media query', () => {
    expect(run(good, { innerWidth: 2560 })[0]).toContain('innerWidth is 2560, asked for 390');
    expect(run(good, { innerHeight: 1440 })[0]).toContain('innerHeight is 1440');
    expect(run(good, { meta: false })[0]).toContain('no <meta name="viewport">');
    expect(run(good, { mm: { 1440: true, 1620: false } })[0]).toContain('matchMedia(min-width:1440px)=true');
  });

  it('catches the wrong page and a page that is not at the top', () => {
    expect(run(good, { url: 'http://localhost:5201/other.html' })[0]).toContain('but the page reports');
    expect(run(good, { scrollY: 240 })[0]).toContain('scrollY is 240 after the reset');
  });

  it('every failure carries the seven facts needed to place it', () => {
    const line = run(good, { innerWidth: 2560 })[0];
    for (const fact of ['requested 390x844', 'target TID', 'social-games.html', 'inner 2560', 'client 375', 'mm {', 'cols 390px']) {
      expect(line).toContain(fact);
    }
  });

  it('does not treat the scrollbar gutter as a mismatch', () => {
    expect(run(good, { clientWidth: 375 })).toEqual([]);
  });
});

describe('samePageUrl', () => {
  it('ignores how the host was spelled but not which page it is', () => {
    expect(samePageUrl('http://127.0.0.1:5201/a.html?x=1', 'http://localhost:5201/a.html?x=1')).toBe(true);
    expect(samePageUrl('http://localhost:5201/a.html?x=2', 'http://localhost:5201/a.html?x=1')).toBe(false);
    expect(samePageUrl('http://localhost:5201/b.html', 'http://localhost:5201/a.html')).toBe(false);
    expect(samePageUrl('not a url', 'http://localhost:5201/a.html')).toBe(false);
  });
});
