// Solitaire catalog (S2): what the hub lists. Separate from the table-game
// catalog (src/games/catalog.ts) — solitaires have no rooms, seats or bots.

import type { SolitaireId, VariantKey } from './engine';

export interface SolitaireInfo {
  id: SolitaireId;
  icon: string;
  /** i18n: `sol.<id>.title`, `sol.<id>.sub`, `sol.<id>.rules`. */
  variants: { key: VariantKey; labelKey: string | null }[];
  /** Columns of the widest row (card-size budget). */
  columns: number;
  /** Rough difficulty 1–3 for the hub badge. */
  difficulty: 1 | 2 | 3;
}

export const SOLITAIRES: readonly SolitaireInfo[] = [
  { id: 'klondike', icon: '🂡', columns: 7, difficulty: 2, variants: [{ key: 'klondike-1', labelKey: 'sol.klondike.draw1' }, { key: 'klondike-3', labelKey: 'sol.klondike.draw3' }] },
  { id: 'spider', icon: '🕷️', columns: 10, difficulty: 2, variants: [{ key: 'spider-1', labelKey: 'sol.spider.suits1' }, { key: 'spider-2', labelKey: 'sol.spider.suits2' }, { key: 'spider-4', labelKey: 'sol.spider.suits4' }] },
  { id: 'freecell', icon: '🧩', columns: 8, difficulty: 2, variants: [{ key: 'freecell', labelKey: null }] },
  { id: 'pyramid', icon: '🔺', columns: 7, difficulty: 1, variants: [{ key: 'pyramid', labelKey: null }] },
  { id: 'tripeaks', icon: '⛰️', columns: 10, difficulty: 1, variants: [{ key: 'tripeaks', labelKey: null }] },
  { id: 'yukon', icon: '❄️', columns: 7, difficulty: 3, variants: [{ key: 'yukon', labelKey: null }] },
  { id: 'forty-thieves', icon: '🗝️', columns: 10, difficulty: 3, variants: [{ key: 'forty-thieves', labelKey: null }] },
];

export const solitaireInfo = (id: SolitaireId): SolitaireInfo => SOLITAIRES.find((s) => s.id === id)!;
export const infoOfVariant = (key: VariantKey): SolitaireInfo => SOLITAIRES.find((s) => s.variants.some((v) => v.key === key))!;

/** "Klondike · Draw 3" style label pieces. */
export function variantLabelKeys(key: VariantKey): { title: string; variant: string | null } {
  const info = infoOfVariant(key);
  return { title: `sol.${info.id}.title`, variant: info.variants.find((v) => v.key === key)?.labelKey ?? null };
}
