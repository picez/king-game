import { useI18n } from '../../i18n';
import type { DurakState } from '../../games/durak/types';

interface Props {
  state: DurakState;
  humanId: string;
  onPlayAgain: () => void;
  onExit: () => void;
}

/** End screen: did the human win / lose (become the fool) / draw. */
export default function DurakFinished({ state, humanId, onPlayAgain, onExit }: Props) {
  const { t } = useI18n();
  const humanIsFool = state.foolId === humanId;
  const title = state.isDraw ? t('durak.draw') : humanIsFool ? t('durak.youLost') : t('durak.youWon');
  const foolName = state.players.find((p) => p.id === state.foolId)?.name;

  return (
    <div className="screen durak-screen durak-finished">
      <div className="durak-finished__card">
        <div className="durak-finished__emoji" aria-hidden="true">{state.isDraw ? '🤝' : humanIsFool ? '🤡' : '🏆'}</div>
        <h1 className="durak-finished__title">{title}</h1>
        {!state.isDraw && foolName && <p className="durak-finished__sub">{t('durak.fool')}: <strong>{foolName}</strong></p>}
        <div className="durak-finished__actions">
          <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('durak.playAgain')}</button>
          <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
        </div>
      </div>
    </div>
  );
}
