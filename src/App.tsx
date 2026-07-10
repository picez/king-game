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
  | { kind: 'online'; url: string; intent: OnlineIntent };

export default function App() {
  const [mode, setMode] = useState<Mode>({ kind: 'menu' });
  // A join error carried back so the menu can highlight the offending field.
  const [joinError, setJoinError] = useState<ErrorCode | null>(null);
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
        onExit={(err) => { setJoinError(err ?? null); setMode({ kind: 'menu' }); }}
      />
    );
  } else {
    content = (
      <StartMenu
        initialError={joinError}
        onLocal={(gameType) => setMode({ kind: 'local', gameType })}
        onOnline={(url, intent) => { setJoinError(null); setMode({ kind: 'online', url, intent }); }}
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
