// Stage 36.1 — same-user cross-device "Resume your active room" UI wiring guards.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../i18n/dictionaries/en';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('useMyRooms hook (discovery — no leakage, no room-list clash)', () => {
  const src = read('src/hooks/useMyRooms.ts');
  it('asks FIND_MY_ROOMS and applies MY_ROOMS on a throwaway socket', () => {
    expect(src).toContain('findMyRoomsMessage()');
    expect(src).toContain("msg.t === 'MY_ROOMS'");
    expect(src).toContain('WebSocketTransport');
    // It is a discovery-only query — it must NOT list public rooms or hold a session.
    expect(src).not.toContain('LIST_ROOMS');
    expect(src).not.toContain('firstConnectMessage');
  });
});

describe('StartMenu — Resume your active room block', () => {
  const src = read('src/ui/StartMenu.tsx');

  it('shows the block ONLY for a signed-in user with at least one own room', () => {
    expect(src).toContain('const myRooms = useMyRooms()');
    // gated on account.signedIn AND a non-empty (deduped) list
    expect(src).toMatch(/account\.signedIn && myRooms\.rooms\.some\(/);
    expect(src).toContain("t('menu.myRooms.title')");
  });

  it('reclaims by userId (RECLAIM_ROOM) — never a normal JOIN — on tap', () => {
    // The card click calls reclaimRoom, which sends a `reclaim` intent (→ RECLAIM_ROOM),
    // NOT { kind: 'join' }.
    expect(src).toContain('onClick={() => reclaimRoom(r.code)}');
    expect(src).toMatch(/function reclaimRoom[\s\S]*kind: 'reclaim', code/);
  });

  it('does NOT duplicate this device\'s local resume card (dedup by room code)', () => {
    expect(src).toMatch(/r\.code !== resumable\?\.roomCode/);
  });

  it('refreshes discovery on entering the menu while signed in (not aggressively polled)', () => {
    expect(src).toMatch(/pane === 'menu' && account\.signedIn && url\.trim\(\)\) myRooms\.refresh\(url\)/);
    // No setInterval added for myRooms (the existing room-browser poll is unrelated).
    expect(src).not.toMatch(/setInterval\([^)]*myRooms/);
  });

  it('the existing local reconnect (resume) card still works untouched', () => {
    expect(src).toContain('function resume()');
    expect(src).toContain("kind: 'resume'");
    expect(src).toContain('onClick={resume}');
  });

  it('every new label key exists in the dictionary', () => {
    for (const k of ['menu.myRooms.title', 'menu.myRooms.lobby', 'menu.myRooms.inGame', 'menu.myRooms.players']) {
      expect(EN[k as keyof typeof EN], `missing ${k}`).toBeTruthy();
    }
    expect(EN['menu.myRooms.players']).toContain('{n}');
  });
});
