import { useGame } from '../../hooks/useGame';
import { useI18n } from '../../i18n';
import { getActingPlayerId } from '../../core/gameEngine';
import { SUIT_SYMBOL } from '../components/CardView';
import PlayerHand from '../components/PlayerHand';
import TablePlayers from '../components/TablePlayers';
import CollectedPanel from '../components/CollectedPanel';
import TurnTimer from '../components/TurnTimer';

interface Props {
  myPlayerId: string | null;
}

const WAIT_KEY: Record<string, string> = {
  mode_selection: 'wait.to.choose',
  kitty_exchange: 'wait.to.kitty',
  select_trump: 'wait.to.trump',
  playing: 'wait.to.play',
};

/**
 * Shown to an online client while it is NOT their turn. Renders the public
 * table (trick) plus this client's OWN hand (read-only). Opponents' hands are
 * already redacted out of the received state, so nothing private leaks.
 */
export default function OnlineWaitingScreen({ myPlayerId }: Props) {
  const { state, disconnectedSeats } = useGame();
  const { t } = useI18n();
  if (!state) return null;

  const me = state.players.find((p) => p.id === myPlayerId);
  const dealer = state.players[state.dealerIndex];
  const actingId = getActingPlayerId(state);
  const actingPlayer = state.players.find((p) => p.id === actingId);
  const actingName = actingPlayer?.name ?? '…';
  const actingIsBot = actingPlayer?.type === 'ai';
  const actingOffline = actingPlayer != null && (disconnectedSeats ?? []).includes(actingPlayer.seatIndex);
  const what = t(WAIT_KEY[state.status] ?? 'wait.to.play');

  // During Dealer's-Choice mode selection the round mode is still a placeholder
  // — don't show a misleading mode badge before the dealer picks.
  const modeChosen = state.status !== 'mode_selection';
  const modeLabel = modeChosen ? t(`mode.${state.currentRound.mode.id}`) : `${t('mode.choose')}…`;

  return (
    <div className="screen game-screen">
      <div className="game-header">
        <div className="game-header__info">
          <span className={`mode-badge ${modeChosen ? `mode-badge--${state.currentRound.mode.type}` : ''}`}>
            {modeLabel}
          </span>
          <span className="dealer-info"><span className="dealer-crown">👑</span>{dealer?.name}</span>
          {state.trumpSuit && (
            <span className="trump-info trump-suit-badge">{SUIT_SYMBOL[state.trumpSuit]}</span>
          )}
        </div>
      </div>

      {state.currentRoundIdx === 0 && (
        <p className="first-dealer-note">🎲 {t('game.firstDealer')}: <strong>{dealer?.name}</strong></p>
      )}

      {modeChosen && (
        <div className={`game-banner game-banner--${state.currentRound.mode.type}`}>
          <span className="game-banner__mode">{modeLabel}</span>
          {state.trumpSuit && (
            <span className="game-banner__trump">{t('common.trump')}: {SUIT_SYMBOL[state.trumpSuit]}</span>
          )}
          <span className="game-banner__dealer">👑 {dealer?.name}</span>
          <p className="game-banner__rule">
            {state.currentRound.mode.type === 'positive' ? t('tip.positive') : t(`tip.${state.currentRound.mode.id}`)}
          </p>
        </div>
      )}

      <div className="leader-banner">
        <span className="leader-arrow">{actingOffline ? '📴' : actingIsBot ? '🤖' : '▶'}</span>
        {t('wait.waitingFor')} <strong>&nbsp;{actingName}</strong>&nbsp;
        {actingOffline ? t('wait.reconnect') : actingIsBot ? t('wait.botThinking') : what}
        <TurnTimer />
      </div>

      <div className="game-body">
        <TablePlayers viewerId={myPlayerId} />
      </div>

      <div className="game-footer">
        <div className="turn-banner turn-banner--ai">
          <span className="ai-thinking-icon">⏳</span>
          <span className="turn-banner__name">{t('wait.yourHand')} ({me?.hand.length ?? 0})</span>
        </div>
        {me && (
          <PlayerHand hand={me.hand} validCards={[]} onPlay={() => {}} disabled />
        )}
        <CollectedPanel playerId={myPlayerId} />
      </div>
    </div>
  );
}
