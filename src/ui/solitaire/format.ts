import { variantLabelKeys } from '../../solitaire/catalog';
import type { VariantKey } from '../../solitaire/engine';

/** 75_000 → "1:15", 3_725_000 → "1:02:05". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "Косинка · По 1 карті" — a variant's full name. */
export function labelOf(t: (k: string) => string, key: VariantKey): string {
  const l = variantLabelKeys(key);
  return l.variant ? `${t(l.title)} · ${t(l.variant)}` : t(l.title);
}
