/**
 * Deterministic RNG + tiny hash, used for reproducible server-side deals.
 *
 * The game core uses `Math.random` by default (local play is unaffected). When
 * a seeded RNG is supplied (server-authoritative deals), the same seed always
 * produces the same shuffle and first-dealer pick, so a round can be replayed
 * or audited from its recorded seed.
 */

export type Rng = () => number;

/** mulberry32 — small, fast, deterministic PRNG returning [0, 1). */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh 32-bit seed (non-deterministic — used to seed a round on the server). */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0x100000000)) >>> 0;
}

/** FNV-1a 32-bit hash of a string → 8-char hex. Used for deal fingerprints. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
