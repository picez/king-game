import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from './adminApi';

/** Loads `fn()` when `deps` change; `reload` re-runs it. Optional auto-refresh. */
export function useAdminData<T>(fn: () => Promise<T>, deps: unknown[], refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const v = await fnRef.current();
      if (my === seq.current) { setData(v); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(errorText(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, deps);
  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, refreshMs);
    return () => clearInterval(t);
  }, [refreshMs, reload]);
  return { data, error, loading, reload, setData };
}

/** Runs an admin action with a busy flag + a result message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>, okText: string): Promise<boolean> => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); return true; }
    catch (e) { setMsg({ ok: false, text: errorText(e) }); return false; }
    finally { setBusy(false); }
  }, []);
  return { busy, msg, run, setMsg };
}
