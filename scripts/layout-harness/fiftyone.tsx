// ---------------------------------------------------------------------------
// Fifty-One LAYOUT-QA harness (Stage 38.0.4, rebuilt for Stage 38.0.5.1).
//
// The 38.0.4 harness mounted a partial table: no `dangerSlot`, no chat history, no open
// panels, no confirmation dialog, no card-face theme, no font scaling, and it never
// applied a second state update. It could therefore be GREEN while the owner's real
// phone was not, which is exactly what happened. This version mounts the PRODUCTION
// online Fifty-One branch: the real `FiftyOneGameScreen` with a real `RoomSocial`
// (`variant="sheet"`) carrying timer + voice + emoji + chat + unread badge + the real
// `PermanentLeaveControl`, and it replays sequential state updates before signalling
// readiness through `window.__f51ready`.
//
// Query params:
//   players=2..4        seats at the table
//   dir=ltr|rtl         document direction   lang=en|uk|de|ar
//   faces=classic|clean card-face theme (the real `data-card-faces` switch)
//   melds=default|long|jokers|sameowner|redacted   the public-meld fixture
//   social=none|sheet   mount the production online social launcher
//   panel=none|chat|reactions   which surface the sheet opens with (controlled)
//   chat=<n>            seed n chat messages (drives the unread badge)
//   unread=1            leave them unseen so the badge renders
//   updates=1           apply two sequential state updates (incl. add-to-meld)
//   fontScale=<px>      root font size (browser text scaling / zoom sanity)
//   legacy=1            re-apply the pre-38.0.5.1 CSS to reproduce the RED
// ---------------------------------------------------------------------------

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/App.css';
import { LangProvider } from '../../src/i18n';
import RoomSocial, { type SocialPanel } from '../../src/ui/online/RoomSocial';
import PermanentLeaveControl from '../../src/ui/online/PermanentLeaveControl';
import FiftyOneGameScreen from '../../src/ui/fiftyOne/FiftyOneGameScreen';
import type {
  FiftyOneCard, FiftyOneMeld, FiftyOnePlayer, FiftyOneState,
} from '../../src/games/fiftyOne/types';
import type { ChatMessage } from '../../src/net/messages';
import type { Rank, Suit } from '../../src/models/types';

const qs = new URLSearchParams(location.search);
const players = Math.max(2, Math.min(4, Number(qs.get('players') ?? 4)));
const dir = qs.get('dir') === 'rtl' ? 'rtl' : 'ltr';
const lang = qs.get('lang') ?? (dir === 'rtl' ? 'ar' : 'en');
const faces = qs.get('faces') === 'clean' ? 'clean' : 'classic';
const meldSet = qs.get('melds') ?? 'default';
const socialMode = qs.get('social') ?? 'none';        // 'none' | 'sheet'
const withSocial = socialMode !== 'none';
const startPanel = (qs.get('panel') ?? 'none') as SocialPanel;
const chatCount = Number(qs.get('chat') ?? 0);
const withUpdates = qs.get('updates') === '1';
const fontScale = qs.get('fontScale');
const legacy = qs.get('legacy') === '1';

document.documentElement.dir = dir;
document.documentElement.lang = lang;
document.documentElement.dataset.cardFaces = faces;
if (fontScale) document.documentElement.style.fontSize = `${fontScale}px`;
try { localStorage.setItem('king.lang.v1', lang); } catch { /* ignore */ }

// `legacy=1` restores the EXACT pre-38.0.5.1 geometry (the 38.0.4 docked toolbar + the
// wider fixed card slot), so the RED run measures the real old layout rather than a
// description of it.
if (legacy) {
  const style = document.createElement('style');
  style.textContent = `
    .fiftyone-melds { --f51-meld-card-w: 72px !important; --f51-meld-card-h: 112px !important; }
    .fiftyone-meld__cards { flex-wrap: nowrap !important; overflow-x: auto !important; }
    .fiftyone-meld { max-width: min(100%, 18rem) !important; }
    .fiftyone-meld__cards > * { flex: 0 0 72px !important; width: 72px !important; height: 112px !important; }
    .fiftyone-meld__cards .card { width: 72px !important; height: 112px !important; }
    .social-menu { position: fixed !important; inset-inline-end: 10px; bottom: 30vh; z-index: 40; }
    .fiftyone-meld__ctrls button { min-width: 28px !important; min-height: 28px !important; }
  `;
  document.head.appendChild(style);
}

let n = 0;
const c = (rank: Rank, suit: Suit): FiftyOneCard => ({ id: `c${n++}-${suit}-${rank}`, joker: false, suit, rank });
const joker = (): FiftyOneCard => ({ id: `j${n++}`, joker: true, suit: null, rank: null });

const RUN_RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** The public-meld fixtures. Card ORDER is never sorted here — it is the rule (§5/§8). */
function melds(): FiftyOneMeld[] {
  const seat = (i: number) => Math.min(i, players - 1);
  const set3: FiftyOneCard[] = [c('Q', 'hearts'), c('Q', 'clubs'), c('Q', 'diamonds')];
  const set4: FiftyOneCard[] = [c('K', 'spades'), c('K', 'hearts'), c('K', 'clubs'), c('K', 'diamonds')];
  const run4: FiftyOneCard[] = [c('6', 'spades'), c('7', 'spades'), c('8', 'spades'), c('9', 'spades')];
  const run7: FiftyOneCard[] = [
    c('4', 'hearts'), c('5', 'hearts'), c('6', 'hearts'), joker(),
    c('8', 'hearts'), c('9', 'hearts'), c('10', 'hearts'),
  ];
  // The LONGEST legal run: 2..A in one suit (K-A-2 is invalid, so 13 is the maximum).
  const run13: FiftyOneCard[] = RUN_RANKS.map((r) => c(r, 'clubs'));
  // Duplicate PHYSICAL cards from the second deck (same rank+suit as run4's 6♠/7♠).
  const dup: FiftyOneCard[] = [c('6', 'spades'), c('7', 'spades'), c('6', 'clubs'), c('6', 'diamonds')];

  const base: FiftyOneMeld[] = [
    { id: 'm1', ownerSeat: seat(1), type: 'set', cards: set3, jokerRepresents: {}, value: 36 },
    { id: 'm2', ownerSeat: seat(1), type: 'run', cards: run4, jokerRepresents: {}, value: 30 },
    { id: 'm3', ownerSeat: seat(2), type: 'run', cards: run7, jokerRepresents: { 3: { suit: 'hearts', rank: '7' } }, value: 52 },
    { id: 'm4', ownerSeat: seat(3), type: 'set', cards: dup, jokerRepresents: {}, value: 24 },
  ];

  if (meldSet === 'long') {
    return [
      { id: 'L1', ownerSeat: seat(1), type: 'run', cards: run13, jokerRepresents: {}, value: 91 },
      { id: 'L2', ownerSeat: seat(2), type: 'run', cards: run7, jokerRepresents: { 3: { suit: 'hearts', rank: '7' } }, value: 52 },
      { id: 'L3', ownerSeat: seat(2), type: 'set', cards: set4, jokerRepresents: {}, value: 40 },
    ];
  }
  if (meldSet === 'jokers') {
    // A joker at the START, in the MIDDLE and at the END of a run.
    const first: FiftyOneCard[] = [joker(), c('5', 'spades'), c('6', 'spades'), c('7', 'spades')];
    const mid: FiftyOneCard[] = [c('9', 'diamonds'), c('10', 'diamonds'), joker(), c('Q', 'diamonds')];
    const last: FiftyOneCard[] = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts'), joker()];
    return [
      { id: 'J1', ownerSeat: seat(1), type: 'run', cards: first, jokerRepresents: { 0: { suit: 'spades', rank: '4' } }, value: 47 },
      { id: 'J2', ownerSeat: seat(1), type: 'run', cards: mid, jokerRepresents: { 2: { suit: 'diamonds', rank: 'J' } }, value: 41 },
      { id: 'J3', ownerSeat: seat(2), type: 'run', cards: last, jokerRepresents: { 3: { suit: 'hearts', rank: '6' } }, value: 18 },
    ];
  }
  if (meldSet === 'sameowner') {
    // FOUR melds for a SINGLE owner — the worst case for the grouped header.
    return [
      { id: 'S1', ownerSeat: seat(1), type: 'set', cards: set3, jokerRepresents: {}, value: 36 },
      { id: 'S2', ownerSeat: seat(1), type: 'run', cards: run4, jokerRepresents: {}, value: 30 },
      { id: 'S3', ownerSeat: seat(1), type: 'set', cards: set4, jokerRepresents: {}, value: 40 },
      { id: 'S4', ownerSeat: seat(1), type: 'run', cards: run7, jokerRepresents: { 3: { suit: 'hearts', rank: '7' } }, value: 52 },
    ];
  }
  if (meldSet === 'uneven') {
    // The owner's screenshot: a group with ONE 3-card set beside a group with several melds.
    return [
      { id: 'U1', ownerSeat: seat(1), type: 'set', cards: set3, jokerRepresents: {}, value: 36 },
      { id: 'U2', ownerSeat: seat(2), type: 'run', cards: run4, jokerRepresents: {}, value: 30 },
      { id: 'U3', ownerSeat: seat(2), type: 'run', cards: run7, jokerRepresents: { 3: { suit: 'hearts', rank: '7' } }, value: 52 },
      { id: 'U4', ownerSeat: seat(2), type: 'set', cards: set4, jokerRepresents: {}, value: 40 },
    ];
  }
  if (meldSet === 'single') {
    // ONE owner, ONE 3-card meld — the most obvious "half the screen" case.
    return [{ id: 'S1', ownerSeat: seat(1), type: 'set', cards: set3, jokerRepresents: {}, value: 36 }];
  }
  if (meldSet === 'redacted') return [];   // an online table before anyone opened
  return base;
}

const NAMES = ['You', 'A-player-with-a-really-long-display-name', 'Kai AI', 'Aziz AI'];

function fixture(): FiftyOneState {
  const people: FiftyOnePlayer[] = Array.from({ length: players }, (_, i) => ({
    id: `player-${i}`, name: NAMES[i], seatIndex: i, type: i === 0 ? 'human' : 'ai',
  }));
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
    publicMelds: melds(),
    scoresBySeat: Array.from({ length: players }, () => 30),
    // The LAST seat is eliminated whenever there is one to spare (an eliminated owner
    // must still lay out correctly).
    eliminatedSeats: Array.from({ length: players }, (_, i) => i === players - 1 && players > 2),
    roundNumber: 3, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
    options: { targetPenalty: 510 },
  } as unknown as FiftyOneState;
}

/** Seeded chat history — enough to fill the sheet's scrolling list. */
function chatHistory(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `chat-${i}`,
    clientId: i % 3 === 0 ? 'me' : `peer-${i % 3}`,
    name: NAMES[i % NAMES.length],
    avatar: '🙂',
    text: i % 4 === 0
      ? 'A deliberately long chat line so the bubble has to wrap inside the sheet body.'
      : `message ${i}`,
    createdAt: 1_700_000_000_000 + i * 1000,
    seatIndex: i % players,
  } as ChatMessage));
}

const noop = () => {};

function Harness() {
  const [state, setState] = useState<FiftyOneState>(fixture);
  const [panel, setPanel] = useState<SocialPanel>(startPanel);

  // Sequential state updates: the owner's phone renders a LIVE table, not a first paint.
  // Update 1 adds a card to an ALREADY-VISIBLE meld (the growth case); update 2 advances
  // the turn step. Readiness is announced only after both have painted.
  useEffect(() => {
    if (!withUpdates) { (window as { __f51ready?: boolean }).__f51ready = true; return; }
    let cancelled = false;
    const run = async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (cancelled) return;
      setState((s) => {
        if (s.publicMelds.length === 0) return s;
        const [first, ...rest] = s.publicMelds;
        const grown: FiftyOneMeld = {
          ...first,
          cards: [...first.cards, c('10', first.cards[0].suit ?? 'spades')],
          value: first.value + 10,
        };
        return { ...s, publicMelds: [grown, ...rest] };
      });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (cancelled) return;
      setState((s) => ({ ...s, turnStep: 'meld_discard' } as FiftyOneState));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (!cancelled) (window as { __f51ready?: boolean }).__f51ready = true;
    };
    void run();
    return () => { cancelled = true; };
  }, []);

  // The PRODUCTION online cluster: the same RoomSocial, variant and slots OnlineGame's
  // fifty-one branch builds, including the real destructive control.
  const social = withSocial ? (
    <RoomSocial
      reactions={[]}
      chat={chatHistory(chatCount)}
      myClientId="me"
      onReact={noop} onChat={noop} onChatMedia={noop}
      notice={null} onClearNotice={noop}
      handVisible={false}
      voiceButton={<button type="button" className="social-fab" aria-label="voice">🎙️</button>}
      mySeatIndex={0} seatCount={players}
      dangerSlot={<PermanentLeaveControl state={{ status: 'idle' }} onConfirm={noop} />}
      variant="sheet"
      openPanel={panel}
      onPanelChange={setPanel}
    />
  ) : null;

  return (
    <FiftyOneGameScreen
      state={state} humanSeat={0} apply={noop} onExit={noop} online={withSocial}
      menuSlot={social}
      timerSlot={withSocial ? <div className="turn-timer turn-timer--compact"><span>0:30</span></div> : undefined}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Harness />
    </LangProvider>
  </StrictMode>,
);
