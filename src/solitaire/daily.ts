// Deal of the day (S1): everyone gets the same deal per variant per UTC day.

import { hashString } from '../core/rng';
import type { VariantKey } from './engine';

/** YYYY-MM-DD in UTC. */
export const utcDay = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

export function dailySeed(key: VariantKey, day: string): number {
  return parseInt(hashString(`card-majlis/solitaire/${key}/${day}`), 16) >>> 0;
}

export const isUtcDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
