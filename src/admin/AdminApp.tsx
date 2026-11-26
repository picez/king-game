import { useCallback, useEffect, useState } from 'react';
import './admin.css';
import { AdminApiError, api } from './adminApi';
import type { AdminBadge } from '../net/admin';
import Overview from './Overview';
import Live from './Live';
import Users from './Users';
import UserCard from './UserCard';
import Appeals from './Appeals';
import { AnnouncementTab, BroadcastTab } from './Messages';
import Log from './Log';
import Backup from './Backup';

/** The admin tabs, in nav order (mirrors the quiz admin, adapted to card games). */
export const ADMIN_TABS = [
  { id: 'overview', label: '📊 Огляд' },
  { id: 'live', label: '🟢 Наживо' },
  { id: 'users', label: '👥 Гравці' },
  { id: 'appeals', label: '📮 Звернення' },
  { id: 'announcement', label: '📣 Оголошення' },
  { id: 'broadcast', label: '✉️ Розсилка' },
  { id: 'log', label: '📜 Журнал' },
  { id: 'backup', label: '💾 Резервна копія' },
] as const;
export type AdminTab = (typeof ADMIN_TABS)[number]['id'];

/** `#/users/<id>` → { tab: 'users', arg: '<id>' }. Unknown → overview. */
export function parseAdminHash(hash: string): { tab: AdminTab; arg: string | null } {
  const [tab, arg] = hash.replace(/^#\/?/, '').split('/');
  const known = ADMIN_TABS.some((t) => t.id === tab);
  return { tab: known ? (tab as AdminTab) : 'overview', arg: known && arg ? decodeURIComponent(arg) : null };
}

export function go(tab: AdminTab, arg?: string): void {
  window.location.hash = `#/${tab}${arg ? `/${encodeURIComponent(arg)}` : ''}`;
}

export default function AdminApp() {
  const [route, setRoute] = useState(() => parseAdminHash(window.location.hash));
  const [me, setMe] = useState<{ label: string } | 'denied' | 'error' | null>(null);
  const [badge, setBadge] = useState<AdminBadge | null>(null);

  useEffect(() => {
    const on = () => setRoute(parseAdminHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    document.title = 'Адмінка · Card Majlis';
    api<{ label: string }>('/me').then(setMe).catch((e) => setMe(e instanceof AdminApiError && (e.status === 404 || e.status === 401) ? 'denied' : 'error'));
  }, []);

  const refreshBadge = useCallback(() => { void api<AdminBadge>('/badge').then(setBadge).catch(() => {}); }, []);
  useEffect(() => {
    if (!me || typeof me === 'string') return;
    refreshBadge();
    window.addEventListener('admin-badge', refreshBadge);
    return () => window.removeEventListener('admin-badge', refreshBadge);
  }, [me, route.tab, refreshBadge]);

  if (me === null) return <div className="adm adm--center"><p className="adm-muted">Завантаження…</p></div>;
  if (me === 'denied' || me === 'error') {
    return (
      <div className="adm adm--center">
        <div className="adm-card adm-denied">
          <h1>🛡️ Адмінка</h1>
          <p>{me === 'denied'
            ? 'Немає доступу. Увійдіть через Google акаунтом, чия пошта є в ADMIN_EMAILS на сервері.'
            : 'Сервер недоступний або база даних не налаштована.'}</p>
          <a className="adm-btn adm-btn--primary" href="/">← До гри</a>
        </div>
      </div>
    );
  }

  return (
    <div className="adm">
      <header className="adm-head">
        <a className="adm-head__brand" href="/" title="До гри">🃏 Card Majlis · Адмінка</a>
        <span className="adm-head__me">{me.label}</span>
      </header>
      <nav className="adm-nav" aria-label="Розділи адмінки">
        {ADMIN_TABS.map((t) => (
          <a key={t.id} href={`#/${t.id}`} className={`adm-nav__tab${route.tab === t.id ? ' adm-nav__tab--on' : ''}`}
            aria-current={route.tab === t.id ? 'page' : undefined}>
            {t.label}
            {t.id === 'appeals' && badge && badge.total > 0 && <span className="adm-badge">{badge.total}</span>}
          </a>
        ))}
      </nav>
      <main className="adm-main">
        {route.tab === 'overview' && <Overview />}
        {route.tab === 'live' && <Live />}
        {route.tab === 'users' && (route.arg ? <UserCard id={route.arg} /> : <Users />)}
        {route.tab === 'appeals' && <Appeals sub={route.arg} badge={badge} />}
        {route.tab === 'announcement' && <AnnouncementTab />}
        {route.tab === 'broadcast' && <BroadcastTab />}
        {route.tab === 'log' && <Log target={route.arg} />}
        {route.tab === 'backup' && <Backup />}
      </main>
    </div>
  );
}
