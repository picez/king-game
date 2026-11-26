import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  FEEDBACK_ABOUT_MAX, FEEDBACK_KINDS, FEEDBACK_TEXT_MAX,
  type FeedbackKind, type InboxResponse, type MyFeedbackItem,
} from '../../net/admin';
import {
  fetchInbox, fetchMyFeedback, markInboxRead, sendFeedback, type SendFeedbackResult,
} from '../../net/feedbackApi';

interface Props {
  base: string;
  /** A session exists (guest or account) — the server needs one to attribute the item. */
  hasSession: boolean;
  initialTab?: Tab;
  onClose: () => void;
  /** The unread count changed (the menu badge follows it). */
  onUnread?: (n: number) => void;
}

type Tab = 'write' | 'mine' | 'inbox';

const KIND_ICON: Record<FeedbackKind, string> = { complaint: '⚠️', suggestion: '💡', bug: '🐞' };

/**
 * "Complaints & suggestions" (Stage 44.0): write to the admins, see your own items and
 * their replies, and read admin messages (the inbox). Text-only, no attachments.
 */
export default function FeedbackPane({ base, hasSession, initialTab = 'write', onClose, onUnread }: Props) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [kind, setKind] = useState<FeedbackKind>('suggestion');
  const [text, setText] = useState('');
  const [about, setAbout] = useState('');
  const [room, setRoom] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendFeedbackResult | null>(null);
  const [mine, setMine] = useState<MyFeedbackItem[] | null>(null);
  const [inbox, setInbox] = useState<InboxResponse | null>(null);

  useEffect(() => {
    if (!hasSession) return;
    if (tab === 'mine') void fetchMyFeedback(base).then(setMine);
    if (tab === 'inbox') {
      void fetchInbox(base).then((r) => {
        setInbox(r);
        if (r.unread > 0) void markInboxRead(base).then(() => onUnread?.(0));
      });
    }
  }, [tab, base, hasSession, onUnread]);

  async function submit() {
    if (sending || text.trim().length < 3) return;
    setSending(true);
    setResult(null);
    const r = await sendFeedback(base, {
      kind, text: text.trim(),
      ...(kind === 'complaint' && about.trim() ? { aboutPlayer: about.trim() } : {}),
      ...(room.trim() ? { roomCode: room.trim().toUpperCase() } : {}),
      context: {
        screen: 'menu', lang,
        ua: navigator.userAgent.slice(0, 200),
        size: `${window.innerWidth}x${window.innerHeight}`,
      },
    });
    setSending(false);
    setResult(r);
    if (r === 'ok') { setText(''); setAbout(''); setRoom(''); setMine(null); }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="sheet feedback-pane">
      <div className="sheet__head">
        <h2 className="sheet__title">💬 {t('feedback.title')}</h2>
        <button className="btn btn--ghost btn--small" onClick={onClose}>{t('btn.backToMenu')}</button>
      </div>

      {!hasSession ? (
        <p className="feedback-pane__note">{t('feedback.err.unavailable')}</p>
      ) : (
        <>
          <div className="segmented feedback-pane__tabs" role="tablist">
            {(['write', 'mine', 'inbox'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k}
                className={`segmented__tab ${tab === k ? 'segmented__tab--active' : ''}`}
                onClick={() => setTab(k)}>
                {t(`feedback.tab.${k}`)}
              </button>
            ))}
          </div>

          {tab === 'write' && (
            <div className="feedback-form">
              <p className="feedback-pane__note">{t('feedback.intro')}</p>
              <div className="segmented segmented--inline" role="group" aria-label={t('feedback.kindLabel')}>
                {FEEDBACK_KINDS.map((k) => (
                  <button key={k} type="button" aria-pressed={kind === k}
                    className={`segmented__tab ${kind === k ? 'segmented__tab--active' : ''}`}
                    onClick={() => setKind(k)}>
                    {KIND_ICON[k]} {t(`feedback.kind.${k}`)}
                  </button>
                ))}
              </div>
              <label className="field">
                <span className="field__label">{t('feedback.textLabel')}</span>
                <textarea className="input feedback-form__text" rows={5} maxLength={FEEDBACK_TEXT_MAX}
                  value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={t(`feedback.placeholder.${kind}`)} />
                <span className="feedback-form__count">{text.length}/{FEEDBACK_TEXT_MAX}</span>
              </label>
              {kind === 'complaint' && (
                <label className="field">
                  <span className="field__label">{t('feedback.aboutPlayer')}</span>
                  <input className="input" maxLength={FEEDBACK_ABOUT_MAX} value={about} onChange={(e) => setAbout(e.target.value)} />
                </label>
              )}
              <label className="field">
                <span className="field__label">{t('feedback.roomCode')}</span>
                <input className="input feedback-form__room" maxLength={8} value={room}
                  onChange={(e) => setRoom(e.target.value.replace(/[^a-z0-9]/gi, ''))} />
              </label>
              <button type="button" className="btn btn--primary" disabled={sending || text.trim().length < 3} onClick={submit}>
                {sending ? '…' : t('feedback.send')}
              </button>
              {result && (
                <p className={`feedback-form__result feedback-form__result--${result === 'ok' ? 'ok' : 'err'}`} role="status">
                  {result === 'ok' ? `✅ ${t('feedback.sent')}` : t(`feedback.err.${result}`)}
                </p>
              )}
            </div>
          )}

          {tab === 'mine' && (
            <ul className="feedback-list">
              {mine === null && <li className="feedback-pane__note">…</li>}
              {mine?.length === 0 && <li className="feedback-pane__note">{t('feedback.mineEmpty')}</li>}
              {mine?.map((f) => (
                <li key={f.id} className="feedback-item">
                  <div className="feedback-item__head">
                    <span>{KIND_ICON[f.kind]} {t(`feedback.kind.${f.kind}`)}</span>
                    <span className={`feedback-item__status feedback-item__status--${f.status}`}>{t(`feedback.status.${f.status}`)}</span>
                    <span className="feedback-item__date">{fmt(f.createdAt)}</span>
                  </div>
                  <p className="feedback-item__text">{f.text}</p>
                  {f.reply && (
                    <div className="feedback-item__reply">
                      <strong>{t('feedback.fromAdmin')}</strong> {f.reply}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {tab === 'inbox' && (
            <ul className="feedback-list">
              {inbox === null && <li className="feedback-pane__note">…</li>}
              {inbox?.items.length === 0 && <li className="feedback-pane__note">{t('feedback.inboxEmpty')}</li>}
              {inbox?.items.map((m) => (
                <li key={m.id} className={`feedback-item ${m.read ? '' : 'feedback-item--unread'}`}>
                  <div className="feedback-item__head">
                    <span>{m.kind === 'broadcast' ? `📣 ${m.title}` : `💬 ${t('feedback.replyTitle')}`}</span>
                    <span className="feedback-item__date">{fmt(m.createdAt)}</span>
                  </div>
                  {m.quote && <p className="feedback-item__quote">«{m.quote}»</p>}
                  <p className="feedback-item__text">{m.text}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
