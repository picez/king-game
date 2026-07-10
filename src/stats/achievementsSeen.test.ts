import { describe, it, expect } from 'vitest';
import type { StorageLike } from '../net/session';
import type { AchievementProgress } from './achievements';
import { ACHIEVEMENTS } from './achievements';
import {
  ACHIEVEMENTS_SEEN_KEY, earnedIds, loadSeen, saveSeen,
  newlyEarned, unseenEarned, markSeen,
} from './achievementsSeen';

/** Minimal in-memory StorageLike for round-trip + tamper tests. */
function memStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

const rows = (earnedById: Record<string, boolean>): AchievementProgress[] =>
  ACHIEVEMENTS.map((a) => ({ achievement: a, earned: !!earnedById[a.id] }));

describe('earnedIds', () => {
  it('returns only the earned ids, in catalog order', () => {
    const got = earnedIds(rows({ 'first-win': true, 'centurion': true }));
    expect(got).toEqual(['first-win', 'centurion']);
  });
  it('is empty when nothing is earned', () => {
    expect(earnedIds(rows({}))).toEqual([]);
  });
});

describe('newlyEarned — diff previous vs next', () => {
  it('returns ids present in next but not previous', () => {
    expect(newlyEarned(['a', 'b'], ['a', 'b', 'c'])).toEqual(['c']);
  });
  it('is empty when nothing changed', () => {
    expect(newlyEarned(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
  it('ignores ids that were lost (never happens for monotonic stats, but safe)', () => {
    expect(newlyEarned(['a', 'b'], ['a'])).toEqual([]);
  });
});

describe('unseenEarned — ignores already seen', () => {
  it('drops earned ids that are already in the seen set', () => {
    expect(unseenEarned(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
  });
  it('returns all earned when nothing seen', () => {
    expect(unseenEarned(['a', 'b'], [])).toEqual(['a', 'b']);
  });
  it('returns nothing when all earned are seen', () => {
    expect(unseenEarned(['a'], ['a', 'b'])).toEqual([]);
  });
});

describe('loadSeen / saveSeen — round-trip', () => {
  it('persists and reads back the list (deduped)', () => {
    const s = memStorage();
    saveSeen(['a', 'b', 'a'], s);
    expect(s.map.get(ACHIEVEMENTS_SEEN_KEY)).toBe(JSON.stringify(['a', 'b']));
    expect(loadSeen(s)).toEqual(['a', 'b']);
  });
  it('reads empty when unset', () => {
    expect(loadSeen(memStorage())).toEqual([]);
  });
  it('null storage degrades to empty (no throw)', () => {
    expect(loadSeen(null)).toEqual([]);
    expect(() => saveSeen(['a'], null)).not.toThrow();
  });
});

describe('loadSeen — tampered storage is safe', () => {
  it('non-JSON → empty', () => {
    expect(loadSeen(memStorage({ [ACHIEVEMENTS_SEEN_KEY]: '{not json' }))).toEqual([]);
  });
  it('JSON but not an array → empty', () => {
    expect(loadSeen(memStorage({ [ACHIEVEMENTS_SEEN_KEY]: '{"a":1}' }))).toEqual([]);
  });
  it('array with non-string / blank members → only clean strings kept', () => {
    const raw = JSON.stringify(['a', 1, null, '', 'b', true]);
    expect(loadSeen(memStorage({ [ACHIEVEMENTS_SEEN_KEY]: raw }))).toEqual(['a', 'b']);
  });
});

describe('markSeen — union + persist', () => {
  it('merges new ids into the existing ledger and returns it', () => {
    const s = memStorage();
    saveSeen(['a'], s);
    expect(markSeen(['b', 'a', 'c'], s)).toEqual(['a', 'b', 'c']);
    expect(loadSeen(s)).toEqual(['a', 'b', 'c']);
  });
  it('is idempotent when the ids are already seen', () => {
    const s = memStorage();
    saveSeen(['a', 'b'], s);
    expect(markSeen(['a', 'b'], s)).toEqual(['a', 'b']);
  });
});
