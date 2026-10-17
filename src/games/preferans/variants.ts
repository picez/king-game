// ---------------------------------------------------------------------------
// Preferans host-optional variants (Stage 41.4, PREFERANS_RULES §5a/§7a): misère
// and распасы. Both OFF by default, so a room or save that never mentions them
// plays exactly the original MVP rules. Pure — shared by the UI, the room layer
// and the server.
// ---------------------------------------------------------------------------

export interface PreferansRuleOptions {
  misere: boolean;
  allPass: boolean;
}

export const DEFAULT_PREFERANS_RULES: PreferansRuleOptions = { misere: false, allPass: false };

/** Coerce anything (a room message, a stored snapshot) into strict booleans. */
export function normalizePreferansRules(raw: unknown): PreferansRuleOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { misere: r.misere === true, allPass: r.allPass === true };
}
