// ---------------------------------------------------------------------------
// GameHelpModal (Stage 22.0) — a single, generic "How to play" sheet that works
// for EVERY game from the pure help catalog (src/games/gameHelp.ts) + the i18n
// dictionaries. Given a GameType it renders the game's ordered short sections
// (Goal / Players / Deck / Turns / Scoring / Notes). No gameplay/engine imports;
// pure presentational. Replaces the need for a bespoke help component per game.
// ---------------------------------------------------------------------------

import { useI18n } from '../../i18n';
import { useEscToClose } from '../../hooks/useEscToClose';
import type { GameType } from '../../games/catalog';
import { gameHelp, helpLabelKey, helpContentKey } from '../../games/gameHelp';
import { GAME_EMOJI } from './GameIcon';

interface Props {
  game: GameType;
  onClose: () => void;
}

/** In-menu / in-game quick-rules modal for the given game. */
export default function GameHelpModal({ game, onClose }: Props) {
  const { t } = useI18n();
  useEscToClose(onClose);
  const entry = gameHelp(game);

  return (
    <div className="game-help-overlay" role="dialog" aria-modal="true"
      aria-label={`${t('help.howToPlay')} — ${t(`gameType.${game}`)}`} onClick={onClose}>
      <div className="game-help" onClick={(e) => e.stopPropagation()}>
        <div className="game-help__head">
          <h2 className="game-help__title">
            <span aria-hidden="true">{GAME_EMOJI[game]}</span> {t(`gameType.${game}`)}
          </h2>
          <button type="button" className="btn btn--ghost game-help__x" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <p className="game-help__sub">{t('help.howToPlay')}</p>
        <dl className="game-help__list">
          {entry.sections.map((section) => (
            <div key={section} className="game-help__row">
              <dt className="game-help__label">{t(helpLabelKey(section))}</dt>
              <dd className="game-help__content">{t(helpContentKey(game, section))}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="btn btn--primary game-help__ok" onClick={onClose} autoFocus>{t('help.gotIt')}</button>
      </div>
    </div>
  );
}
