// ---------------------------------------------------------------------------
// REAL online-branch social harness (Stage 38.0.13). Dev-only: never bundled.
//
// WHY IT EXISTS. `scripts/layout-harness/social.tsx` mounts RoomSocial on its own, so it
// could only ever prove that the three LAYOUT VARIANTS agree with each other. The owner's
// production FAIL was between GAMES: Durak opened a tall right-hand drawer while 51
// opened a compact modal card, at the same viewport, from the same component. This
// harness mounts the PRODUCTION composition of three games — the ones that use all three
// launcher layouts — so `scripts/social-layout-qa.mjs` can measure the OPEN CHAT in each
// and assert one identical dialog:
//
//   durak     → DurakGameScreen      + RoomSocial (floating cluster, hand visible)
//   fiftyone  → FiftyOneGameScreen   + RoomSocial (sheet launcher in the top bar)
//   poker     → PokerGameScreen      + RoomSocial (docked toolbar + utility log)
//
// Query params:
//   game=durak|fiftyone|poker   dir=ltr|rtl   lang=en|uk|de|ar
//   panel=none|chat|utility     chat=<n> seeded messages   seats=2..6
// ---------------------------------------------------------------------------

import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/App.css';
import { LangProvider } from '../../src/i18n';
import RoomSocial, { type SocialPanel } from '../../src/ui/online/RoomSocial';
import PermanentLeaveControl from '../../src/ui/online/PermanentLeaveControl';
import DurakGameScreen from '../../src/ui/durak/DurakGameScreen';
import FiftyOneGameScreen from '../../src/ui/fiftyOne/FiftyOneGameScreen';
import PokerGameScreen from '../../src/ui/poker/PokerGameScreen';
import {
  PokerActionLogButton, PokerActionLogPanel, useLogUnread,
} from '../../src/ui/poker/PokerActionLog';
import { durakReducer } from '../../src/games/durak/engine';
import { pokerReducer } from '../../src/games/poker/engine';
import { pokerRedactStateFor } from '../../src/games/poker/redact';
import type { DurakState } from '../../src/games/durak/types';
import type { PokerCard, PokerState, Rank as PokerRank, Suit as PokerSuit } from '../../src/games/poker/types';
import type { FiftyOneCard, FiftyOneMeld, FiftyOnePlayer, FiftyOneState } from '../../src/games/fiftyOne/types';
import type { Rank, Suit } from '../../src/models/types';
import type { ChatMessage } from '../../src/net/messages';

const qs = new URLSearchParams(location.search);
const game = (qs.get('game') ?? 'durak') as 'durak' | 'fiftyone' | 'poker';
const dir = qs.get('dir') === 'rtl' ? 'rtl' : 'ltr';
const lang = qs.get('lang') ?? (dir === 'rtl' ? 'ar' : 'en');
const startPanel = (qs.get('panel') ?? 'none') as SocialPanel;
const chatCount = Number(qs.get('chat') ?? 8);
const seats = Math.max(2, Math.min(6, Number(qs.get('seats') ?? 4)));

document.documentElement.dir = dir;
document.documentElement.lang = lang;
try { localStorage.setItem('king.lang.v1', lang); } catch { /* ignore */ }

/** Two players deliberately share a display name: the anchor must use the SEAT. */
const NAMES = ['You', 'A-really-long-display-name', 'Kai', 'Kai'];
const noop = () => {};

/** Seeded chat history — long enough to fill the dialog's scrolling list. */
function history(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    clientId: i % 3 === 0 ? 'me' : `peer-${i % 3}`,
    name: NAMES[i % NAMES.length],
    avatar: '🙂',
    text: i % 4 === 0
      ? 'A deliberately long chat line so the bubble has to wrap inside the dialog.'
      : `message ${i}`,
    createdAt: 1_700_000_000_000 + i * 1000,
    seatIndex: i % seats,
  } as ChatMessage));
}

// --- Durak fixture: a real mid-bout state straight out of the engine -------------------
function durakFixture(): DurakState {
  const names = NAMES.slice(0, Math.min(4, seats));
  const s = durakReducer(null, {
    type: 'START_DURAK',
    playerNames: names,
    playerTypes: names.map((_, i) => (i === 0 ? 'human' : 'ai')),
    variant: 'simple',
  })!;
  // Put a card on the table so the felt, the hand and the deck are all measured.
  const attacker = s.players[s.throwerIndex];
  return durakReducer(s, { type: 'ATTACK_CARD', card: attacker.hand[0] })!;
}

// --- Fifty-One fixture ----------------------------------------------------------------
let n = 0;
const c = (rank: Rank, suit: Suit): FiftyOneCard => ({ id: `c${n++}-${suit}-${rank}`, joker: false, suit, rank });
const joker = (): FiftyOneCard => ({ id: `j${n++}`, joker: true, suit: null, rank: null });

function fiftyOneFixture(): FiftyOneState {
  const players = Math.max(2, Math.min(4, seats));
  const people: FiftyOnePlayer[] = Array.from({ length: players }, (_, i) => ({
    id: `player-${i}`, name: NAMES[i], seatIndex: i, type: i === 0 ? 'human' : 'ai',
  }));
  const melds: FiftyOneMeld[] = [
    { id: 'm1', ownerSeat: 1, type: 'set', cards: [c('Q', 'hearts'), c('Q', 'clubs'), c('Q', 'diamonds')], jokerRepresents: {}, value: 36 },
    { id: 'm2', ownerSeat: 1, type: 'run', cards: [c('6', 'spades'), c('7', 'spades'), c('8', 'spades'), c('9', 'spades')], jokerRepresents: {}, value: 30 },
  ];
  const hand: FiftyOneCard[] = [
    c('4', 'spades'), c('7', 'spades'), c('4', 'clubs'), c('4', 'diamonds'),
    c('J', 'diamonds'), c('K', 'hearts'), c('2', 'clubs'), joker(),
  ];
  return {
    gameType: 'fifty-one', phase: 'playing', playerCount: players, players: people,
    dealerSeat: 0, starterSeat: 0, currentSeat: 0, turnStep: 'draw',
    handsBySeat: Array.from({ length: players }, (_, i) => (i === 0 ? hand : [])),
    drawPile: [c('3', 'clubs')], discardPile: [c('9', 'clubs')],
    openedBySeat: Array.from({ length: players }, () => true),
    publicMelds: melds,
    scoresBySeat: Array.from({ length: players }, () => 30),
    eliminatedSeats: Array.from({ length: players }, () => false),
    roundNumber: 3, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
    options: { targetPenalty: 510 },
  } as unknown as FiftyOneState;
}

// --- Poker fixture --------------------------------------------------------------------
const pcard = (suit: PokerSuit, rank: PokerRank): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });

function pokerFixture(): PokerState {
  const names = Array.from({ length: seats }, (_, i) => NAMES[i % NAMES.length]);
  const s = pokerReducer(null, {
    type: 'START_GAME',
    playerNames: names,
    playerTypes: names.map((_, i) => (i === 0 ? 'human' : 'ai')),
    playerCount: seats,
    buttonSeat: seats - 1,
    options: { startingStack: 10000, smallBlind: 50, bigBlind: 100, blindGrowthEveryHands: 0 },
  })!;
  s.street = 'flop';
  s.board = [pcard('spades', 'A'), pcard('hearts', 'K'), pcard('clubs', '7')];
  s.toActSeat = 0;
  s.committedBySeat = s.committedBySeat.map(() => 350);
  s.contributedBySeat = s.contributedBySeat.map(() => 1200);
  s.stacksBySeat = s.stacksBySeat.map(() => 8450);
  s.currentBet = 350;
  s.minRaise = 100;
  s.actionLog = Array.from({ length: 24 }, (_, i) => ({
    seat: i % seats, street: 'preflop' as const, kind: i % 2 ? 'call' as const : 'raise' as const, amount: 100 + i,
  }));
  return pokerRedactStateFor(s, 0);
}

const durakState = game === 'durak' ? durakFixture() : null;
const fiftyOneState = game === 'fiftyone' ? fiftyOneFixture() : null;
const pokerState = game === 'poker' ? pokerFixture() : null;

function Harness() {
  const [panel, setPanel] = useState<SocialPanel>(startPanel);
  const chat = history(chatCount);
  const timerSlot = <div className="turn-timer turn-timer--compact"><span>0:30</span></div>;
  const voiceButton = <button type="button" className="social-fab" aria-label="voice">🎙️</button>;

  /** Everything the three branches pass identically (they differ only in LAYOUT). */
  const common = {
    reactions: [], chat, myClientId: 'me',
    onReact: record('react'), onChat: record('chat'), onChatMedia: record('media'),
    notice: null, onClearNotice: noop,
    mySeatIndex: 0, seatCount: seats,
    openPanel: panel, onPanelChange: setPanel,
  } as const;

  if (game === 'fiftyone') {
    // OnlineGame's `fifty-one` branch: the sheet launcher lives in the game's TOP BAR.
    const menu: ReactNode = (
      <RoomSocial
        {...common}
        handVisible={false}
        voiceButton={voiceButton}
        dangerSlot={<PermanentLeaveControl state={{ status: 'idle' }} onConfirm={noop} />}
        variant="sheet"
      />
    );
    return (
      <FiftyOneGameScreen
        state={fiftyOneState!} humanSeat={0} apply={noop} onExit={noop} online
        menuSlot={menu} timerSlot={timerSlot}
      />
    );
  }

  if (game === 'poker') {
    // OnlineGame's `poker` branch: the cluster is DOCKED in flow inside the table screen.
    const logOpen = panel === 'utility';
    return <PokerHarness state={pokerState!} panel={panel} setPanel={setPanel} common={common}
      logOpen={logOpen} voiceButton={voiceButton} timerSlot={timerSlot} />;
  }

  // OnlineGame's `durak` branch: the game screen plus the FLOATING corner cluster.
  return (
    <>
      <DurakGameScreen state={durakState!} humanId="player-0" apply={noop} onExit={noop} />
      <RoomSocial
        {...common}
        handVisible
        onLeaveGame={noop}
        voiceButton={voiceButton}
        timerSlot={timerSlot}
        dangerSlot={<PermanentLeaveControl state={{ status: 'idle' }} onConfirm={noop} />}
      />
    </>
  );
}

function PokerHarness({ state, panel, setPanel, common, logOpen, voiceButton, timerSlot }: {
  state: PokerState; panel: SocialPanel; setPanel: (p: SocialPanel) => void;
  common: Record<string, unknown>; logOpen: boolean; voiceButton: ReactNode; timerSlot: ReactNode;
}) {
  const unread = useLogUnread(state.actionLog.length, logOpen);
  const social = (
    <RoomSocial
      {...(common as never)}
      handVisible={false}
      onLeaveGame={noop}
      voiceButton={voiceButton}
      timerSlot={timerSlot}
      variant="docked"
      utilitySlot={<PokerActionLogButton open={logOpen} unread={unread} onToggle={(next) => setPanel(next ? 'utility' : 'none')} />}
      utilityPanelSlot={logOpen ? <PokerActionLogPanel state={state} docked onClose={() => setPanel('none')} /> : null}
    />
  );
  void panel;
  return <PokerGameScreen state={state} mySeat={0} apply={noop} onExit={noop} online socialSlot={social} />;
}

/** Every send the harness observes, so the gate can assert "exactly once". */
declare global {
  interface Window {
    __socialCalls?: { kind: string; value: string }[];
    __socialGame?: string;
    __socialReady?: boolean;
  }
}
window.__socialCalls = [];
window.__socialGame = game;
const record = (kind: string) => (value: string) => { window.__socialCalls!.push({ kind, value }); };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Harness />
    </LangProvider>
  </StrictMode>,
);

requestAnimationFrame(() => requestAnimationFrame(() => { window.__socialReady = true; }));
