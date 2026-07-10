import { useState } from 'react';
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

type Mode =
  | { kind: 'menu' }
  // Local play carries the chosen game (King unchanged; Durak = local prototype).
  | { kind: 'local'; gameType: GameType }
  | { kind: 'online'; url: string; intent: OnlineIntent };

export default function App() {
  const [mode, setMode] = useState<Mode>({ kind: 'menu' });
  // A join error carried back so the menu can highlight the offending field.
  const [joinError, setJoinError] = useState<ErrorCode | null>(null);

  if (mode.kind === 'local') {
    if (mode.gameType === 'durak') {
      return <DurakLocalGame onExit={() => setMode({ kind: 'menu' })} />;
    }
    if (mode.gameType === 'deberc') {
      return <DebercLocalGame onExit={() => setMode({ kind: 'menu' })} />;
    }
    if (mode.gameType === 'tarneeb') {
      return <TarneebLocalGame onExit={() => setMode({ kind: 'menu' })} />;
    }
    if (mode.gameType === 'preferans') {
      return <PreferansLocalGame onExit={() => setMode({ kind: 'menu' })} />;
    }
    return <LocalGame />; // King — unchanged
  }

  if (mode.kind === 'online') {
    return (
      <OnlineGame
        url={mode.url}
        intent={mode.intent}
        onExit={(err) => { setJoinError(err ?? null); setMode({ kind: 'menu' }); }}
      />
    );
  }

  return (
    <StartMenu
      initialError={joinError}
      onLocal={(gameType) => setMode({ kind: 'local', gameType })}
      onOnline={(url, intent) => { setJoinError(null); setMode({ kind: 'online', url, intent }); }}
    />
  );
}
