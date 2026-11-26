// ---------------------------------------------------------------------------
// Server error capture (Stage 44.0). Every `console.error('[King] …')` line the
// server already writes (they are debug-safe by construction — no SQL params, no
// secrets) is also masked, fingerprinted and buffered, then flushed into
// `server_errors` every 5 s. An uncaught exception is captured via the MONITOR
// event, which observes without changing Node's crash behaviour.
// ---------------------------------------------------------------------------

import { errorFingerprint, maskErrorText } from '../../src/net/admin';
import type { ErrorBatchItem } from './store';

const MAX_FINGERPRINTS = 50;
const FLUSH_MS = 5000;
const buffer = new Map<string, ErrorBatchItem>();
let installed = false;
let flushing = false;

/** Adds one error to the buffer (dropped silently once the buffer is full). */
export function reportServerError(where: string, err: unknown): void {
  const raw = err instanceof Error ? err.message : String(err);
  const message = maskErrorText(raw).slice(0, 500);
  const stack = err instanceof Error && err.stack ? maskErrorText(err.stack).slice(0, 2000) : null;
  const fp = errorFingerprint(where, message);
  const cur = buffer.get(fp);
  if (cur) { cur.count += 1; return; }
  if (buffer.size >= MAX_FINGERPRINTS) return;
  buffer.set(fp, { fingerprint: fp, where, message, stack, count: 1 });
}

/** Test hook: what is waiting to be flushed. */
export function pendingErrors(): ErrorBatchItem[] { return [...buffer.values()]; }
export function clearPendingErrors(): void { buffer.clear(); }

async function flush(): Promise<void> {
  if (flushing || buffer.size === 0) return;
  flushing = true;
  const items = [...buffer.values()];
  buffer.clear();
  try {
    const { upsertErrors } = await import('./store');
    await upsertErrors(items);
  } catch {
    // The DB itself is down: drop this batch (the console line is still in the host log).
  } finally {
    flushing = false;
  }
}

/** Splits "[King] DB error on GET /api/me → boom" into a short `where` and the rest. */
export function splitLogLine(args: readonly unknown[]): { where: string; err: unknown } | null {
  const first = args[0];
  if (typeof first !== 'string' || !first.startsWith('[King]')) return null;
  const body = first.slice('[King]'.length).trim();
  const errArg = args.find((a) => a instanceof Error);
  const where = (body.split(/[:→]/)[0] ?? 'server').trim().slice(0, 80) || 'server';
  const rest = args.slice(1).map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
  return { where, err: errArg ?? `${body}${rest ? ` ${rest}` : ''}` };
}

export function installErrorCapture(dbEnabled: boolean): void {
  if (installed || !dbEnabled) return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    try {
      const parsed = splitLogLine(args);
      if (parsed) reportServerError(parsed.where, parsed.err);
    } catch { /* never let capture break logging */ }
  };
  process.on('uncaughtExceptionMonitor', (err) => {
    reportServerError('uncaught', err);
    void flush();
  });
  const t = setInterval(() => { void flush(); }, FLUSH_MS);
  t.unref?.();
}
