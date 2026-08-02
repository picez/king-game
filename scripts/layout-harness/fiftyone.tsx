// ---------------------------------------------------------------------------
// Fifty-One LAYOUT-QA harness (Stage 38.0.4). Dev-only — never bundled (the app build
// has a single index.html entry and this lives under scripts/).
//
// The owner hit two real defects on a phone: a 4-card meld was clipped (the block was
// capped at 18rem while 4×72px cards + gaps need ~320px, and the row scrolled INSIDE
// itself), and the floating social cluster sat on top of the melds. This harness mounts
// the REAL FiftyOneGameScreen with a worst-case public table so
// `scripts/fiftyone-layout-qa.mjs` can measure actual bounding boxes.
//
// Query params: players=2..4  dir=ltr|rtl  lang=en|uk|de|ar  social=1 (docked cluster)
//               legacy=1 (re-apply the pre-fix meld CSS to prove the RED)
// ---------------------------------------------------------------------------

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/App.css';
import { LangProvider } from '../../src/i18n';
import RoomSocial, { type SocialPanel } from '../../src/ui/online/RoomSocial';
import FiftyOneGameScreen from '../../src/ui/fiftyOne/FiftyOneGameScreen';
import type {
  FiftyOneCard, FiftyOneMeld, FiftyOnePlayer, FiftyOneState,
} from '../../src/games/fiftyOne/types';
import type { Rank, Suit } from '../../src/models/types';

const qs = new URLSearchParams(location.search);
const players = Math.max(2, Math.min(4, Number(qs.get('players') ?? 4)));
const dir = qs.get('dir') === 'rtl' ? 'rtl' : 'ltr';
const lang = qs.get('lang') ?? (dir === 'rtl' ? 'ar' : 'en');
const socialMode = qs.get('social') ?? 'none';   // 'none' | 'float' (today) | 'dock' (fixed)
const withSocial = socialMode !== 'none';
const legacy = qs.get('legacy') === '1';

document.documentElement.dir = dir;
document.documentElement.lang = lang;
try { localStorage.setItem('king.lang.v1', lang); } catch { /* ignore */ }

// `legacy=1` restores the EXACT pre-Stage-38.0.4 meld rules, so the RED run measures the
// real old geometry rather than a description of it.
if (legacy) {
  const style = document.createElement('style');
  style.textContent = `
    .fiftyone-meld { max-width: min(100%, 18rem) !important; }
    .fiftyone-meld__cards { flex-wrap: nowrap !important; overflow-x: auto !important; }
    .fiftyone-melds { --f51-meld-card-w: 72px !important; --f51-meld-card-h: 112px !important; }
    .fiftyone-meld__cards > * { flex: 0 0 72px !important; width: 72px !important; height: 112px !important; }
    .fiftyone-meld__cards .card { width: 72px !important; height: 112px !important; }
  `;
  document.head.appendChild(style);
}

let n = 0;
const c = (rank: Rank, suit: Suit): FiftyOneCard => ({ id: `c${n++}-${suit}-${rank}`, joker: false, suit, rank });
const joker = (): FiftyOneCard => ({ id: `j${n++}`, joker: true, suit: null, rank: null });

/** A worst-case public table: a 3-set, a 4-run, a 7-run, duplicates and a joker. */
function melds(): FiftyOneMeld[] {
  const set3: FiftyOneCard[] = [c('Q', 'hearts'), c('Q', 'clubs'), c('Q', 'diamonds')];
  const run4: FiftyOneCard[] = [c('6', 'spades'), c('7', 'spades'), c('8', 'spades'), c('9', 'spades')];
  // A long run that MUST wrap: 7 cards.
  const run7: FiftyOneCard[] = [
    c('4', 'hearts'), c('5', 'hearts'), c('6', 'hearts'), joker(),
    c('8', 'hearts'), c('9', 'hearts'), c('10', 'hearts'),
  ];
  // Duplicates from the second deck (same rank+suit as run4's 6♠/7♠).
  const dup: FiftyOneCard[] = [c('6', 'spades'), c('6', 'clubs'), c('6', 'diamonds'), c('6', 'hearts')];
  // Owners are clamped to real seats so a 2-player table stays well-formed.
  const seat = (i: number) => Math.min(i, players - 1);
  return [
    { id: 'm1', ownerSeat: seat(1), type: 'set', cards: set3, jokerRepresents: {}, value: 30 },
    { id: 'm2', ownerSeat: seat(1), type: 'run', cards: run4, jokerRepresents: {}, value: 30 },
    { id: 'm3', ownerSeat: seat(2), type: 'run', cards: run7, jokerRepresents: { 3: { suit: 'hearts', rank: '7' } }, value: 52 },
    { id: 'm4', ownerSeat: seat(3), type: 'set', cards: dup, jokerRepresents: {}, value: 24 },
  ];
}

function fixture(): FiftyOneState {
  const names = ['You', 'A-player-with-a-really-long-display-name', 'Kai AI', 'Aziz AI'];
  const people: FiftyOnePlayer[] = Array.from({ length: players }, (_, i) => ({
    id: `player-${i}`, name: names[i], seatIndex: i, type: i === 0 ? 'human' : 'ai',
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
    eliminatedSeats: Array.from({ length: players }, () => false),
    roundNumber: 3, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
    options: { targetPenalty: 510 },
  } as unknown as FiftyOneState;
}

const state = fixture();
const noop = () => {};

function Harness() {
  const [panel, setPanel] = useState<SocialPanel>('none');
  const social = withSocial ? (
    <RoomSocial
      reactions={[]} chat={[]} myClientId="me"
      onReact={noop} onChat={noop} onChatMedia={noop}
      notice={null} onClearNotice={noop}
      handVisible={false}
      voiceButton={<button type="button" className="social-fab" aria-label="voice">🎙️</button>}
      mySeatIndex={0} seatCount={players}
      timerSlot={<div className="turn-timer turn-timer--compact"><span>0:30</span></div>}
      variant={socialMode === 'dock' ? 'docked' : 'floating'}
      openPanel={panel} onPanelChange={setPanel}
    />
  ) : null;
  return (
    <>
      <FiftyOneGameScreen
        state={state} humanSeat={0} apply={noop} onExit={noop} online={withSocial}
        socialSlot={socialMode === 'dock' ? social : undefined}
      />
      {/* `float` reproduces production TODAY: a fixed cluster over the game content. */}
      {socialMode === 'float' && social}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Harness />
    </LangProvider>
  </StrictMode>,
);
