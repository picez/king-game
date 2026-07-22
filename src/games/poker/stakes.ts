// ---------------------------------------------------------------------------
// Poker online bankroll stakes (Stage 37.7 §16). Pure whitelist + derivations shared
// by the host picker (client) and the server validation. The buy-in is ALWAYS 100 big
// blinds and is DERIVED server-side from the chosen preset — a client never supplies an
// authoritative buy-in. Local free-play does NOT use these (it uses a starting-stack
// selector with fixed 10/20 blinds). No DB / I/O.
// ---------------------------------------------------------------------------

/** One approved online stakes level. `buyIn` is always `bigBlind * 100`. */
export interface PokerStakesPreset {
  smallBlind: number;
  bigBlind: number;
  buyIn: number;
}

/** Buy-in is always 100 big blinds. */
export const BUY_IN_BIG_BLINDS = 100;

/** The 8 approved online stakes (§16 B). Buy-in derived = bigBlind × 100. */
export const STAKES_PRESETS: readonly PokerStakesPreset[] = [
  { smallBlind: 25, bigBlind: 50, buyIn: 5_000 },
  { smallBlind: 50, bigBlind: 100, buyIn: 10_000 },
  { smallBlind: 100, bigBlind: 200, buyIn: 20_000 },
  { smallBlind: 200, bigBlind: 400, buyIn: 40_000 },
  { smallBlind: 400, bigBlind: 800, buyIn: 80_000 },
  { smallBlind: 800, bigBlind: 1_600, buyIn: 160_000 },
  { smallBlind: 1_600, bigBlind: 3_200, buyIn: 320_000 },
  { smallBlind: 3_200, bigBlind: 6_400, buyIn: 640_000 },
] as const;

/** Derive the buy-in for a big blind (100 BB). Pure. */
export function buyInForBigBlind(bigBlind: number): number {
  return bigBlind * BUY_IN_BIG_BLINDS;
}

/** Find the approved preset for a (smallBlind, bigBlind) pair, or null if not whitelisted. */
export function findStakesPreset(smallBlind: unknown, bigBlind: unknown): PokerStakesPreset | null {
  return STAKES_PRESETS.find((p) => p.smallBlind === smallBlind && p.bigBlind === bigBlind) ?? null;
}

/** True when (sb, bb) is exactly one of the approved presets (server whitelist gate). */
export function isApprovedStakes(smallBlind: unknown, bigBlind: unknown): boolean {
  return findStakesPreset(smallBlind, bigBlind) !== null;
}

/** Blind-growth presets offered in the host UI (0 = Off). Custom 1–100 also allowed. */
export const BLIND_GROWTH_PRESETS = [0, 3, 5, 10] as const;

/** Max allowed blind-growth interval (hands). */
export const MAX_BLIND_GROWTH = 100;

/**
 * Validate a requested blind-growth interval. 0 = Off; otherwise a safe integer in
 * 1..100. Rejects fraction / negative / NaN / Infinity / string / object / >100.
 * Returns the accepted integer, or null when invalid.
 */
export function validateBlindGrowth(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isSafeInteger(v)) return null;
  if (v === 0) return 0;
  if (v < 1 || v > MAX_BLIND_GROWTH) return null;
  return v;
}
