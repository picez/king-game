// Solitaire hub (S2): every solitaire with its variants, local record, the deal
// of the day, rules, the saved game and (S3) the leaderboards.

import { useState } from 'react';
import { useI18n } from '../../i18n';
import { SOLITAIRES, variantLabelKeys, type SolitaireInfo } from '../../solitaire/catalog';
import type { VariantKey } from '../../solitaire/engine';
import type { Session } from '../../solitaire/session';
import { totals, variantStats, type SolitaireStats } from '../../solitaire/stats';
import { utcDay } from '../../solitaire/daily';
import { formatClock, labelOf } from './format';
import SolitaireLeaderboard from './SolitaireLeaderboard';

interface Props {
  stats: SolitaireStats;
  saved: Session | null;
  /** A deal is being fetched from the server. */
  busy: boolean;
  onStart: (key: VariantKey, daily: boolean) => void;
  onResume: () => void;
  onExit: () => void;
  /** Opens the interactive guide of a solitaire. */
  onGuide: (id: SolitaireInfo['id']) => void;
}

export default function SolitaireHub({ stats, saved, busy, onStart, onResume, onExit, onGuide }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'games' | 'leaders'>('games');
  const [rules, setRules] = useState<SolitaireInfo | null>(null);
  const all = totals(stats);

  return (
    <div className="sol-hub-page">
      <div className="sheet sol-hub">
        <div className="sheet__head">
          <h2 className="sheet__title">🃏 {t('sol.title')}</h2>
          <button type="button" className="btn btn--ghost btn--small" onClick={onExit}>{t('btn.backToMenu')}</button>
        </div>
        <p className="sol-hub__totals">
          {t('sol.totals').replace('{won}', String(all.won)).replace('{played}', String(all.played)).replace('{streak}', String(all.bestStreak))}
        </p>

        <div className="sol-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'games'} className={`sol-tab${tab === 'games' ? ' sol-tab--on' : ''}`} onClick={() => setTab('games')}>{t('sol.tab.games')}</button>
          <button type="button" role="tab" aria-selected={tab === 'leaders'} className={`sol-tab${tab === 'leaders' ? ' sol-tab--on' : ''}`} onClick={() => setTab('leaders')}>{t('sol.tab.leaders')}</button>
        </div>

        {tab === 'leaders' && <SolitaireLeaderboard />}

        {tab === 'games' && (
          <>
            {saved && (
              <button type="button" className="sol-continue" onClick={onResume}>
                <span className="sol-continue__icon" aria-hidden="true">▶</span>
                <span className="sol-continue__text">
                  <span className="sol-continue__title">{t('sol.continue')}</span>
                  <span className="sol-continue__sub">{labelOf(t, saved.key)} · {formatClock(saved.elapsedMs)} · {t('sol.movesN').replace('{n}', String(saved.moves.length))}</span>
                </span>
              </button>
            )}
            <div className="sol-list">
              {SOLITAIRES.map((info) => <GameCard key={info.id} info={info} stats={stats} busy={busy} onStart={onStart} onRules={() => setRules(info)} onGuide={() => onGuide(info.id)} />)}
            </div>
          </>
        )}
      </div>

      {rules && (
        <div className="sol-modal" role="dialog" aria-modal="true" aria-label={t(`sol.${rules.id}.title`)} onClick={() => setRules(null)}>
          <div className="sol-modal__box" onClick={(e) => e.stopPropagation()}>
            <h3>{rules.icon} {t(`sol.${rules.id}.title`)}</h3>
            {t(`sol.${rules.id}.rules`).split('\n').map((line, i) => <p key={i}>{line}</p>)}
            <button type="button" className="btn btn--primary" onClick={() => setRules(null)}>{t('sol.close')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export { labelOf };

function GameCard({ info, stats, busy, onStart, onRules, onGuide }: { info: SolitaireInfo; stats: SolitaireStats; busy: boolean; onStart: Props['onStart']; onRules: () => void; onGuide: () => void }) {
  const { t } = useI18n();
  const [key, setKey] = useState<VariantKey>(info.variants[0].key);
  const v = variantStats(stats, key);
  const today = utcDay();
  const daily = stats.daily[key];
  const dailyDone = daily?.day === today && daily.won;

  return (
    <article className="sol-card">
      <div className="sol-card__head">
        <span className="sol-card__icon" aria-hidden="true">{info.icon}</span>
        <div className="sol-card__titles">
          <h3 className="sol-card__title">{t(`sol.${info.id}.title`)}</h3>
          <p className="sol-card__sub">{t(`sol.${info.id}.sub`)}</p>
        </div>
        <span className="sol-card__level" title={t(`sol.level${info.difficulty}`)} aria-label={t(`sol.level${info.difficulty}`)}>
          {'●'.repeat(info.difficulty)}{'○'.repeat(3 - info.difficulty)}
        </span>
      </div>
      {info.variants.length > 1 && (
        <div className="sol-chips" role="radiogroup">
          {info.variants.map((x) => (
            <button key={x.key} type="button" role="radio" aria-checked={key === x.key}
              className={`sol-chip${key === x.key ? ' sol-chip--on' : ''}`} onClick={() => setKey(x.key)}>
              {t(x.labelKey!)}
            </button>
          ))}
        </div>
      )}
      <p className="sol-card__stats">
        {v.played === 0
          ? t('sol.noGames')
          : t('sol.record').replace('{won}', String(v.won)).replace('{played}', String(v.played))
            + (v.bestMs !== null ? ` · ${t('sol.best')} ${formatClock(v.bestMs)}` : '')
            + (v.streak > 1 ? ` · 🔥${v.streak}` : '')}
      </p>
      <div className="sol-card__actions">
        <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => onStart(key, false)}>{t('sol.play')}</button>
        <button type="button" className="btn btn--outline btn--small" disabled={busy} onClick={() => onStart(key, true)}>
          {dailyDone ? '✓ ' : '📅 '}{t('sol.daily')}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onGuide}>🎓 {t('solTut.open')}</button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onRules}>❓ {t('sol.rules')}</button>
      </div>
    </article>
  );
}
