import { describe, it, expect } from 'vitest';
import {
  normalizeFriendCode, formatFriendCode, isValidFriendCode,
  FRIEND_CODE_ALPHABET, FRIEND_CODE_PREFIX,
} from './friendCode';

describe('friendCode — normalize / format / validate', () => {
  it('formats a bare body into CM-XXXX-XXXX', () => {
    expect(formatFriendCode('A2B3C4D5')).toBe('CM-A2B3-C4D5');
  });

  it('normalises accepted variants to the canonical form (case / spaces / dashes / prefix)', () => {
    for (const v of ['CM-A2B3-C4D5', 'cm a2b3 c4d5', 'A2B3C4D5', 'a2b3c4d5', 'CMA2B3C4D5', '  cm_a2b3_c4d5 ']) {
      expect(normalizeFriendCode(v), v).toBe('CM-A2B3-C4D5');
    }
  });

  it('rejects the wrong length, ambiguous/invalid letters, and non-strings', () => {
    for (const bad of ['', 'CM-A2B3', 'A2B3C4D', 'A2B3C4D5E', 'CM-0OIL-UUUU', 'A2B3C4D!', null, undefined, 42]) {
      expect(normalizeFriendCode(bad as string), String(bad)).toBeNull();
    }
    expect(isValidFriendCode('CM-A2B3-C4D5')).toBe(true);
    expect(isValidFriendCode('nope')).toBe(false);
  });

  it('the alphabet excludes ambiguous characters (0/O/1/I/L/U)', () => {
    for (const ch of ['0', 'O', '1', 'I', 'L', 'U']) expect(FRIEND_CODE_ALPHABET).not.toContain(ch);
    expect(FRIEND_CODE_PREFIX).toBe('CM');
  });

  it('is idempotent (normalising the canonical form is a no-op)', () => {
    const c = normalizeFriendCode('cm a2b3 c4d5')!;
    expect(normalizeFriendCode(c)).toBe(c);
  });
});
