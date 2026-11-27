import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import type { OnlineIntent } from './hooks/useNetworkGame';
import type { ErrorCode } from './net/messages';
import type { GameType } from './games/catalog';
import StartMenu from './ui/StartMenu';
import { usePwa } from './pwa/usePwa';
import PwaBanners from './ui/components/PwaBanners';
import { prefetchGameScreens, screenLoaders } from './gameScreens';
import ScreenLoadBoundary from './ui/components/ScreenLoadBoundary';

// Stage 44.2: each game screen is its own chunk (the menu no longer downloads all
// seven tables up front). `prefetchGameScreens` warms them after the menu is idle,
// so the service worker still has every game for offline play.
const LocalGame = lazy(screenLoaders.king);
const DurakLocalGame = lazy(screenLoaders.durak);
const DebercLocalGame = lazy(screenLoaders.deberc);
const TarneebLocalGame = lazy(screenLoaders.tarneeb);
const PreferansLocalGame = lazy(screenLoaders.preferans);
const FiftyOneLocalGame = lazy(screenLoaders.fiftyOne);
const PokerLocalGame = lazy(screenLoaders.poker);
const OnlineGame = lazy(screenLoaders.online);
const SolitaireApp = lazy(screenLoaders.solitaire);

type Mode =
  | { kind: 'menu' }
  // Local play carries the chosen game (King unchanged; Durak = local prototype).
  // `practice` (Stage 42.5): opened from a tutorial — King's setup pre-fills bots.
  | { kind: 'local'; gameType: GameType; practice?: boolean }
  | { kind: 'online'; url: string; intent: OnlineIntent; signedIn: boolean }
  // The solitaire section (its own hub + game screen).
  | { kind: 'solitaire' };

export default function App() {
  const [mode, setMode] = useState<Mode>({ kind: 'menu' });
  // A join error carried back so the menu can highlight the offending field.
  const [joinError, setJoinError] = useState<ErrorCode | null>(null);
  // A friend-invite room code carried from an in-game "Join room" tap → the menu joins it once
  // (Stage 26.1). Changing the online intent alone can't re-target OnlineGame, so an invite while
  // in another room routes through the menu, which owns the name/server/join flow.
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  // PWA install / update / offline surfaces (Stage 21.0) — rendered as a sibling of
  // every screen so the banners persist across menu/local/online without unmounting.
  const pwa = usePwa();
  const toMenu = () => setMode({ kind: 'menu' });
  useEffect(() => prefetchGameScreens(), []);

  let content: ReactNode;
  if (mode.kind === 'local') {
    content = mode.gameType === 'durak' ? <DurakLocalGame onExit={toMenu} />
      : mode.gameType === 'deberc' ? <DebercLocalGame onExit={toMenu} />
        : mode.gameType === 'tarneeb' ? <TarneebLocalGame onExit={toMenu} />
          : mode.gameType === 'preferans' ? <PreferansLocalGame onExit={toMenu} />
            : mode.gameType === 'fifty-one' ? <FiftyOneLocalGame onExit={toMenu} />
              : mode.gameType === 'poker' ? <PokerLocalGame onExit={toMenu} />
                : <LocalGame practice={mode.practice} />; // King
  } else if (mode.kind === 'solitaire') {
    content = <SolitaireApp onExit={toMenu} />;
  } else if (mode.kind === 'online') {
    content = (
      <OnlineGame
        url={mode.url}
        intent={mode.intent}
        signedIn={mode.signedIn}
        onExit={(err) => { setJoinError(err ?? null); setMode({ kind: 'menu' }); }}
        onJoinInvite={(code) => { setJoinError(null); setInviteCode(code); setMode({ kind: 'menu' }); }}
      />
    );
  } else {
    content = (
      <StartMenu
        initialError={joinError}
        initialInviteCode={inviteCode}
        onLocal={(gameType, opts) => setMode({ kind: 'local', gameType, practice: opts?.practice })}
        onSolitaire={() => setMode({ kind: 'solitaire' })}
        onOnline={(url, intent, signedIn) => {
          // Any online transition consumes a pending invite code (avoid re-joining on a later menu return).
          setJoinError(null); setInviteCode(null);
          setMode({ kind: 'online', url, intent, signedIn: !!signedIn });
        }}
      />
    );
  }

  return (
    <>
      <ScreenLoadBoundary key={mode.kind === 'local' ? `l:${mode.gameType}` : mode.kind}>
        <Suspense fallback={<div className="screen-loading" role="status" aria-busy="true" />}>{content}</Suspense>
      </ScreenLoadBoundary>
      {/* Install card is suppressed in a game; the thin update/offline strips stay. */}
      <PwaBanners pwa={pwa} inGame={mode.kind !== 'menu'} />
    </>
  );
}
