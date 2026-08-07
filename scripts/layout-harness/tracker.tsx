// ---------------------------------------------------------------------------
// ONLINE TRACKER layout-QA harness (Stage 38.0.6). Dev-only — never bundled (the app
// build has a single index.html entry and this lives under scripts/).
//
// It mounts the REAL `OnlineTrackerPanel` inside the REAL Profile → Statistics
// container markup (`.profile-screen` → `.drawer__panel`), directly above a stand-in
// for the detailed per-game stats panel, so `scripts/profile-tracker-qa.mjs` can measure
// actual bounding boxes: the chip strip, both category cards, every number, and the
// boundary with the panel below it.
//
// Query params: state=ok|empty|loading|unauth|unavailable|error
//               sel=overall|king|durak|deberc|tarneeb|preferans|fifty-one
//               dir=ltr|rtl   lang=en|uk|de|ar   big=1 (long numbers)
//               fontScale=<px>
// ---------------------------------------------------------------------------

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/App.css';
import { LangProvider } from '../../src/i18n';
import OnlineTrackerPanel from '../../src/ui/components/OnlineTrackerPanel';
import {
  buildOnlineTracker, emptyTracker, TRACKED_ONLINE_GAMES,
  type RawParticipationRow,
} from '../../src/net/onlineTracker';
import type { Loadable, OnlineTracker } from '../../src/net/statsApi';

const qs = new URLSearchParams(location.search);
const state = qs.get('state') ?? 'ok';
const dir = qs.get('dir') === 'rtl' ? 'rtl' : 'ltr';
const lang = qs.get('lang') ?? (dir === 'rtl' ? 'ar' : 'en');
const big = qs.get('big') === '1';
const fontScale = qs.get('fontScale');
const preselect = qs.get('sel');

document.documentElement.dir = dir;
document.documentElement.lang = lang;
if (fontScale) document.documentElement.style.fontSize = `${fontScale}px`;
try { localStorage.setItem('king.lang.v1', lang); } catch { /* ignore */ }

/** A realistic history across every tracked game and both categories. */
function rows(): RawParticipationRow[] {
  const scale = big ? 137 : 1;
  return TRACKED_ONLINE_GAMES.flatMap((gameType, i) => ([
    {
      gameType, category: 'human_only',
      wins: (i + 3) * scale, losses: (i + 2) * scale, draws: (i % 2) * scale, forfeits: (i % 3) * scale,
    },
    {
      gameType, category: 'with_bots',
      wins: (i + 1) * scale, losses: (6 - i) * scale, draws: 0, forfeits: 0,
    },
  ]));
}

function result(): Loadable<OnlineTracker> | null {
  switch (state) {
    case 'loading': return null;
    case 'empty': return { state: 'ok', data: emptyTracker() };
    case 'unauth': return { state: 'unauthenticated' };
    case 'unavailable': return { state: 'unavailable' };
    case 'error': return { state: 'error' };
    default: return { state: 'ok', data: buildOnlineTracker(rows()) };
  }
}

function Harness() {
  return (
    // The SAME containers Profile → Statistics renders the panel inside.
    <div className="profile-screen">
      <div className="profile-section-head">
        <button type="button" className="btn btn--ghost btn--small">← Sections</button>
        <h3 className="profile-section-head__title">My stats</h3>
        <button type="button" className="drawer__refresh" aria-label="Refresh">↻</button>
      </div>
      <div className="drawer__panel" role="tabpanel">
        <OnlineTrackerPanel result={result()} loading={state === 'loading'} />
        {/* A stand-in for the detailed per-game statistics that follow it. */}
        <div className="segmented segmented--sub" role="tablist" aria-label="Game">
          {['King', 'Durak', 'Deberc', 'Tarneeb', 'Preferans', '51', 'Poker'].map((g) => (
            <button key={g} role="tab" aria-selected={g === 'King'}
              className={`segmented__tab ${g === 'King' ? 'segmented__tab--active' : ''}`}>{g}</button>
          ))}
        </div>
        <div className="stats-panel" id="probe-detailed">
          <div className="stats-grid">
            {['Games', 'Win rate', 'Average', 'Best'].map((label) => (
              <div className="stat-card" key={label}>
                <span className="stat-card__value">42</span>
                <span className="stat-card__label">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <Harness />
    </LangProvider>
  </StrictMode>,
);

// The QA script clicks a chip when `sel` is given; announce readiness after paint.
requestAnimationFrame(() => requestAnimationFrame(() => {
  if (preselect) {
    const btn = document.getElementById(
      [...document.querySelectorAll('.online-tracker__chip')]
        .map((e) => e.id).find((id) => id.endsWith(`-tab-${preselect}`)) ?? '',
    );
    (btn as HTMLButtonElement | null)?.click();
  }
  (window as { __trackerReady?: boolean }).__trackerReady = true;
}));
