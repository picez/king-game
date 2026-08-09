// ---------------------------------------------------------------------------
// GENERIC RoomSocial layout-QA harness (Stage 38.0.12). Dev-only: never bundled.
//
// `poker-layout-qa` covers the docked cluster inside the poker table and
// `fiftyone-layout-qa` covers the sheet inside 51's screen — neither proves that the
// SEVEN games share one social contract. This harness mounts the REAL RoomSocial on
// its own, in every layout variant, so `scripts/social-layout-qa.mjs` can measure the
// chat/picker geometry and drive the real clicks (emoji → message, emoji → table,
// sticker) against recorded callbacks.
//
// Query params (all optional):
//   panel=none|chat|utility   chat=N
//   dir=ltr|rtl  lang=en|uk|de|ar   util=1 (poker-style utility slot + panel)
//   seat=N  seats=N  react=<seat>   (seed a table reaction from that seat)
// ---------------------------------------------------------------------------

import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/App.css';
import { LangProvider } from '../../src/i18n';
import RoomSocial, { type SocialPanel } from '../../src/ui/online/RoomSocial';
import type { ChatMessage } from '../../src/net/messages';
import type { ReactionEvent } from '../../src/hooks/useNetworkGame';

const qs = new URLSearchParams(location.search);
const startPanel = (qs.get('panel') ?? 'none') as SocialPanel;
const chatCount = Number(qs.get('chat') ?? 6);
const dir = qs.get('dir') === 'rtl' ? 'rtl' : 'ltr';
const lang = qs.get('lang') ?? (dir === 'rtl' ? 'ar' : 'en');
const withUtility = qs.get('util') === '1';
const mySeat = Number(qs.get('seat') ?? 0);
const seatCount = Number(qs.get('seats') ?? 4);
const reactFrom = qs.get('react');

document.documentElement.dir = dir;
document.documentElement.lang = lang;
try { localStorage.setItem('king.lang.v1', lang); } catch { /* ignore */ }

/** Two players deliberately share a display name: the anchor must use the SEAT. */
const NAMES = ['A-really-long-display-name', 'Kai', 'Kai', 'Aziz'];

function history(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    clientId: i % 3 === 0 ? 'me' : `peer-${i % 3}`,
    name: NAMES[i % NAMES.length],
    avatar: '🙂',
    text: i % 4 === 0
      ? 'A deliberately long chat line so the bubble has to wrap inside the panel.'
      : `message ${i}`,
    createdAt: 1_700_000_000_000 + i * 1000,
    seatIndex: i % seatCount,
  } as ChatMessage));
}

const seeded: ReactionEvent[] = reactFrom == null ? [] : [{
  key: 'seed-1', emoji: '👍', name: NAMES[Number(reactFrom) % NAMES.length], avatar: '🙂',
  seatIndex: Number(reactFrom), at: Date.now(),
} as ReactionEvent];

/** Every send the harness observes, so the gate can assert "exactly once". */
declare global {
  interface Window {
    __socialCalls?: { kind: string; value: string }[];
    __socialReady?: boolean;
  }
}
window.__socialCalls = [];
const record = (kind: string) => (value: string) => { window.__socialCalls!.push({ kind, value }); };

function Harness() {
  const [panel, setPanel] = useState<SocialPanel>(startPanel);
  const utility: { utilitySlot?: ReactNode; utilityPanelSlot?: ReactNode } = withUtility
    ? {
      utilitySlot: (
        <button type="button" className="social-fab probe-utility" aria-label="history">🧾</button>
      ),
      utilityPanelSlot: panel === 'utility'
        ? <div className="probe-utility-panel" style={{ padding: '0.6rem' }}>history panel</div>
        : null,
    }
    : {};

  const social = (
    <RoomSocial
      reactions={seeded}
      chat={history(chatCount)}
      myClientId="me"
      onReact={record('react')}
      onChat={record('chat')}
      onChatMedia={record('media')}
      notice={null}
      onClearNotice={() => {}}
      handVisible={false}
      onLeaveGame={() => {}}
      voiceButton={<button type="button" className="social-fab" aria-label="voice">🎙️</button>}
      mySeatIndex={mySeat}
      seatCount={seatCount}
      timerSlot={<span className="probe-timer">0:30</span>}
      openPanel={panel}
      onPanelChange={setPanel}
      {...utility}
    />
  );

  // A plausible page behind the cluster: the gate checks the panel never covers the
  // action row and that the page never scrolls sideways because of it.
  return (
    <div className="app" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="probe-table" style={{ flex: '1 1 auto', padding: '0.6rem' }}>
        <p className="probe-line">Table content</p>
      </div>
      <div className="probe-dock">{social}</div>
      <div className="probe-actions" style={{ display: 'flex', gap: '8px', padding: '0.6rem' }}>
        <button type="button" className="btn btn--primary">Action A</button>
        <button type="button" className="btn">Action B</button>
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

requestAnimationFrame(() => requestAnimationFrame(() => { window.__socialReady = true; }));
