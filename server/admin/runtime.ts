// ---------------------------------------------------------------------------
// Admin runtime seam (Stage 44.0). server/index.ts owns the in-memory rooms and
// sockets; it registers these callbacks once at boot so the admin routes can read
// live rooms and act on them without importing the monolith (no import cycle).
// ---------------------------------------------------------------------------

import type { AdminLiveRoom } from '../../src/net/admin';

export interface AdminRuntime {
  liveRooms(): AdminLiveRoom[];
  /** Closes a room: members are told why and sent back to the menu. False = no such room. */
  closeRoom(code: string, reason: string): boolean;
  connections(): number;
  onlineUserIds(): string[];
  /** Closes every live socket of the user (after a ban). Returns how many. */
  kickUser(userId: string): number;
}

const empty: AdminRuntime = {
  liveRooms: () => [], closeRoom: () => false, connections: () => 0, onlineUserIds: () => [], kickUser: () => 0,
};

let current: AdminRuntime = empty;

export function setAdminRuntime(rt: AdminRuntime): void { current = rt; }
export function adminRuntime(): AdminRuntime { return current; }

// Event-loop lag sampler (cheap: one timer every 2 s; the worst of the last minute).
let lagMax = 0;
let lagSamples: number[] = [];
let lagTimer: ReturnType<typeof setInterval> | null = null;
export function startLagSampler(): void {
  if (lagTimer) return;
  let expected = Date.now() + 2000;
  lagTimer = setInterval(() => {
    const now = Date.now();
    lagSamples.push(Math.max(0, now - expected));
    if (lagSamples.length > 30) lagSamples = lagSamples.slice(-30);
    lagMax = Math.max(...lagSamples);
    expected = now + 2000;
  }, 2000);
  lagTimer.unref?.();
}
export function eventLoopLagMs(): number { return lagMax; }
