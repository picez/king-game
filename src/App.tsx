import { useState } from 'react';
import type { OnlineIntent } from './hooks/useNetworkGame';
import type { ErrorCode } from './net/messages';
import StartMenu from './ui/StartMenu';
import LocalGame from './ui/LocalGame';
import OnlineGame from './ui/online/OnlineGame';

type Mode =
  | { kind: 'menu' }
  | { kind: 'local' }
  | { kind: 'online'; url: string; intent: OnlineIntent };

export default function App() {
  const [mode, setMode] = useState<Mode>({ kind: 'menu' });
  // A join error carried back so the menu can highlight the offending field.
  const [joinError, setJoinError] = useState<ErrorCode | null>(null);

  if (mode.kind === 'local') {
    return <LocalGame />;
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
      onLocal={() => setMode({ kind: 'local' })}
      onOnline={(url, intent) => { setJoinError(null); setMode({ kind: 'online', url, intent }); }}
    />
  );
}
