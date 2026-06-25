import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { REACTIONS, MAX_CHAT_LEN } from '../../net/chatFilter';
import type { ChatMessage } from '../../net/messages';
import type { ReactionEvent, SocialNotice } from '../../hooks/useNetworkGame';

interface Props {
  reactions: ReactionEvent[];
  chat: ChatMessage[];
  myClientId: string | null;
  onReact: (emoji: string) => void;
  onChat: (text: string) => void;
  notice: SocialNotice | null;
  onClearNotice: () => void;
}

const REACTION_TTL_MS = 2600;

/**
 * Room-social overlay (Stage 7): a floating reaction display, a compact
 * reaction bar, and a collapsible chat drawer. Fixed-position and NON-blocking —
 * it sits in the bottom-right corner so it never covers the hand or the current
 * trick, and the chat drawer is collapsed by default (mobile-safe). Reactions
 * and chat are room-social UX only; they are NOT game state. No userId/token is
 * shown — only display name + emoji avatar.
 */
export default function RoomSocial({ reactions, chat, myClientId, onReact, onChat, notice, onClearNotice }: Props) {
  const { t } = useI18n();
  const [reactOpen, setReactOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [text, setText] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Tick to prune expired floating reactions.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 600);
    return () => clearInterval(id);
  }, []);

  // Auto-dismiss the rate-limit / blocked toast.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(onClearNotice, 3000);
    return () => clearTimeout(id);
  }, [notice, onClearNotice]);

  // Mark chat seen while the drawer is open; keep it scrolled to the newest.
  useEffect(() => {
    if (chatOpen) {
      setSeen(chat.length);
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [chatOpen, chat.length]);

  const unread = chatOpen ? 0 : Math.max(0, chat.length - seen);
  const activeReactions = reactions.filter((r) => now - r.at < REACTION_TTL_MS);

  function react(emoji: string) {
    onReact(emoji);
    setReactOpen(false);
  }
  function submitChat() {
    const v = text.trim();
    if (!v) return;
    onChat(v);
    setText('');
  }

  const noticeText = notice
    ? (notice.code === 'RATE_LIMITED' ? t('chat.tooMany') : t('chat.blocked'))
    : null;

  return (
    <>
      {/* Floating reactions — top-centre, never over the hand/trick. */}
      <div className="reactions-float" aria-live="polite">
        {activeReactions.map((r) => (
          <span className="reaction-chip" key={r.key}>
            <span className="reaction-chip__av" aria-hidden="true">{r.avatar}</span>
            <span className="reaction-chip__emoji">{r.emoji}</span>
            <span className="reaction-chip__name">{r.name}</span>
          </span>
        ))}
      </div>

      {noticeText && <div className="social-toast" role="status">{noticeText}</div>}

      {/* Bottom-right controls */}
      <div className="social-controls">
        {reactOpen && (
          <div className="reaction-bar" role="menu" aria-label={t('social.reactions')}>
            {REACTIONS.map((e) => (
              <button key={e} type="button" className="reaction-bar__btn" onClick={() => react(e)} aria-label={`react ${e}`}>
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="social-controls__row">
          <button type="button" className="social-fab"
            aria-expanded={reactOpen} aria-label={t('social.reactions')}
            onClick={() => { setReactOpen((o) => !o); }}>
            😀
          </button>
          <button type="button" className="social-fab"
            aria-expanded={chatOpen} aria-label={t('chat.title')}
            onClick={() => { setChatOpen((o) => !o); setReactOpen(false); }}>
            💬
            {unread > 0 && <span className="social-fab__badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
        </div>
      </div>

      {/* Chat drawer (right side; collapsed by default) */}
      {chatOpen && (
        <div className="chat-drawer" role="dialog" aria-label={t('chat.title')}>
          <div className="chat-drawer__head">
            <span>💬 {t('chat.title')}</span>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setChatOpen(false)} aria-label={t('btn.back')}>✕</button>
          </div>
          <div className="chat-drawer__list" ref={listRef}>
            {chat.length === 0
              ? <p className="chat-empty">{t('chat.empty')}</p>
              : chat.map((m) => <ChatRow key={m.id} m={m} mine={!!myClientId && m.clientId === myClientId} />)}
          </div>
          <form className="chat-drawer__compose" onSubmit={(e) => { e.preventDefault(); submitChat(); }}>
            <input className="input chat-input" value={text} maxLength={MAX_CHAT_LEN}
              onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} aria-label={t('chat.message')} />
            <button type="submit" className="btn btn--primary btn--small" disabled={!text.trim()}>{t('chat.send')}</button>
          </form>
        </div>
      )}
    </>
  );
}

function ChatRow({ m, mine }: { m: ChatMessage; mine: boolean }) {
  return (
    <div className={`chat-msg ${mine ? 'chat-msg--mine' : ''}`}>
      <span className="chat-msg__av" aria-hidden="true">{m.avatar}</span>
      <span className="chat-msg__body">
        <span className="chat-msg__name">{m.name}</span>
        <span className="chat-msg__text">{m.text}</span>
      </span>
    </div>
  );
}
