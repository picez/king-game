import { describe, it, expect } from 'vitest';
import {
  isValidSdp, isValidIce, shouldOffer, MAX_SDP_BYTES, MAX_ICE_BYTES,
} from './voiceSignal';

describe('voiceSignal — size caps', () => {
  it('accepts a non-empty SDP/ICE within the cap; rejects empty / oversized / non-string', () => {
    expect(isValidSdp('v=0...')).toBe(true);
    expect(isValidSdp('')).toBe(false);
    expect(isValidSdp('x'.repeat(MAX_SDP_BYTES))).toBe(true);
    expect(isValidSdp('x'.repeat(MAX_SDP_BYTES + 1))).toBe(false);
    expect(isValidSdp(42)).toBe(false);
    expect(isValidIce('candidate:...')).toBe(true);
    expect(isValidIce('x'.repeat(MAX_ICE_BYTES + 1))).toBe(false);
    expect(isValidIce(null)).toBe(false);
    // SDP cap is larger than ICE (an SDP is bigger than a single candidate).
    expect(MAX_SDP_BYTES).toBeGreaterThan(MAX_ICE_BYTES);
  });
});

describe('voiceSignal — glare rule (lower clientId offers)', () => {
  it('exactly one side offers for any pair, never against self', () => {
    expect(shouldOffer('aaa', 'bbb')).toBe(true);
    expect(shouldOffer('bbb', 'aaa')).toBe(false);
    expect(shouldOffer('x', 'x')).toBe(false);
    // Deterministic + antisymmetric for a real pair.
    const a = 'client-1', b = 'client-2';
    expect(shouldOffer(a, b)).not.toBe(shouldOffer(b, a));
  });
});
