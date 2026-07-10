// Preferans pure core (Stage 19.1) — barrel. No catalog/registry/UI/server wiring
// yet (that lands in Stage 19.2+). See PREFERANS_RULES.md / PREFERANS_PLAN.md.

export * from './types';
export * from './deck';
export * from './rules';
export { preferansReducer, gameValue } from './engine';
export { preferansBotAction } from './ai';
export { preferansRedactStateFor } from './redact';
export { checkPreferansInvariants } from './invariants';
