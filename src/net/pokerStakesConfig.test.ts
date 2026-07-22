import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCreateIntent, firstConnectMessage } from './online';
import { createRoom, snapshot, roomSummary, serializeRoom, deserializeRoom } from './serverCore';
import { buildPokerStartAction } from '../games/poker/definition';
import { STAKES_PRESETS } from '../games/poker/stakes';

// The typed poker stakes config must survive the FULL path — host picker →
// buildCreateIntent → CREATE_ROOM message → room → snapshot/summary →
// serialize/deserialize → START_GAME options — and the buy-in is always 100 BB.

describe('buildCreateIntent / firstConnectMessage carry poker stakes', () => {
  it('poker create-intent carries blinds + growth (buy-in derived server-side, not here)', () => {
    const intent = buildCreateIntent({
      gameType: 'poker', name: 'Host', modeSelectionType: 'fixed',
      pokerSmallBlind: 100, pokerBigBlind: 200, pokerBlindGrowth: 5,
    });
    expect(intent.pokerSmallBlind).toBe(100);
    expect(intent.pokerBigBlind).toBe(200);
    expect(intent.pokerBlindGrowth).toBe(5);
    const msg = firstConnectMessage(intent);
    expect(msg).toMatchObject({ t: 'CREATE_ROOM', gameType: 'poker', pokerSmallBlind: 100, pokerBigBlind: 200, pokerBlindGrowth: 5 });
  });
  it('forwards growth 0 (Off) explicitly (a meaningful value, not dropped)', () => {
    const intent = buildCreateIntent({ gameType: 'poker', name: 'H', modeSelectionType: 'fixed', pokerSmallBlind: 25, pokerBigBlind: 50, pokerBlindGrowth: 0 });
    const msg = firstConnectMessage(intent) as Record<string, unknown>;
    expect(msg.pokerBlindGrowth).toBe(0);
  });
  it('non-poker games carry no poker fields', () => {
    const msg = firstConnectMessage(buildCreateIntent({ gameType: 'king', name: 'H', modeSelectionType: 'fixed' })) as Record<string, unknown>;
    expect(msg.pokerSmallBlind).toBeUndefined();
    expect(msg.pokerBigBlind).toBeUndefined();
  });
});

describe('room snapshot / summary expose PUBLIC stakes only', () => {
  const mk = () => createRoom({
    code: 'PKR1', playerCount: 6, modeSelectionType: 'fixed', gameType: 'poker',
    host: { clientId: 'h', reconnectToken: 'tok', name: 'Host' },
    pokerSmallBlind: 100, pokerBigBlind: 200, pokerBuyIn: 20000, pokerBlindGrowth: 5,
  });

  it('snapshot carries blinds/buy-in/growth', () => {
    const s = snapshot(mk());
    expect(s.pokerSmallBlind).toBe(100);
    expect(s.pokerBigBlind).toBe(200);
    expect(s.pokerBuyIn).toBe(20000);
    expect(s.pokerBlindGrowth).toBe(5);
  });
  it('room summary carries the same PUBLIC stakes and nothing private', () => {
    const room = mk();
    room.pokerEscrow = { matchId: 'secret-match', buyIn: 20000, status: 'funded', seats: [{ seat: 0, userId: 'secret-user', amount: 20000 }] };
    const sum = roomSummary(room);
    expect(sum.pokerBuyIn).toBe(20000);
    // No escrow internals / userId / match id leak into the public summary.
    expect(JSON.stringify(sum)).not.toContain('secret-match');
    expect(JSON.stringify(sum)).not.toContain('secret-user');
  });
});

describe('serialize / deserialize round-trips stakes + escrow', () => {
  it('restores blinds/buy-in/growth and a funded escrow verbatim', () => {
    const room = createRoom({
      code: 'PKR2', playerCount: 4, modeSelectionType: 'fixed', gameType: 'poker',
      host: { clientId: 'h', reconnectToken: 'tok', name: 'Host' },
      pokerSmallBlind: 400, pokerBigBlind: 800, pokerBuyIn: 80000, pokerBlindGrowth: 3,
    });
    room.pokerEscrow = { matchId: 'm-1', buyIn: 80000, status: 'funded', seats: [{ seat: 0, userId: 'u1', amount: 80000 }, { seat: 1, userId: 'u2', amount: 80000 }] };
    const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))));
    expect(restored).not.toBeNull();
    expect(restored!.pokerSmallBlind).toBe(400);
    expect(restored!.pokerBigBlind).toBe(800);
    expect(restored!.pokerBuyIn).toBe(80000);
    expect(restored!.pokerBlindGrowth).toBe(3);
    expect(restored!.pokerEscrow).toEqual(room.pokerEscrow);
  });
  it('growth 0 (Off) round-trips as 0, not dropped', () => {
    const room = createRoom({
      code: 'PKR3', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker',
      host: { clientId: 'h', reconnectToken: 'tok', name: 'Host' },
      pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000, pokerBlindGrowth: 0,
    });
    const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))))!;
    expect(restored.pokerBlindGrowth).toBe(0);
  });
});

describe('buildPokerStartAction threads bankroll options (startingStack = buy-in)', () => {
  it('every approved preset yields options with the 100 BB buy-in as the stack', () => {
    for (const p of STAKES_PRESETS) {
      const room = createRoom({
        code: 'PKR', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker',
        host: { clientId: 'h', reconnectToken: 'tok', name: 'Host' },
        pokerSmallBlind: p.smallBlind, pokerBigBlind: p.bigBlind, pokerBuyIn: p.buyIn, pokerBlindGrowth: 3,
      });
      const action = buildPokerStartAction(snapshot(room)) as { options?: Record<string, unknown> };
      expect(action.options).toMatchObject({
        startingStack: p.buyIn, smallBlind: p.smallBlind, bigBlind: p.bigBlind,
        blindGrowthEveryHands: 3, mode: 'online_bankroll',
      });
      expect(p.buyIn).toBe(p.bigBlind * 100);
    }
  });
  it('a room with no stakes sends NO options (free MVP table)', () => {
    const room = createRoom({
      code: 'PKR', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker',
      host: { clientId: 'h', reconnectToken: 'tok', name: 'Host' },
    });
    const action = buildPokerStartAction(snapshot(room)) as { options?: unknown };
    expect(action.options).toBeUndefined();
  });
});

describe('StartMenu wires real account props into the Poker stakes picker (FAIL 5)', () => {
  const src = readFileSync(join(process.cwd(), 'src/ui/StartMenu.tsx'), 'utf8');
  it('passes account.signedIn + account.base (never a hardcoded signedIn=true)', () => {
    expect(src).toMatch(/<PokerStakesPicker\s+base=\{account\.base\}\s+signedIn=\{account\.signedIn\}/);
    expect(src).not.toMatch(/<PokerStakesPicker[^>]*base=""/);
  });
  it('blocks hosting online Poker unless the wallet can afford the buy-in', () => {
    // host() early-returns for poker when the picker has not reported an affordable selection.
    expect(src).toMatch(/gameType === 'poker' && !\(pokerStakes && pokerStakes\.affordable\)/);
  });
});
