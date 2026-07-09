import { describe, it, expect } from 'vitest';
import {
  BOT_NAME_POOL, BOT_NAME_SUFFIX, botIdentity, nextBotIdentity, localBotNames, botDisplayName,
} from './botIdentities';
import { AVATARS } from '../core/avatars';

describe('bot identity pool (Stage 13.6)', () => {
  it('has 20–40 short, non-"Bot N", suffix-free base names', () => {
    expect(BOT_NAME_POOL.length).toBeGreaterThanOrEqual(20);
    expect(BOT_NAME_POOL.length).toBeLessThanOrEqual(40);
    expect(new Set(BOT_NAME_POOL).size).toBe(BOT_NAME_POOL.length); // no duplicates
    for (const base of BOT_NAME_POOL) {
      expect(base.length).toBeGreaterThanOrEqual(2);
      expect(base.length).toBeLessThanOrEqual(6);         // short → mobile-safe
      expect(base).not.toMatch(/^Bot/i);                  // not "Bot N"
      expect(base).not.toMatch(/\s/);                     // single token
    }
  });

  it('display name is the base plus the (untranslated) " AI" suffix', () => {
    expect(BOT_NAME_SUFFIX).toBe('AI');
    expect(botDisplayName('Mira')).toBe('Mira AI');
    // Every produced name reads as a bot and stays short.
    for (let i = 0; i < 32; i++) {
      const n = botIdentity('room', i).name;
      expect(n.endsWith(' AI')).toBe(true);
      expect(n).not.toMatch(/^Bot \d+$/);
      expect(n.length).toBeLessThanOrEqual(9); // ≤ 6 base + " AI"
    }
  });
});

describe('botIdentity determinism + variety', () => {
  it('is deterministic: same (seed, index) → same name + avatar', () => {
    expect(botIdentity('ABCD:king', 0)).toEqual(botIdentity('ABCD:king', 0));
    expect(botIdentity('ABCD:king', 2)).toEqual(botIdentity('ABCD:king', 2));
    // Different seed OR index generally differs (varies the identity).
    expect(botIdentity('ABCD:king', 0)).not.toEqual(botIdentity('WXYZ:king', 0));
  });

  it('every avatar comes from the existing whitelist (no new assets, not 🤖)', () => {
    for (let i = 0; i < 40; i++) {
      const { avatar } = botIdentity(`seed${i}`, i);
      expect(AVATARS.includes(avatar)).toBe(true);
      expect(avatar).not.toBe('🤖');
    }
  });

  it('produces real variation across indices (not all identical)', () => {
    const names = new Set(Array.from({ length: 8 }, (_, i) => botIdentity('ABCD:durak', i).name));
    expect(names.size).toBeGreaterThanOrEqual(4); // clearly varied
  });
});

describe('nextBotIdentity de-duplicates within a room', () => {
  it('never reuses a taken name/avatar while the pools allow', () => {
    const takenNames = new Set<string>(['You']);
    const takenAvatars = new Set<string>([AVATARS[0]]);
    const picks = [];
    for (let i = 0; i < 3; i++) { // 4-seat room: 1 human + 3 bots
      const id = nextBotIdentity('ABCD:tarneeb', i, takenNames, takenAvatars);
      picks.push(id);
      takenNames.add(id.name);
      takenAvatars.add(id.avatar);
    }
    expect(new Set(picks.map((p) => p.name)).size).toBe(3);   // distinct names
    expect(new Set(picks.map((p) => p.avatar)).size).toBe(3); // distinct avatars
    expect(picks.some((p) => p.avatar === AVATARS[0])).toBe(false); // avoided the human's
  });

  it('is still deterministic with the same taken sets', () => {
    const t = new Set(['You']);
    expect(nextBotIdentity('R:king', 1, t)).toEqual(nextBotIdentity('R:king', 1, t));
  });
});

describe('localBotNames', () => {
  it('returns N distinct " AI" names, none colliding with the human', () => {
    const names = localBotNames('durak', 3, ['You']);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names.includes('You')).toBe(false);
    for (const n of names) expect(n.endsWith(' AI')).toBe(true);
  });

  it('is deterministic per (seed, count)', () => {
    expect(localBotNames('tarneeb', 3, ['You'])).toEqual(localBotNames('tarneeb', 3, ['You']));
  });
});
