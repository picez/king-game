// ---------------------------------------------------------------------------
// REAL online-branch social harness (Stage 38.0.13, extended to all SEVEN games in
// Stage 38.0.14). Dev-only: never bundled.
//
// WHY IT EXISTS. `scripts/layout-harness/social.tsx` mounts RoomSocial on its own, so it
// can only prove the layout VARIANTS agree with each other. The owner's FAILs have all
// been about what the chat does to a REAL game: 38.0.13 was three different shells across
// games; 38.0.14 is a centred modal that dims the table, swallows taps and locks the page
// scroll, so the player cannot act while it is open. Both need the production
// composition, which is what this harness mounts:
//
//   king      → GameRouter (GameContext)   + RoomSocial
//   durak     → DurakGameScreen            + RoomSocial
//   deberc    → DebercGameScreen           + RoomSocial
//   tarneeb   → TarneebGameScreen          + RoomSocial
//   preferans → PreferansGameScreen        + RoomSocial
//   fiftyone  → FiftyOneGameScreen         + RoomSocial
//   poker     → PokerGameScreen            + RoomSocial
//
// Every game's `apply`/`dispatch` is RECORDED (`window.__gameActions`), so the gate can
// click a legal card or action button while the chat is open and prove the action still
// reaches the game exactly once. `window.__pushState()` fakes a STATE_UPDATE (a new state
// object + a ticking timer) so the gate can prove a re-render does not close the chat.
//
// Query params:
//   game=<one of the seven>   dir=ltr|rtl   lang=en|uk|de|ar
//   panel=none|chat|utility   chat=<n> seeded messages   seats=2..6
// ---------------------------------------------------------------------------

import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/App.css';
import { LangProvider } from '../../src/i18n';
import { GameContext } from '../../src/hooks/useGame';
import RoomSocial, { SOCIAL_REGION_ID, type SocialPanel } from '../../src/ui/online/RoomSocial';
import { roomLayoutClass } from '../../src/ui/online/roomLayout';
import PermanentLeaveControl from '../../src/ui/online/PermanentLeaveControl';
import GameRouter from '../../src/ui/GameRouter';
import DurakGameScreen from '../../src/ui/durak/DurakGameScreen';
import DebercGameScreen from '../../src/ui/deberc/DebercGameScreen';
import TarneebGameScreen from '../../src/ui/tarneeb/TarneebGameScreen';
import PreferansGameScreen from '../../src/ui/preferans/PreferansGameScreen';
import FiftyOneGameScreen from '../../src/ui/fiftyOne/FiftyOneGameScreen';
import PokerGameScreen from '../../src/ui/poker/PokerGameScreen';
import {
  PokerActionLogButton, PokerActionLogPanel, useLogUnread,
} from '../../src/ui/poker/PokerActionLog';
import { gameReducer } from '../../src/core/gameEngine';
import { durakReducer } from '../../src/games/durak/engine';
import { debercReducer } from '../../src/games/deberc/engine';
import { tarneebReducer } from '../../src/games/tarneeb/engine';
import { preferansReducer } from '../../src/games/preferans/engine';
import { pokerReducer } from '../../src/games/poker/engine';
import { pokerRedactStateFor } from '../../src/games/poker/redact';
import type { GameState } from '../../src/models/types';
import type { DurakState } from '../../src/games/durak/types';
import type { DebercState } from '../../src/games/deberc/types';
import type { TarneebState } from '../../src/games/tarneeb/types';
import type { PreferansState } from '../../src/games/preferans/types';
import type { PokerCard, PokerState, Rank as PokerRank, Suit as PokerSuit } from '../../src/games/poker/types';
import type { FiftyOneCard, FiftyOneMeld, FiftyOnePlayer, FiftyOneState } from '../../src/games/fiftyOne/types';
import type { Rank, Suit } from '../../src/models/types';
import type { ChatMessage } from '../../src/net/messages';
import { CHAT_MEDIA } from '../../src/net/chatMediaCatalog';

type GameTag = 'king' | 'durak' | 'deberc' | 'tarneeb' | 'preferans' | 'fiftyone' | 'poker';

const qs = new URLSearchParams(location.search);
const game = (qs.get('game') ?? 'durak') as GameTag;
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

/** Everything the gate needs to observe from outside the app. */
declare global {
  interface Window {
    __socialCalls?: { kind: string; value: string; mediaId?: string }[];
    __gameActions?: unknown[];
    __socialGame?: string;
    __socialReady?: boolean;
    __pushState?: () => void;
    /** (38.0.16) Append a COMBINED text+sticker message, so the shots script can photograph
     *  the resulting bubble. The harness records sends instead of echoing them. */
    __appendCombined?: (text: string) => void;
  }
}
window.__socialCalls = [];
window.__gameActions = [];
window.__socialGame = game;
/** (38.0.16) `chat` may now carry an attachment, so BOTH arguments are recorded — the
 *  gate must be able to prove one combined message, not two. */
const record = (kind: string) => (value: string, mediaId?: string) => {
  window.__socialCalls!.push(mediaId ? { kind, value, mediaId } : { kind, value });
};
/** The game's OWN callback: a click that never lands here is a blocked gameplay action. */
const recordAction = (a: unknown) => { window.__gameActions!.push(a); };

/** Seeded chat history — long enough to fill the panel's scrolling list. */
function history(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    clientId: i % 3 === 0 ? 'me' : `peer-${i % 3}`,
    name: NAMES[i % NAMES.length],
    avatar: '🙂',
    text: i % 4 === 0
      ? 'A deliberately long chat line so the bubble has to wrap inside the panel.'
      : `message ${i}`,
    createdAt: 1_700_000_000_000 + i * 1000,
    seatIndex: i % seats,
  } as ChatMessage));
}

const names = (n: number) => Array.from({ length: n }, (_, i) => NAMES[i % NAMES.length]);
const types = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? 'human' : 'ai') as const);

// --- King -----------------------------------------------------------------------------
function kingFixture(): GameState {
  return gameReducer(null, {
    type: 'START_GAME', playerNames: names(4), playerTypes: types(4), modeSelectionType: 'fixed',
  })!;
}

// --- Durak: seat 0 ATTACKS an empty table, so every card in hand is legal --------------
function durakFixture(): DurakState {
  const s = durakReducer(null, {
    type: 'START_DURAK', playerNames: names(Math.min(4, seats)), playerTypes: types(Math.min(4, seats)), variant: 'simple',
  })!;
  // Deterministic: the viewer opens the bout. `getValidAttackCards` on an empty table is
  // the whole hand, so the gate can click ANY card and expect exactly one action.
  return {
    ...s, table: [], status: 'attack',
    attackerIndex: 0, throwerIndex: 0, lastThrowerIndex: 0,
    defenderIndex: 1, passedAttackers: [],
  };
}

// --- Deberc / Tarneeb / Preferans: the real opening state of each engine ---------------
function debercFixture(): DebercState {
  const s = debercReducer(null, {
    type: 'START_DEBERC', playerNames: names(Math.min(4, Math.max(3, seats))),
    playerTypes: types(Math.min(4, Math.max(3, seats))), matchSize: 501,
  })!;
  // Deberc opens with its OWN first-dealer reveal overlay. Drop it: the gate is measuring
  // the social cluster against the table, not against another game's intro modal.
  return { ...s, firstDealerDraw: undefined };
}
function tarneebFixture(): TarneebState {
  return tarneebReducer(null, {
    type: 'START_GAME', playerNames: names(4), playerTypes: types(4), dealerSeat: 3,
  })!;
}
function preferansFixture(): PreferansState {
  return preferansReducer(null, {
    type: 'START_GAME', playerNames: names(3), playerTypes: types(3), dealerSeat: 2,
  })!;
}

// --- Fifty-One ------------------------------------------------------------------------
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

// --- Poker ----------------------------------------------------------------------------
const pcard = (suit: PokerSuit, rank: PokerRank): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });

function pokerFixture(): PokerState {
  const s = pokerReducer(null, {
    type: 'START_GAME',
    playerNames: names(seats), playerTypes: types(seats), playerCount: seats,
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

function Harness() {
  // ONE state per game, replaced wholesale by `window.__pushState()` — the harness's
  // stand-in for a server STATE_UPDATE.
  const [tick, setTick] = useState(0);
  const [king, setKing] = useState<GameState>(kingFixture);
  const [durak, setDurak] = useState<DurakState>(durakFixture);
  const [deberc, setDeberc] = useState<DebercState>(debercFixture);
  const [tarneeb, setTarneeb] = useState<TarneebState>(tarneebFixture);
  const [preferans, setPreferans] = useState<PreferansState>(preferansFixture);
  const [fiftyOne, setFiftyOne] = useState<FiftyOneState>(fiftyOneFixture);
  const [poker, setPoker] = useState<PokerState>(pokerFixture);
  const [panel, setPanel] = useState<SocialPanel>(startPanel);

  window.__pushState = () => {
    setTick((v) => v + 1);
    setKing((s) => ({ ...s }));
    setDurak((s) => ({ ...s }));
    setDeberc((s) => ({ ...s }));
    setTarneeb((s) => ({ ...s }));
    setPreferans((s) => ({ ...s }));
    setFiftyOne((s) => ({ ...s }));
    setPoker((s) => ({ ...s }));
  };

  const [extra, setExtra] = useState<ChatMessage[]>([]);
  window.__appendCombined = (text: string) => setExtra((xs) => [...xs, {
    id: `combined-${xs.length}`, clientId: 'me', name: NAMES[0], avatar: '🙂',
    text, createdAt: 1_700_000_100_000 + xs.length, seatIndex: 0,
    media: { id: CHAT_MEDIA[0].id, src: CHAT_MEDIA[0].src, type: CHAT_MEDIA[0].type, label: CHAT_MEDIA[0].label },
  } as ChatMessage]);
  const chat = [...history(chatCount), ...extra];
  const seconds = Math.max(0, 30 - tick);
  const timerSlot = (
    <div className="turn-timer turn-timer--compact"><span className="probe-timer">0:{String(seconds).padStart(2, '0')}</span></div>
  );
  const voiceButton = <button type="button" className="social-fab" aria-label="voice">🎙️</button>;

  /** Everything the seven branches pass identically. */
  const common = {
    reactions: [], chat, myClientId: 'me',
    onReact: record('react'), onChat: record('chat'), onChatMedia: record('media'),
    notice: null, onClearNotice: noop,
    mySeatIndex: 0, seatCount: seats,
    openPanel: panel, onPanelChange: setPanel,
    voiceButton,
    timerSlot,
  } as const;

  if (game === 'poker') {
    return <PokerHarness state={poker} panel={panel} setPanel={setPanel} common={common} />;
  }

  const social = (
    <RoomSocial
      {...common}
      handVisible
      onLeaveGame={noop}
      dangerSlot={<PermanentLeaveControl state={{ status: 'idle' }} onConfirm={noop} />}
    />
  );

  if (game === 'fiftyone') {
    return (
      <FiftyOneGameScreen
        state={fiftyOne} humanSeat={0} apply={recordAction} onExit={noop} online
        socialSlot={social} timerSlot={timerSlot}
      />
    );
  }
  if (game === 'king') {
    return (
      <GameContext.Provider value={{
        state: king, dispatch: recordAction, online: true, onExit: noop,
        turnTimerSec: 30, myPlayerId: 'player-0', socialSlot: social,
      }}>
        <GameRouter />
      </GameContext.Provider>
    );
  }
  if (game === 'deberc') {
    return <DebercGameScreen state={deberc} humanId="player-0" apply={recordAction} onExit={noop} socialSlot={social} />;
  }
  if (game === 'tarneeb') {
    return <TarneebGameScreen state={tarneeb} humanSeat={0} apply={recordAction} onExit={noop} reviewTrick={null} online socialSlot={social} />;
  }
  if (game === 'preferans') {
    return <PreferansGameScreen state={preferans} humanSeat={0} apply={recordAction} onExit={noop} reviewTrick={null} online socialSlot={social} />;
  }
  return <DurakGameScreen state={durak} humanId="player-0" apply={recordAction} onExit={noop} socialSlot={social} />;
}

function PokerHarness({ state, panel, setPanel, common }: {
  state: PokerState; panel: SocialPanel; setPanel: (p: SocialPanel) => void;
  common: Record<string, unknown>;
}) {
  const logOpen = panel === 'utility';
  const unread = useLogUnread(state.actionLog.length, logOpen);
  const social = (
    <RoomSocial
      {...(common as never)}
      onLeaveGame={noop}
      utilitySlot={<PokerActionLogButton open={logOpen} unread={unread} onToggle={(next) => setPanel(next ? 'utility' : 'none')} />}
      utilityPanelSlot={logOpen ? <PokerActionLogPanel state={state} docked onClose={() => setPanel('none')} /> : null}
    />
  );
  return <PokerGameScreen state={state} mySeat={0} apply={recordAction} onExit={noop} online socialSlot={social} />;
}

/**
 * (38.0.16) The harness mounts the PRODUCTION room layout — a stable `.game-stage` and a
 * sibling `.social-region` — because that split is exactly what the gate measures. Mounting
 * the screen bare would prove nothing about where a panel takes its space from.
 */
function Room() {
  // `region=off` renders the stage with NO social region at all — the BASELINE the gate
  // measures every chat state against (38.0.16.1). Without it a gate can only prove
  // closed === open === picker, which 38.0.16's permanently reserved rail satisfied while
  // quietly shrinking all three.
  const noRegion = qs.get('region') === 'off';
  // (38.0.16.3) The harness takes the SAME capability class the product does, from the same
  // registry — otherwise the gate would measure a layout no player can get. The harness
  // spells Fifty-One without the hyphen, so map it back to the catalogue id.
  const layoutClass = roomLayoutClass(game === 'fiftyone' ? 'fifty-one' : (game as never));
  return (
    <div className={layoutClass}>
      <div className="game-stage"><Harness /></div>
      {noRegion ? null : <div className="social-region" id={SOCIAL_REGION_ID} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Room />
    </LangProvider>
  </StrictMode>,
);

requestAnimationFrame(() => requestAnimationFrame(() => { window.__socialReady = true; }));
