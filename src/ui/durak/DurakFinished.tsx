import { useI18n } from '../../i18n';
import type { DurakState } from '../../games/durak/types';
import MatchResult from '../components/MatchResult';
import { playerAvatar, type ResultSeat } from '../components/matchResultModel';
import RematchControls, { type RematchUi } from '../online/RematchControls';
import { detectSixAttack } from '../../net/durakStats';

interface Props {
  state: DurakState;
  humanId: string;
  onPlayAgain: () => void;
  onExit: () => void;
  /** Online rematch controls (Stage 25.9). When present, "Play again" restarts the room's game. */
  rematch?: RematchUi | null;
}

/** End screen: everyone who got rid of their cards survives; the last one holding cards is the fool. */
export default function DurakFinished({ state, humanId, onPlayAgain, onExit, rematch }: Props) {
  const { t } = useI18n();
  const humanIsFool = state.foolId === humanId;
  const title = state.isDraw ? t('durak.draw') : humanIsFool ? t('durak.youLost') : t('durak.youWon');
  const fool = state.players.find((p) => p.id === state.foolId);
  // «Погони» (DURAK_RULES §6): the fool took a finishing attack of sixes — a cosmetic shame mark.
  const six = detectSixAttack(state);
  const sixAttacker = six && state.players.find((p) => p.id === six.winnerId);

  // Survivors share first place (the engine keeps no exit order); the fool is last.
  const seats: ResultSeat[] = state.players.map((p) => {
    const isFool = p.id === state.foolId;
    return {
      key: p.id, name: p.name, avatar: playerAvatar(p), isMe: p.id === humanId,
      place: isFool ? state.players.length : 1,
      tone: isFool ? 'lose' : 'win',
      note: isFool ? t('durak.fool') : undefined,
      value: isFool && p.hand.length > 0 ? `🂠 ${p.hand.length}` : undefined,
    };
  });

  return (
    <MatchResult
      game="durak"
      outcome={state.isDraw ? 'draw' : humanIsFool ? 'fool' : 'win'}
      title={title}
      subtitle={!state.isDraw && fool ? <>{t('durak.fool')}: <strong>{fool.name}</strong></> : undefined}
      seats={seats}
      actions={<>
        {rematch
          ? <RematchControls {...rematch} />
          : <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('durak.playAgain')}</button>}
        <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
      </>}
    >
      {six && fool && sixAttacker && (
        <p className="durak-finished__epaulettes" role="status">
          <strong>🎖️ {t('durak.epaulettes')}</strong>{' '}
          {t('durak.epaulettesDesc').replace('{attacker}', sixAttacker.name).replace('{fool}', fool.name)}
        </p>
      )}
    </MatchResult>
  );
}
