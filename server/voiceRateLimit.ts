// ---------------------------------------------------------------------------
// Voice signaling rate limit (Stage 25.3) — per-client, in-memory.
//
// ICE trickles fast, so signaling gets its own generous bucket separate from the
// per-connection message limiter: at most N OFFER/ANSWER/ICE relays per client per window.
// Keyed by the SERVER-known clientId (never a client value). Pure logic + injectable clock.
// Mirrors server/avatarRateLimit.ts.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_PER_WINDOW = 120;  // 120 signaling messages / minute / client
const MAX_TRACKED = 10_000;

const hits = new Map<string, number[]>();

function prune(now: number): void {
  const cutoff = now - WINDOW_MS;
  for (const [k, times] of hits) if (times.length === 0 || times[times.length - 1] <= cutoff) hits.delete(k);
}

/** Records a signaling attempt for `clientId`; returns whether it is allowed. */
export function allowVoiceSignal(clientId: string, now: number = Date.now()): boolean {
  if (hits.size > MAX_TRACKED) prune(now);
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(clientId) ?? []).filter((t) => t > cutoff);
  if (recent.length >= MAX_PER_WINDOW) { hits.set(clientId, recent); return false; }
  recent.push(now);
  hits.set(clientId, recent);
  return true;
}

/** Test/maintenance hook. */
export function resetVoiceRateLimit(): void { hits.clear(); }

export const VOICE_RATE_LIMIT = { WINDOW_MS, MAX_PER_WINDOW } as const;
