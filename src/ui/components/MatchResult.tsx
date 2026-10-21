// ---------------------------------------------------------------------------
// MatchResult (Stage 42.1) — the shared end-of-match screen for all seven games.
//
// The result is laid on the table as dealt cards: one card per finisher (cream
// face, place in the corner, avatar in the middle, name + score at the foot). A
// single winner stands tallest in a 2 · 1 · 3 podium; a winner GROUP (Durak's
// survivors, a tie) sits in one row; losers wear a red face; teams get two wide
// cards. Everything else — a game's score sheet, the rematch controls — is passed
// in, so each game keeps its own details and actions.
//
// One orchestrated motion: the cards are dealt in, then the winner lifts. It
// honours <html data-motion-effective> (reduced → fade only, off → static).
// ---------------------------------------------------------------------------

import type { CSSProperties, ReactNode } from 'react';
import { GAME_CATALOG, type GameType } from '../../games/catalog';
import { useI18n } from '../../i18n';
import GameIcon from './GameIcon';
import WinnerCelebration from './WinnerCelebration';
import { splitPodium, type ResultOutcome, type ResultSeat, type ResultTeam } from './matchResultModel';

interface Props {
  game: GameType;
  /** The viewer's own result. */
  outcome: ResultOutcome;
  title: string;
  subtitle?: ReactNode;
  /** Individual finishers (ignored when `teams` is given). */
  seats?: ResultSeat[];
  teams?: ResultTeam[];
  /** Game-specific extras (score sheets, banners) under the standings. */
  children?: ReactNode;
  actions: ReactNode;
}

const MEDALLION: Record<ResultOutcome, string> = { win: '🏆', loss: '🃏', draw: '🤝', fool: '🤡' };
const SUIT_BY_PLACE = ['♠', '♥', '♦', '♣'];

export default function MatchResult({ game, outcome, title, subtitle, seats = [], teams, children, actions }: Props) {
  const { t } = useI18n();
  const celebrate = outcome === 'win' ? (teams ? 'teamWin' : 'win') : outcome === 'draw' ? 'draw' : 'loss';
  const split = teams ? { podium: [], rest: [] } : splitPodium(seats);
  const soleWinner = seats.filter((s) => s.place === 1).length === 1;
  const isPodium = split.podium.length > 1 && soleWinner;
  // A winner GROUP (Durak's survivors, a tie): up to four seats are all dealt as cards,
  // the loser on a red face; a bigger table lists everyone after the winners.
  const allCards = !teams && !isPodium && seats.length <= 4;
  const podium = allCards ? [...seats].sort((a, b) => a.place - b.place) : split.podium;
  const rest = allCards ? [] : split.rest;
  let dealt = 0; // deal order for the staggered entrance
  const deal = (): CSSProperties => ({ ['--deal' as string]: dealt++ });

  return (
    <div className={`screen result-screen result-screen--${outcome}`}>
      <section className="result" aria-labelledby="result-title">
        <WinnerCelebration kind={celebrate} />
        <div className="result__game"><GameIcon game={game} size="sm" /><span>{t(GAME_CATALOG[game].titleKey)}</span></div>
        <div className="result__medallion" aria-hidden="true">{MEDALLION[outcome]}</div>
        <h1 id="result-title" className="result__title">{title}</h1>
        {subtitle && <p className="result__subtitle">{subtitle}</p>}

        {teams ? (
          <div className="result__teams">
            {teams.map((team) => (
              <article key={team.key} style={deal()}
                className={`result-card result-card--team ${team.won ? 'result-card--winner' : 'result-card--down'}`}>
                <span className="result-card__corner" aria-hidden="true">{team.won ? '1' : '2'}<i>{team.won ? '♠' : '♥'}</i></span>
                <span className="result-card__faces" aria-hidden="true">
                  {team.members.map((m) => <span key={m.name} className="result-card__avatar">{m.avatar}</span>)}
                </span>
                <span className="result-card__name">{team.label}</span>
                {team.value != null && <span className="result-card__value">{team.value}</span>}
                {team.won && <span className="result-card__ribbon">{t('result.winner')}</span>}
              </article>
            ))}
          </div>
        ) : (
          <div className={`result__deal ${isPodium ? 'result__deal--podium' : 'result__deal--row'}`}>
            {podium.map((s) => <SeatCard key={s.key} seat={s} you={t('result.you')} winnerLabel={soleWinner ? t('result.winner') : null} style={deal()} />)}
          </div>
        )}

        {rest.length > 0 && (
          <ol className="result__standings">
            {rest.map((s) => (
              <li key={s.key} style={deal()}
                className={`result-row ${s.tone === 'lose' ? 'result-row--lose' : ''} ${s.isMe ? 'result-row--me' : ''}`}>
                <span className="result-row__place">{s.place}</span>
                <span className="result-row__avatar" aria-hidden="true">{s.avatar}</span>
                <span className="result-row__name">{s.name}{s.isMe && <em> · {t('result.you')}</em>}</span>
                {s.note && <span className="result-row__note">{s.note}</span>}
                {s.value != null && <span className="result-row__value">{s.value}</span>}
              </li>
            ))}
          </ol>
        )}

        {children && <div className="result__details">{children}</div>}
        <div className="result__actions">{actions}</div>
      </section>
    </div>
  );
}

function SeatCard({ seat, you, winnerLabel, style }: { seat: ResultSeat; you: string; winnerLabel: string | null; style: CSSProperties }) {
  const winner = seat.place === 1 && seat.tone !== 'lose';
  const cls = [
    'result-card',
    winner ? 'result-card--winner' : '',
    seat.tone === 'lose' ? 'result-card--lose' : '',
    seat.isMe ? 'result-card--me' : '',
    `result-card--place-${Math.min(seat.place, 4)}`,
  ].filter(Boolean).join(' ');
  return (
    <article className={cls} style={style}>
      <span className="result-card__corner" aria-hidden="true">
        {seat.place}<i>{SUIT_BY_PLACE[(seat.place - 1) % 4]}</i>
      </span>
      <span className="result-card__avatar" aria-hidden="true">{seat.avatar}</span>
      <span className="result-card__name">{seat.name}</span>
      {seat.isMe && <span className="result-card__you">{you}</span>}
      {seat.value != null && <span className="result-card__value">{seat.value}</span>}
      {seat.note && <span className="result-card__note">{seat.note}</span>}
      {winner && winnerLabel && <span className="result-card__ribbon">{winnerLabel}</span>}
    </article>
  );
}
