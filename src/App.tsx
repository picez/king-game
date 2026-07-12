import { useState, type ReactNode } from 'react';
import type { OnlineIntent } from './hooks/useNetworkGame';
import type { ErrorCode } from './net/messages';
import type { GameType } from './games/catalog';
import StartMenu from './ui/StartMenu';
import LocalGame from './ui/LocalGame';
import DurakLocalGame from './ui/durak/DurakLocalGame';
import DebercLocalGame from './ui/deberc/DebercLocalGame';
import TarneebLocalGame from './ui/tarneeb/TarneebLocalGame';
import PreferansLocalGame from './ui/preferans/PreferansLocalGame';
import OnlineGame from './ui/online/OnlineGame';
import { usePwa } from './pwa/usePwa';
import PwaBanners from './ui/components/PwaBanners';

type Mode =
  | { kind: 'menu' }
  // Local play carries the chosen game (King unchanged; Durak = local prototype).
  | { kind: 'local'; gameType: GameType }
  | { kind: 'online'; url: string; intent: OnlineIntent; signedIn: boolean };

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

  let content: ReactNode;
  if (mode.kind === 'local') {
    content = mode.gameType === 'durak' ? <DurakLocalGame onExit={toMenu} />
      : mode.gameType === 'deberc' ? <DebercLocalGame onExit={toMenu} />
        : mode.gameType === 'tarneeb' ? <TarneebLocalGame onExit={toMenu} />
          : mode.gameType === 'preferans' ? <PreferansLocalGame onExit={toMenu} />
            : <LocalGame />; // King — unchanged
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
        onLocal={(gameType) => setMode({ kind: 'local', gameType })}
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
      {content}
      {/* Install card is suppressed in a game; the thin update/offline strips stay. */}
      <PwaBanners pwa={pwa} inGame={mode.kind !== 'menu'} />
    </>
  );
}
