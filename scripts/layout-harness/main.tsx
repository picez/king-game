// ---------------------------------------------------------------------------
// Poker LAYOUT-QA harness (Stage 38.0.3). Dev-only: it is never bundled — the app
// build has a single `index.html` entry, and this lives under `scripts/`.
//
// Stage 38.0.2 checked the poker table with an SSR-only table harness and therefore
// MISSED the real defect the owner hit in production: the fixed social/utility
// cluster floats ON TOP of the action controls. This harness mounts the REAL
// components composed exactly as `OnlineGame` composes them for an online poker room
// (PokerGameScreen + RoomSocial + timer + voice + the action-log utilitySlot), in a
// real browser, so `scripts/poker-layout-qa.mjs` can measure actual bounding boxes
// and open the real panels.
//
// Query params (all optional):
//   seats=2..6  street=preflop|flop|turn|river  dir=ltr|rtl  lang=en|uk|de|ar
//   names=long  states=1 (folded / all-in / eliminated seats)  local=1 (local screen)
// ---------------------------------------------------------------------------

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/App.css';
import { LangProvider } from '../../src/i18n';
import { useState } from 'react';
import RoomSocial, { type SocialPanel } from '../../src/ui/online/RoomSocial';
import PokerGameScreen from '../../src/ui/poker/PokerGameScreen';
import PokerActionLog, {
  PokerActionLogButton, PokerActionLogPanel, useLogUnread,
} from '../../src/ui/poker/PokerActionLog';
import { pokerReducer } from '../../src/games/poker/engine';
import { pokerRedactStateFor } from '../../src/games/poker/redact';
import type { PokerCard, PokerState, Rank, Suit } from '../../src/games/poker/types';

const qs = new URLSearchParams(location.search);
const num = (k: string, d: number) => Number(qs.get(k) ?? d);
const seats = Math.max(2, Math.min(6, num('seats', 4)));
const street = (qs.get('street') ?? 'flop') as PokerState['street'];
const dir = qs.get('dir') === 'rtl' ? 'rtl' : 'ltr';
const lang = qs.get('lang') ?? (dir === 'rtl' ? 'ar' : 'en');
const longNames = qs.get('names') === 'long';
const withStates = qs.get('states') === '1';
const localScreen = qs.get('local') === '1';

document.documentElement.dir = dir;
document.documentElement.lang = lang;
try { localStorage.setItem('king.lang.v1', lang); } catch { /* ignore */ }

const card = (suit: Suit, rank: Rank): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });
const BOARD = [
  card('spades', 'A'), card('hearts', 'K'), card('clubs', '7'),
  card('diamonds', '10'), card('spades', '2'),
];
const BOARD_LEN: Record<string, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** A realistic mid-hand state: the viewer (seat 0) is to act and can bet/raise. */
function fixture(): PokerState {
  const names = Array.from({ length: seats }, (_, i) =>
    longNames ? `Player-with-a-very-long-name ${i + 1}` : `Player ${i + 1}`);
  const s = pokerReducer(null, {
    type: 'START_GAME',
    playerNames: names,
    playerTypes: names.map((_, i) => (i === 0 ? 'human' : 'ai')),
    playerCount: seats,
    buttonSeat: seats - 1,
    options: { startingStack: 10000, smallBlind: 50, bigBlind: 100, blindGrowthEveryHands: 0 },
  })!;
  s.street = street;
  s.board = BOARD.slice(0, BOARD_LEN[street] ?? 3);
  s.toActSeat = 0;
  // Committed bets on every seat so the bet chips are part of the measurement.
  s.committedBySeat = s.committedBySeat.map(() => 350);
  s.contributedBySeat = s.contributedBySeat.map(() => 1200);
  s.stacksBySeat = s.stacksBySeat.map(() => 8450);
  s.currentBet = 350;
  s.minRaise = 100;
  s.actionLog = Array.from({ length: 40 }, (_, i) => ({
    seat: i % seats, street: 'preflop' as const, kind: i % 2 ? 'call' as const : 'raise' as const, amount: 100 + i,
  }));
  if (withStates && seats >= 4) {
    s.foldedBySeat[1] = true;                    // folded pod
    s.allInBySeat[2] = true;                     // ALL-IN badge
    s.eliminatedBySeat[seats - 1] = true;        // out pod
    s.stacksBySeat[seats - 1] = 0;
  }
  return s;
}

const state = pokerRedactStateFor(fixture(), 0);
const noop = () => {};

function Harness() {
  // Composed EXACTLY like the poker branch of OnlineGame.tsx (Stage 38.0.3): the social
  // cluster is DOCKED in flow inside the table screen, and one surface is open at a time.
  const [panel, setPanel] = useState<SocialPanel>('none');
  const logOpen = panel === 'utility';
  const unread = useLogUnread(state.actionLog.length, logOpen);

  if (localScreen) {
    return (
      <PokerGameScreen
        state={state} mySeat={0} apply={noop} onExit={noop}
        socialSlot={
          <div className="social-controls social-controls--docked">
            <div className="social-controls__row">
              <PokerActionLog state={state} variant="standalone" docked />
            </div>
          </div>
        }
      />
    );
  }
  const social = (
    <RoomSocial
      reactions={[]} chat={[{ clientId: 'x', name: 'Player 2', avatar: '🙂', text: 'nice hand', at: Date.now() } as never]}
      myClientId="me"
      onReact={noop} onChat={noop} onChatMedia={noop}
      notice={null} onClearNotice={noop}
      handVisible={false} onLeaveGame={noop}
      voiceButton={<button type="button" className="social-fab" aria-label="voice">🎙️</button>}
      mySeatIndex={0} seatCount={seats}
      timerSlot={<div className="turn-timer turn-timer--compact"><span>0:20</span></div>}
      variant="docked"
      openPanel={panel}
      onPanelChange={setPanel}
      utilitySlot={<PokerActionLogButton open={logOpen} unread={unread} onToggle={(n) => setPanel(n ? 'utility' : 'none')} />}
      utilityPanelSlot={logOpen ? <PokerActionLogPanel state={state} docked onClose={() => setPanel('none')} /> : null}
    />
  );
  return (
    <PokerGameScreen state={state} mySeat={0} apply={noop} onExit={noop} online socialSlot={social} />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Harness />
    </LangProvider>
  </StrictMode>,
);
