// ---------------------------------------------------------------------------
// Finished-game signature (extracted from server/index.ts, Stage 8.1).
//
// Pure helper: a cheap content fingerprint of a finished game (round count +
// per-seat totals). Two recordings of the SAME finished game share it; a
// different game (different scores) differs — the server uses it to avoid
// double-recording stats on reconnect/rebroadcast. No behaviour change.
// ---------------------------------------------------------------------------

import type { ServerRoom } from '../src/net/serverCore';

export function finishSignature(room: ServerRoom): string {
  const s = room.gameState;
  if (!s) return '';
  const totals = s.players.map((p) => `${p.id}=${s.scores[p.id]?.total ?? 0}`).join(',');
  return `${(s.roundHistory ?? []).length}|${totals}`;
}
