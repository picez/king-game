import { useId, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  TRACKED_ONLINE_GAMES, type Loadable, type OnlineCounters,
  type OnlineCategorySplit, type OnlineTracker,
} from '../../net/statsApi';

interface Props {
  /** null while the first request is in flight. */
  result: Loadable<OnlineTracker> | null;
  loading: boolean;
}

/** `overall` plus one entry per tracked game — Poker is deliberately absent. */
type Selection = 'overall' | typeof TRACKED_ONLINE_GAMES[number];
const SELECTIONS: readonly Selection[] = ['overall', ...TRACKED_ONLINE_GAMES];

/**
 * "Online matches" — the personal ONLINE participation tracker (Stage 38.0.6).
 *
 * Deliberately small: a chip strip (Overall + each tracked game) and TWO cards, one per
 * frozen room category. It is not a dashboard and it does not replace, duplicate or
 * touch the detailed per-game statistics, the ratings, the achievements or the
 * leaderboards below it.
 *
 * What it shows is exactly what the server counts (`src/net/onlineTracker.ts`):
 *  - ONLINE matches only — local pass-and-play never creates a match record;
 *  - Poker is out of scope at this stage;
 *  - `human_only` and `with_bots` are ALWAYS separate and never summed together;
 *  - a match still being played does not count; a permanent leave counts immediately
 *    (it is already a terminal, forfeited loss for that player);
 *  - `matches = wins + losses + draws`, `forfeits ⊆ losses`, and a win rate of "—"
 *    when nothing has been played (never NaN).
 *
 * An account with no online history renders the SAME block with zeros — the block never
 * disappears, so "0" is a readable answer rather than a missing section.
 */
export default function OnlineTrackerPanel({ result, loading }: Props) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Selection>('overall');
  const panelId = useId();

  const label = (s: Selection) => (s === 'overall' ? t('tracker.overall') : t(`gameType.${s}`));

  return (
    <section className="online-tracker" aria-labelledby={`${panelId}-title`}>
      <h4 className="online-tracker__title" id={`${panelId}-title`}>{t('tracker.title')}</h4>

      <div className="online-tracker__chips" role="tablist" aria-label={t('tracker.title')}>
        {SELECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            id={`${panelId}-tab-${s}`}
            aria-selected={selected === s}
            aria-controls={`${panelId}-body`}
            className={`online-tracker__chip ${selected === s ? 'online-tracker__chip--active' : ''}`}
            onClick={() => setSelected(s)}
          >
            {label(s)}
          </button>
        ))}
      </div>

      <div
        className="online-tracker__body"
        id={`${panelId}-body`}
        role="tabpanel"
        aria-labelledby={`${panelId}-tab-${selected}`}
      >
        <TrackerBody result={result} loading={loading} selected={selected} />
      </div>

      <p className="online-tracker__note">{t('tracker.note')}</p>
    </section>
  );
}

function TrackerBody({ result, loading, selected }: Props & { selected: Selection }) {
  const { t } = useI18n();

  if (loading && !result) return <p className="stats-msg">{t('net.connecting')}…</p>;
  if (!result) return null;
  if (result.state === 'unauthenticated') {
    return (
      <div className="stats-msg stats-msg--soft">
        <p>{t('stats.signInPrompt')}</p>
        <p className="setup-hint">{t('stats.signInHint')}</p>
      </div>
    );
  }
  if (result.state === 'unavailable') return <p className="stats-msg">{t('stats.unavailable')}</p>;
  if (result.state === 'error') return <p className="stats-msg">{t('stats.error')}</p>;

  const split: OnlineCategorySplit = selected === 'overall'
    ? result.data.overall
    : result.data.byGame[selected];

  return (
    <div className="online-tracker__cards">
      <TrackerCard title={t('tracker.humanOnly')} counters={split.human_only} />
      <TrackerCard title={t('tracker.withBots')} counters={split.with_bots} />
    </div>
  );
}

/** One frozen-category card. Always rendered, even when everything is zero. */
function TrackerCard({ title, counters }: { title: string; counters: OnlineCounters }) {
  const { t } = useI18n();
  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: 'matches', label: t('tracker.matches'), value: String(counters.matches) },
    // "—" (not NaN / Infinity) when nothing has been played.
    { key: 'winRate', label: t('tracker.winRate'), value: counters.winRate == null ? '—' : `${counters.winRate}%` },
    { key: 'wins', label: t('tracker.wins'), value: String(counters.wins) },
    { key: 'losses', label: t('tracker.losses'), value: String(counters.losses) },
    { key: 'draws', label: t('tracker.draws'), value: String(counters.draws) },
    { key: 'forfeits', label: t('tracker.forfeits'), value: String(counters.forfeits) },
  ];
  return (
    <div className="tracker-card">
      <h5 className="tracker-card__title">{title}</h5>
      <dl className="tracker-card__grid">
        {rows.map((r) => (
          <div className="tracker-stat" key={r.key}>
            <dt className="tracker-stat__label">{r.label}</dt>
            <dd className="tracker-stat__value">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
