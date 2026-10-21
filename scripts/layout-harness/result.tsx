// ---------------------------------------------------------------------------
// MATCH RESULT harness (Stage 42.1). Dev-only — never bundled.
// Mounts the shared MatchResult end screen in each of its layouts.
//
// Query params: mode=podium|podium4|six|durak|durak2|teams|draw
//               outcome=win|loss|draw|fool   theme=midnight|classic
//               lang=en|uk|de|ar   dir=ltr|rtl
// ---------------------------------------------------------------------------

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/App.css';
import { LangProvider } from '../../src/i18n';
import MatchResult from '../../src/ui/components/MatchResult';
import type { ResultOutcome, ResultSeat, ResultTeam } from '../../src/ui/components/matchResultModel';
import type { GameType } from '../../src/games/catalog';

const qs = new URLSearchParams(location.search);
const mode = qs.get('mode') ?? 'podium';
const dir = qs.get('dir') === 'rtl' ? 'rtl' : 'ltr';
const lang = qs.get('lang') ?? (dir === 'rtl' ? 'ar' : 'uk');
document.documentElement.dir = dir;
document.documentElement.lang = lang;
document.documentElement.dataset.appTheme = qs.get('theme') === 'classic' ? 'classic' : 'midnight';
try { localStorage.setItem('king.lang.v1', lang); } catch { /* ignore */ }

const S = (key: string, name: string, avatar: string, place: number, value?: string, extra: Partial<ResultSeat> = {}): ResultSeat =>
  ({ key, name, avatar, place, value, ...extra });

const SCENES: Record<string, { game: GameType; outcome: ResultOutcome; title: string; subtitle?: string; seats?: ResultSeat[]; teams?: ResultTeam[] }> = {
  podium: { game: 'king', outcome: 'win', title: 'Олександра перемагає!', subtitle: 'Гру завершено',
    seats: [S('a', 'Олександра', '🦊', 1, '214', { isMe: true }), S('b', 'A-really-long-player-name', '🐼', 2, '96'), S('c', 'Kai', '🤖', 3, '-40')] },
  podium4: { game: 'preferans', outcome: 'loss', title: 'Ви програли', subtitle: 'Переміг Kai',
    seats: [S('a', 'Kai', '🤖', 1, '10'), S('b', 'Dina', '🐸', 2, '7', { isMe: true }), S('c', 'Max', '🦁', 3, '4'), S('d', 'Ola', '🐧', 4, '-3')] },
  six: { game: 'poker', outcome: 'win', title: 'Ти виграв!',
    seats: [S('a', 'Ти', '🦊', 1, '🪙 6000', { isMe: true }), ...['Kai', 'Dina', 'Max', 'Ola', 'Bo'].map((n, i) =>
      S(n, n, '🤖', 2, '🪙 0', { note: 'Без фішок', tone: 'lose' }))] },
  durak: { game: 'durak', outcome: 'win', title: 'Ви виграли!', subtitle: 'Дурень: Kai',
    seats: [S('a', 'Ви', '🦊', 1, undefined, { isMe: true }), S('b', 'Dina', '🐸', 1), S('c', 'Max', '🦁', 1), S('d', 'Kai', '🤖', 4, '🂠 3', { note: 'Дурень', tone: 'lose' })] },
  durak2: { game: 'durak', outcome: 'fool', title: 'Ви — дурень', subtitle: 'Дурень: Ви',
    seats: [S('a', 'Kai', '🤖', 1), S('b', 'Ви', '🦊', 2, '🂠 5', { isMe: true, note: 'Дурень', tone: 'lose' })] },
  teams: { game: 'tarneeb', outcome: 'win', title: 'Ви виграли!', teams: [
    { key: 'A', label: 'Ви & Dina', members: [{ name: 'Ви', avatar: '🦊', isMe: true }, { name: 'Dina', avatar: '🐸' }], value: '43', won: true },
    { key: 'B', label: 'Kai & Max', members: [{ name: 'Kai', avatar: '🤖' }, { name: 'Max', avatar: '🦁' }], value: '28', won: false },
  ] },
  draw: { game: 'king', outcome: 'draw', title: 'Нічия: Dina & Max', subtitle: 'Гру завершено',
    seats: [S('a', 'Dina', '🐸', 1, '120'), S('b', 'Max', '🦁', 1, '120'), S('c', 'Kai', '🤖', 3, '-80')] },
};
const scene = SCENES[mode] ?? SCENES.podium;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <MatchResult {...scene} outcome={(qs.get('outcome') as ResultOutcome) ?? scene.outcome}
        actions={<><button className="btn btn--primary" type="button">Зіграти ще</button><button className="btn btn--ghost" type="button">До меню</button></>} />
    </LangProvider>
  </StrictMode>,
);
