import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import GameHelpModal from '../components/GameHelpModal';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../games/poker/rules';
import type { PlayerType } from '../../models/types';

export interface PokerSeatConfig {
  type: PlayerType;
  /** Display name for a human seat (ignored for bots — a bot identity is assigned). */
  name: string;
}

interface Props {
  onStart: (seats: PokerSeatConfig[]) => void;
  onExit: () => void;
}

const PLAYER_COUNTS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i); // 2..6

/** Default config for `count` seats: seat 0 human ("Player 1"), the rest bots. */
function defaultSeats(count: number, prev: PokerSeatConfig[] = []): PokerSeatConfig[] {
  return Array.from({ length: count }, (_, i) =>
    prev[i] ?? { type: i === 0 ? 'human' : 'ai', name: `Player ${i + 1}` } as PokerSeatConfig);
}

/**
 * Local poker setup — pick 2–6 seats and configure EACH seat as a Human or a Bot
 * (true pass-and-play, §14). Any valid mix of humans/bots is allowed as long as at
 * least one seat is human. Human names are free text (duplicates allowed); bots get
 * an assigned identity. No-Limit Hold'em, fixed blinds.
 */
export default function PokerSetup({ onStart, onExit }: Props) {
  const { t } = useI18n();
  const [count, setCount] = useState<number>(4);
  const [seats, setSeats] = useState<PokerSeatConfig[]>(() => defaultSeats(4));
  const [showHelp, setShowHelp] = useState(false);

  const humanCount = useMemo(() => seats.slice(0, count).filter((s) => s.type === 'human').length, [seats, count]);

  function setSeatCount(n: number) {
    setCount(n);
    setSeats((prev) => defaultSeats(n, prev));
  }
  function toggleType(i: number) {
    setSeats((prev) => prev.map((s, j) => (j === i ? { ...s, type: s.type === 'human' ? 'ai' : 'human' } : s)));
  }
  function setName(i: number, name: string) {
    setSeats((prev) => prev.map((s, j) => (j === i ? { ...s, name } : s)));
  }

  return (
    <div className="screen menu-screen poker-setup">
      {showHelp && <GameHelpModal game="poker" onClose={() => setShowHelp(false)} />}

      <header className="menu-header">
        <h1 className="menu-title">♠️ {t('gameType.poker')}</h1>
        <p className="menu-tagline">{t('poker.setupTagline')}</p>
      </header>

      <div className="setup-card">
        <label className="field__label">{t('poker.players')}</label>
        <div className="poker-setup__counts" role="group" aria-label={t('poker.players')}>
          {PLAYER_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              className={`btn ${n === count ? 'btn--primary' : 'btn--ghost'} poker-setup__count`}
              aria-pressed={n === count}
              onClick={() => setSeatCount(n)}
            >
              {n}
            </button>
          ))}
        </div>

        <label className="field__label">{t('poker.setup.seats')}</label>
        <ul className="poker-setup__seats">
          {seats.slice(0, count).map((seat, i) => (
            <li key={i} className="poker-setup__seat">
              <span className="poker-setup__seatno">{i + 1}</span>
              <button
                type="button"
                className={`btn poker-setup__role ${seat.type === 'human' ? 'btn--primary' : 'btn--ghost'}`}
                aria-pressed={seat.type === 'human'}
                onClick={() => toggleType(i)}
              >
                {seat.type === 'human' ? `🧑 ${t('poker.setup.human')}` : `🤖 ${t('poker.setup.bot')}`}
              </button>
              {seat.type === 'human' && (
                <input
                  className="poker-setup__name"
                  type="text"
                  value={seat.name}
                  maxLength={16}
                  onChange={(e) => setName(i, e.target.value)}
                  aria-label={`${t('poker.setup.human')} ${i + 1}`}
                />
              )}
            </li>
          ))}
        </ul>

        <p className="poker-setup__blinds">🪙 {t('poker.blindsNote')}</p>
        {humanCount === 0 && <p className="poker-setup__warn">⚠️ {t('poker.setup.needHuman')}</p>}

        <button type="button" className="poker-howto" aria-expanded={showHelp} onClick={() => setShowHelp(true)}>
          ❓ {t('help.howToPlay')}
        </button>

        <button
          type="button"
          className="btn btn--primary poker-setup__start"
          disabled={humanCount === 0}
          onClick={() => onStart(seats.slice(0, count).map((s) => ({ type: s.type, name: s.type === 'human' ? (s.name.trim() || `Player`) : s.name })))}
        >
          {t('poker.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
      </div>
    </div>
  );
}
