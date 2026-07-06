import { useState } from 'react';
import { useGame } from '../hooks/useGame';
import { useI18n } from '../i18n';
import type { PlayerType } from '../models/types';

const DEFAULT_NAMES_3 = ['Alice', 'Bob', 'Carol'];
const DEFAULT_NAMES_4 = ['Alice', 'Bob', 'Carol', 'Dave'];

export default function SetupScreen() {
  const { dispatch } = useGame();
  const { t } = useI18n();
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
      <h1 className="screen__title">{t('app.title')}</h1>
      <p className="screen__subtitle">{t('app.subtitle')}</p>

      <div className="setup-card">
        <h2>{t('setup.newGame')}</h2>

        <div className="field-group">
          <label>{t('setup.numberOfPlayers')}</label>
          <div className="button-row">
            {([3, 4] as const).map((n) => (
              <button
                key={n}
                className={`btn btn--outline ${playerCount === n ? 'btn--active' : ''}`}
                onClick={() => handleCountChange(n)}
              >
                {t('setup.playersCount').replace('{n}', String(n))}
              </button>
            ))}
          </div>
          <p className="setup-hint">
            {playerCount === 3 ? t('setup.deck3') : t('setup.deck4')}
          </p>
        </div>

        <div className="field-group">
          <label>{t('setup.modeSelection')}</label>
          <div className="button-row">
            {(['dealer_choice', 'fixed'] as const).map((type) => (
              <button
                key={type}
                className={`btn btn--outline ${modeSelectionType === type ? 'btn--active' : ''}`}
                onClick={() => setModeSelectionType(type)}
              >
                {type === 'fixed' ? t('form.fixedOrder') : t('form.dealerChoice')}
              </button>
            ))}
          </div>
          <p className="setup-hint">
            {modeSelectionType === 'dealer_choice' ? t('setup.dealerChoiceHint') : t('setup.fixedHint')}
          </p>
        </div>

        <div className="field-group">
          <label>{t('form.players')}</label>
          {names.slice(0, playerCount).map((name, i) => (
            <div key={i} className="player-setup-row">
              <input
                className="input"
                value={name}
                onChange={(e) => handleNameChange(i, e.target.value)}
                placeholder={t('setup.playerN').replace('{n}', String(i + 1))}
                maxLength={20}
              />
              <button
                className={`btn btn--small player-type-btn ${playerTypes[i] === 'ai' ? 'player-type-btn--ai' : 'player-type-btn--human'}`}
                onClick={() => handleTypeToggle(i)}
                title={playerTypes[i] === 'ai' ? t('setup.switchToHuman') : t('setup.switchToAi')}
              >
                {playerTypes[i] === 'ai' ? `🤖 ${t('setup.aiLabel')}` : `👤 ${t('setup.humanLabel')}`}
              </button>
            </div>
          ))}
        </div>

        <button className="btn btn--primary btn--large" onClick={handleStart}>
          {t('btn.start')}
        </button>
      </div>
    </div>
  );
}
