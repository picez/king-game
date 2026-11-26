import { useState } from 'react';
import { api, fmtDate, GAME_LABEL, post } from './adminApi';
import { useAction, useAdminData } from './useAdminData';
import { go } from './AdminApp';
import { Pager } from './Users';
import { REPLY_TEXT_MAX, type AdminBadge, type AdminErrorRow, type AdminFeedbackRow } from '../net/admin';

const SUBS = [
  { id: 'complaints', label: '⚠️ Скарги', count: (b: AdminBadge) => b.complaints },
  { id: 'feedback', label: '💡 Побажання та помилки', count: (b: AdminBadge) => b.feedback },
  { id: 'errors', label: '🧯 Помилки сервера', count: (b: AdminBadge) => b.errors },
] as const;
type Sub = (typeof SUBS)[number]['id'];

const KIND: Record<string, string> = { complaint: '⚠️ Скарга', suggestion: '💡 Побажання', bug: '🐞 Помилка' };
const bumpBadge = () => window.dispatchEvent(new Event('admin-badge'));

export default function Appeals({ sub, badge }: { sub: string | null; badge: AdminBadge | null }) {
  const cur: Sub = SUBS.some((s) => s.id === sub) ? (sub as Sub) : 'complaints';
  return (
    <div className="adm-stack">
      <div className="adm-seg" role="tablist">
        {SUBS.map((s) => (
          <a key={s.id} role="tab" aria-selected={cur === s.id} href={`#/appeals/${s.id}`}
            className={`adm-seg__btn${cur === s.id ? ' adm-seg__btn--on' : ''}`}>
            {s.label}{badge && s.count(badge) > 0 && <span className="adm-badge">{s.count(badge)}</span>}
          </a>
        ))}
      </div>
      {cur === 'errors' ? <Errors /> : <FeedbackList kind={cur === 'complaints' ? 'complaint' : 'other'} />}
    </div>
  );
}

function FeedbackList({ kind }: { kind: 'complaint' | 'other' }) {
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [page, setPage] = useState(0);
  const list = useAdminData(
    () => api<{ rows: AdminFeedbackRow[]; total: number; pageSize: number }>(`/feedback?status=${status}&kind=${kind}&page=${page}`),
    [status, kind, page],
  );
  const d = list.data;
  return (
    <section className="adm-card">
      <div className="adm-row adm-row--between">
        <h2>{kind === 'complaint' ? 'Скарги на гравців' : 'Побажання та повідомлення про помилки'} {d ? `(${d.total})` : ''}</h2>
        <div className="adm-seg">
          {(['open', 'resolved'] as const).map((s) => (
            <button key={s} type="button" className={`adm-seg__btn${status === s ? ' adm-seg__btn--on' : ''}`}
              onClick={() => { setStatus(s); setPage(0); }}>{s === 'open' ? 'Відкриті' : 'Закриті'}</button>
          ))}
        </div>
      </div>
      {list.error && <p className="adm-err">{list.error}</p>}
      {d?.rows.length === 0 && <p className="adm-muted">{status === 'open' ? 'Нових звернень немає 🎉' : 'Порожньо.'}</p>}
      <ul className="adm-list">
        {d?.rows.map((f) => <FeedbackItem key={f.id} f={f} onChange={() => { void list.reload(); bumpBadge(); }} />)}
      </ul>
      {d && <Pager page={page} pages={Math.max(1, Math.ceil(d.total / d.pageSize))} onPage={setPage} />}
    </section>
  );
}

function FeedbackItem({ f, onChange }: { f: AdminFeedbackRow; onChange: () => void }) {
  const act = useAction();
  const [reply, setReply] = useState('');
  const [open, setOpen] = useState(false);
  const ctx = f.context as Record<string, string>;
  return (
    <li className="adm-appeal">
      <div className="adm-appeal__head">
        <strong>{KIND[f.kind]}</strong>
        <span className="adm-muted">{fmtDate(f.createdAt)}</span>
        <span>від {f.userId
          ? <a href="#" onClick={(e) => { e.preventDefault(); go('users', f.userId!); }}>{f.authorLabel ?? 'гравця'}</a>
          : (f.authorLabel ?? 'видаленого гравця')}{f.isGuest && <span className="adm-muted"> (гість)</span>}</span>
      </div>
      {(f.aboutPlayer || f.roomCode || f.gameType) && (
        <p className="adm-appeal__meta">
          {f.aboutPlayer && <>Про гравця: <strong>{f.aboutPlayer}</strong> · </>}
          {f.roomCode && <>Кімната <code>{f.roomCode}</code> · </>}
          {f.gameType && <>{GAME_LABEL[f.gameType] ?? f.gameType}</>}
        </p>
      )}
      <p className="adm-appeal__text">{f.text}</p>
      {(ctx.lang || ctx.size || ctx.ua) && (
        <p className="adm-muted adm-small">{[ctx.screen, ctx.lang, ctx.size, ctx.ua].filter(Boolean).join(' · ')}</p>
      )}
      {f.reply && <p className="adm-appeal__reply"><strong>Відповідь ({fmtDate(f.repliedAt)}):</strong> {f.reply}</p>}
      {act.msg && <p className={act.msg.ok ? 'adm-ok' : 'adm-err'}>{act.msg.text}</p>}
      <div className="adm-row">
        {f.status === 'open' ? (
          <button type="button" className="adm-btn" disabled={act.busy}
            onClick={() => void act.run(() => post(`/feedback/${f.id}/resolve`), 'Закрито.').then((ok) => ok && onChange())}>✓ Закрити</button>
        ) : (
          <button type="button" className="adm-btn" disabled={act.busy}
            onClick={() => void act.run(() => post(`/feedback/${f.id}/reopen`), 'Відкрито.').then((ok) => ok && onChange())}>↺ Відкрити знову</button>
        )}
        {!f.reply && f.userId && <button type="button" className="adm-btn" onClick={() => setOpen(!open)}>✉️ Відповісти</button>}
        {f.userId && <a className="adm-btn" href={`#/users/${f.userId}`}>Картка автора</a>}
      </div>
      {open && (
        <div className="adm-reply">
          <textarea className="adm-input" rows={3} maxLength={REPLY_TEXT_MAX} value={reply} onChange={(e) => setReply(e.target.value)}
            placeholder="Відповідь прийде гравцю у «Вхідні» і закриє звернення. Відповісти можна один раз." />
          <button type="button" className="adm-btn adm-btn--primary" disabled={act.busy || !reply.trim()}
            onClick={() => void act.run(() => post(`/feedback/${f.id}/reply`, { text: reply.trim() }), 'Відповідь надіслано.').then((ok) => ok && onChange())}>
            Надіслати відповідь
          </button>
        </div>
      )}
    </li>
  );
}

function Errors() {
  const [status, setStatus] = useState<'new' | 'resolved'>('new');
  const [page, setPage] = useState(0);
  const list = useAdminData(
    () => api<{ rows: AdminErrorRow[]; total: number; pageSize: number }>(`/errors?status=${status}&page=${page}`),
    [status, page],
  );
  const act = useAction();
  const d = list.data;
  return (
    <section className="adm-card">
      <div className="adm-row adm-row--between">
        <h2>Помилки сервера {d ? `(${d.total})` : ''}</h2>
        <div className="adm-seg">
          {(['new', 'resolved'] as const).map((s) => (
            <button key={s} type="button" className={`adm-seg__btn${status === s ? ' adm-seg__btn--on' : ''}`}
              onClick={() => { setStatus(s); setPage(0); }}>{s === 'new' ? 'Нові' : 'Закриті'}</button>
          ))}
        </div>
      </div>
      <p className="adm-muted">Однакові помилки групуються; персональні дані (пошта, ID, IP, токени) маскуються. Старші за 30 днів видаляються.</p>
      {list.error && <p className="adm-err">{list.error}</p>}
      {act.msg && <p className={act.msg.ok ? 'adm-ok' : 'adm-err'}>{act.msg.text}</p>}
      {d?.rows.length === 0 && <p className="adm-muted">Помилок немає 🎉</p>}
      <ul className="adm-list">
        {d?.rows.map((e) => (
          <li key={e.id} className="adm-appeal">
            <div className="adm-appeal__head">
              <code>{e.where}</code>
              <span className="adm-pill">×{e.count}</span>
              <span className="adm-muted">перша {fmtDate(e.firstAt)} · остання {fmtDate(e.lastAt)}</span>
            </div>
            <p className="adm-appeal__text adm-mono">{e.message}</p>
            {e.stack && <details><summary>Стек</summary><pre className="adm-pre">{e.stack}</pre></details>}
            {e.status === 'new' && (
              <button type="button" className="adm-btn" disabled={act.busy}
                onClick={() => void act.run(() => post(`/errors/${e.id}/resolve`), 'Закрито.').then((ok) => { if (ok) { void list.reload(); bumpBadge(); } })}>
                ✓ Виправлено
              </button>
            )}
          </li>
        ))}
      </ul>
      {d && <Pager page={page} pages={Math.max(1, Math.ceil(d.total / d.pageSize))} onPage={setPage} />}
    </section>
  );
}
