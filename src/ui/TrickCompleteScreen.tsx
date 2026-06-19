import { useGame } from '../hooks/useGame';
import { useI18n } from '../i18n';
import TablePlayers from './components/TablePlayers';

/**
 * Trick just completed: show the table with the centre cards "collecting" and
 * the winning seat pulsing, plus a brief inline toast. Non-blocking — the table
 * auto-advances shortly (local: LocalGame timer; online: server). Privacy is
 * preserved: no hands are shown here.
 */
export default function TrickCompleteScreen() {
  const { state } = useGame();
  const { t } = useI18n();
  if (!state || !state.currentTrick) return null;

  const trick = state.currentTrick;
  const winner = state.players.find((p) => p.id === trick.winnerId);
  const winnerIsAI = winner?.type === 'ai';

  return (
    <div className="screen game-screen">
      <div className="trick-toast-bar">
        {winnerIsAI ? '🤖 ' : ''}{winner?.name ?? '?'} {t('trick.takes')}
      </div>
      <div className="game-body">
        {/* Anchor the table to the winner for the brief celebration. */}
        <TablePlayers viewerId={trick.winnerId} />
      </div>
    </div>
  );
}
