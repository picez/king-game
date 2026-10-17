// ---------------------------------------------------------------------------
// Tarneeb host-optional variants (Stage 41.5, TARNEEB_RULES §6a/§9): the Kaboot table
// and No-Trump. Both OFF by default, so a room or save that never mentions them plays
// exactly the original rules. Pure — shared by the UI, the room layer and the server.
// ---------------------------------------------------------------------------

export interface TarneebRuleOptions {
  kaboot: boolean;
  noTrump: boolean;
}

export const DEFAULT_TARNEEB_RULES: TarneebRuleOptions = { kaboot: false, noTrump: false };

/** Coerce anything (a room message, a stored snapshot) into strict booleans. */
export function normalizeTarneebRules(raw: unknown): TarneebRuleOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { kaboot: r.kaboot === true, noTrump: r.noTrump === true };
}

/** The engine options these rules switch on. */
export function tarneebRuleEngineOptions(rules: TarneebRuleOptions): { kabootMode: 'off' | 'recommended'; allowNoTrump: boolean } {
  return { kabootMode: rules.kaboot ? 'recommended' : 'off', allowNoTrump: rules.noTrump };
}
