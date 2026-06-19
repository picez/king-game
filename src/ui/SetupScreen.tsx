import { useState } from 'react';
import { useGame } from '../hooks/useGame';
import type { PlayerType } from '../models/types';

const DEFAULT_NAMES_3 = ['Alice', 'Bob', 'Carol'];
const DEFAULT_NAMES_4 = ['Alice', 'Bob', 'Carol', 'Dave'];

export default function SetupScreen() {
  const { dispatch } = useGame();
  const [playerCount, setPlayerCount] = useState<3 | 4>(4);
  const [names, setNames] = useState<string[]>(DEFAULT_NAMES_4);
  const [playerTypes, setPlayerTypes] = useState<PlayerType[]>(['human', 'human', 'human', 'human']);
  const [modeSelectionType, setModeSelectionType] = useState<'fixed' | 'dealer_choice'>('dealer_choice');

  function handleCountChange(count: 3 | 4) {
    setPlayerCount(count);
    setNames(count === 3 ? DEFAULT_NAMES_3 : DEFAULT_NAMES_4);
    setPlayerTypes(Array(count).fill('human') as PlayerType[]);
  }

  function handleNameChange(idx: number, value: string) {
    setNames((prev) => prev.map((n, i) => (i === idx ? value : n)));
  }

  function handleTypeToggle(idx: number) {
    setPlayerTypes((prev) => prev.map((t, i) => i === idx ? (t === 'human' ? 'ai' : 'human') : t));
  }

  function handleStart() {
    const trimmed = names.map((n) => n.trim()).filter(Boolean);
    if (trimmed.length !== playerCount) return;
    dispatch({ type: 'START_GAME', playerNames: trimmed, playerTypes: playerTypes.slice(0, playerCount), modeSelectionType });
  }

  return (
    <div className="screen setup-screen">
      <h1 className="screen__title">King — Card Game</h1>
      <p className="screen__subtitle">A classic trick-taking game</p>

      <div className="setup-card">
        <h2>New Game</h2>

        <div className="field-group">
          <label>Number of Players</label>
          <div className="button-row">
            {([3, 4] as const).map((n) => (
              <button
                key={n}
                className={`btn btn--outline ${playerCount === n ? 'btn--active' : ''}`}
                onClick={() => handleCountChange(n)}
              >
                {n} Players
              </button>
            ))}
          </div>
          <p className="setup-hint">
            {playerCount === 3
              ? '32-card deck · 10 cards each · 2-card kitty · 27 rounds'
              : '52-card deck · 13 cards each · no kitty · 36 rounds'}
          </p>
        </div>

        <div className="field-group">
          <label>Mode Selection</label>
          <div className="button-row">
            {(['dealer_choice', 'fixed'] as const).map((type) => (
              <button
                key={type}
                className={`btn btn--outline ${modeSelectionType === type ? 'btn--active' : ''}`}
                onClick={() => setModeSelectionType(type)}
              >
                {type === 'fixed' ? 'Fixed Order' : "Dealer's Choice"}
              </button>
            ))}
          </div>
          <p className="setup-hint">
            {modeSelectionType === 'dealer_choice'
              ? "Dealer's Choice (recommended): each dealer picks any unused mode each round"
              : 'Fixed order: No Tricks → No Hearts → … → Trump'}
          </p>
        </div>

        <div className="field-group">
          <label>Players</label>
          {names.slice(0, playerCount).map((name, i) => (
            <div key={i} className="player-setup-row">
              <input
                className="input"
                value={name}
                onChange={(e) => handleNameChange(i, e.target.value)}
                placeholder={`Player ${i + 1}`}
                maxLength={20}
              />
              <button
                className={`btn btn--small player-type-btn ${playerTypes[i] === 'ai' ? 'player-type-btn--ai' : 'player-type-btn--human'}`}
                onClick={() => handleTypeToggle(i)}
                title={playerTypes[i] === 'ai' ? 'AI player — click to switch to human' : 'Human player — click to switch to AI'}
              >
                {playerTypes[i] === 'ai' ? '🤖 AI' : '👤 Human'}
              </button>
            </div>
          ))}
        </div>

        <button className="btn btn--primary btn--large" onClick={handleStart}>
          Start Game
        </button>
      </div>
    </div>
  );
}
