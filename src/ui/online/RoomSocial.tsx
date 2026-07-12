import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { REACTIONS, MAX_CHAT_LEN } from '../../net/chatFilter';
import { CHAT_MEDIA, type ChatMediaItem } from '../../net/chatMediaCatalog';
import type { ChatMessage, ChatMedia } from '../../net/messages';
import type { ReactionEvent, SocialNotice } from '../../hooks/useNetworkGame';
import { reactionAnchorForSender } from './reactionAnchor';

interface Props {
  reactions: ReactionEvent[];
  chat: ChatMessage[];
  myClientId: string | null;
  onReact: (emoji: string) => void;
  onChat: (text: string) => void;
  /** Send a whitelisted sticker by catalog id (server validates + rate-limits). */
  onChatMedia: (mediaId: string) => void;
  notice: SocialNotice | null;
  onClearNotice: () => void;
  /** True while the player's hand is on screen (the `playing` GameScreen): lift
   *  the corner controls above the hand so they never cover the cards. */
  handVisible?: boolean;
  /** When set (ACTIVE game only — not the lobby), shows a "Leave game" action
   *  that returns to the menu while keeping the seat reconnectable (Resume). */
  onLeaveGame?: () => void;
  /** Optional compact voice control (Stage 25.4), rendered in the corner button row. */
  voiceButton?: ReactNode;
  /** The viewer's seat + the table size (Stage 27.1) — used to float a reaction over the
   *  sender's seat. Null/0 (spectator / lobby / unknown) → the reaction stays centred. */
  mySeatIndex?: number | null;
  seatCount?: number;
}

const REACTION_TTL_MS = 2600;

/** A transient sticker floated on the table when a media chat message arrives. */
interface FloatSticker {
  key: string;
  media: ChatMedia;
  name: string;
  avatar: string;
  /** Sender's seat (from the CHAT payload) so the sticker floats over their seat too. */
  seatIndex: number | null;
  at: number;
}

/**
 * Room-social overlay (Stage 7): a floating reaction display, a compact
 * reaction bar, and a collapsible chat drawer. Fixed-position and NON-blocking —
 * it sits in the bottom-right corner so it never covers the hand or the current
 * trick, and the chat drawer is collapsed by default (mobile-safe). Reactions
 * and chat are room-social UX only; they are NOT game state. No userId/token is
 * shown — only display name + emoji avatar.
 */
export default function RoomSocial({ reactions, chat, myClientId, onReact, onChat, onChatMedia, notice, onClearNotice, handVisible = false, onLeaveGame, voiceButton, mySeatIndex = null, seatCount = 0 }: Props) {
  const { t } = useI18n();
  const [reactOpen, setReactOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [lightbox, setLightbox] = useState<ChatMedia | null>(null);
  const [text, setText] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState(0);
  const [floats, setFloats] = useState<FloatSticker[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  // Chat media ids already accounted for (so joining history never floats, and a
  // message floats at most once). Seeded on the first chat effect.
  const seenMediaIds = useRef<Set<string>>(new Set());
  const floatsInit = useRef(false);

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

  // Float a freshly-arrived media message briefly on the table (like a reaction).
  // First run only SEEDS the seen-set (joining/reconnect history must not float);
  // then any new media message floats once, and only if it is recent (guards a
  // late CHAT_HISTORY replay). Pruned by TTL via the `now` tick below. This reuses
  // the existing CHAT media payload — no new protocol, no duplicate send.
  useEffect(() => {
    const seenIds = seenMediaIds.current;
    const fresh = chat.filter((m) => m.media && !seenIds.has(m.id));
    fresh.forEach((m) => seenIds.add(m.id));
    if (!floatsInit.current) { floatsInit.current = true; return; } // seed only
    const nowMs = Date.now();
    const add = fresh
      .filter((m) => nowMs - m.createdAt < REACTION_TTL_MS * 2)
      .map((m) => ({ key: m.id, media: m.media!, name: m.name, avatar: m.avatar, seatIndex: m.seatIndex, at: nowMs }));
    if (add.length) setFloats((f) => [...f, ...add].slice(-6));
  }, [chat]);

  // Escape closes the lightbox first, then whichever picker is open.
  useEffect(() => {
    if (!lightbox && !mediaOpen && !reactOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightbox) setLightbox(null);
      else { setMediaOpen(false); setReactOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, mediaOpen, reactOpen]);

  const unread = chatOpen ? 0 : Math.max(0, chat.length - seen);
  const activeReactions = reactions.filter((r) => now - r.at < REACTION_TTL_MS);
  const activeFloats = floats.filter((f) => now - f.at < REACTION_TTL_MS);

  function react(emoji: string) {
    onReact(emoji);
    setReactOpen(false);
  }
  // A media send closes any open picker (chat sticker grid OR the reaction picker).
  function sendMedia(item: ChatMediaItem) {
    onChatMedia(item.id);
    setMediaOpen(false);
    setReactOpen(false);
  }
  function leaveGame() {
    if (typeof window !== 'undefined' && !window.confirm(t('online.leaveGameConfirm'))) return;
    onLeaveGame?.();
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
      {/* Floating reactions + stickers — anchored over the SENDER's seat (Stage 27.1), never over
          the hand/trick. Unknown seat (spectator / lobby / unseated) → centred, as before. */}
      <div className="reactions-float" aria-live="polite">
        {activeReactions.map((r) => (
          <div className={`reaction-anchor reaction-anchor--${reactionAnchorForSender(r.seatIndex, mySeatIndex, seatCount)}`} key={r.key}>
            <span className="reaction-chip">
              <span className="reaction-chip__av" aria-hidden="true">{r.avatar}</span>
              <span className="reaction-chip__emoji">{r.emoji}</span>
              <span className="reaction-chip__name">{r.name}</span>
            </span>
          </div>
        ))}
        {activeFloats.map((f) => (
          <div className={`reaction-anchor reaction-anchor--${reactionAnchorForSender(f.seatIndex, mySeatIndex, seatCount)}`} key={f.key}>
            <span className="reaction-chip reaction-chip--sticker">
              <span className="reaction-chip__av" aria-hidden="true">{f.avatar}</span>
              <img className="reaction-chip__sticker" src={f.media.src} alt={f.media.label} loading="lazy" decoding="async" />
              <span className="reaction-chip__name">{f.name}</span>
            </span>
          </div>
        ))}
      </div>

      {noticeText && <div className={`social-toast ${handVisible ? 'social-toast--raised' : ''}`} role="status">{noticeText}</div>}

      {/* Bottom-right controls */}
      <div className={`social-controls ${handVisible ? 'social-controls--raised' : ''}`}>
        {onLeaveGame && (
          <button type="button" className="social-leave" onClick={leaveGame}>
            🚪 {t('online.leaveGame')}
          </button>
        )}
        {reactOpen && (
          <div className="reaction-bar" role="menu" aria-label={t('social.reactions')}>
            <span className="reaction-bar__heading">{t('social.emoji')}</span>
            <div className="reaction-bar__emojis">
              {REACTIONS.map((e) => (
                <button key={e} type="button" className="reaction-bar__btn" onClick={() => react(e)} aria-label={`react ${e}`}>
                  {e}
                </button>
              ))}
            </div>
            {CHAT_MEDIA.length > 0 && (
              <span className="reaction-bar__heading">{t('chat.mediaPicker')}</span>
            )}
            {CHAT_MEDIA.length > 0 && (
              <div className="reaction-bar__stickers" role="listbox" aria-label={t('chat.mediaPicker')}>
                {CHAT_MEDIA.map((item) => (
                  <button key={item.id} type="button" role="option" aria-selected={false}
                    className="chat-media-thumb" onClick={() => sendMedia(item)}
                    aria-label={`${t('chat.sendMedia')}: ${item.label}`} title={item.label}>
                    <img src={item.src} alt={item.label} loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="social-controls__row">
          {voiceButton}
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
              : chat.map((m) => (
                <ChatRow key={m.id} m={m} mine={!!myClientId && m.clientId === myClientId} onOpenMedia={setLightbox} />
              ))}
          </div>

          {/* Sticker picker: a grid of lazy-loaded thumbnails; a click sends by id. */}
          {mediaOpen && (
            <div className="chat-media-picker" role="listbox" aria-label={t('chat.mediaPicker')}>
              {CHAT_MEDIA.length === 0
                ? <p className="chat-empty">{t('chat.noMedia')}</p>
                : CHAT_MEDIA.map((item) => (
                  <button key={item.id} type="button" role="option" aria-selected={false}
                    className="chat-media-thumb" onClick={() => sendMedia(item)}
                    aria-label={`${t('chat.sendMedia')}: ${item.label}`} title={item.label}>
                    <img src={item.src} alt={item.label} loading="lazy" decoding="async" />
                  </button>
                ))}
            </div>
          )}

          <form className="chat-drawer__compose" onSubmit={(e) => { e.preventDefault(); submitChat(); }}>
            <button type="button" className="btn btn--ghost btn--small chat-media-btn"
              aria-expanded={mediaOpen} aria-label={t('chat.openMedia')}
              onClick={() => setMediaOpen((o) => !o)}>🖼️</button>
            <input className="input chat-input" value={text} maxLength={MAX_CHAT_LEN}
              onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} aria-label={t('chat.message')} />
            <button type="submit" className="btn btn--primary btn--small" disabled={!text.trim()}>{t('chat.send')}</button>
          </form>
        </div>
      )}

      {/* Lightbox: larger preview of a tapped sticker (click/Escape closes). */}
      {lightbox && (
        <div className="chat-lightbox" role="dialog" aria-modal="true" aria-label={lightbox.label}
          onClick={() => setLightbox(null)}>
          <img src={lightbox.src} alt={lightbox.label} className="chat-lightbox__img" />
        </div>
      )}
    </>
  );
}

function ChatRow({ m, mine, onOpenMedia }: { m: ChatMessage; mine: boolean; onOpenMedia: (media: ChatMedia) => void }) {
  return (
    <div className={`chat-msg ${mine ? 'chat-msg--mine' : ''}`}>
      <span className="chat-msg__av" aria-hidden="true">{m.avatar}</span>
      <span className="chat-msg__body">
        <span className="chat-msg__name">{m.name}</span>
        {m.media ? (
          <button type="button" className="chat-msg__media" onClick={() => onOpenMedia(m.media!)}
            aria-label={m.media.label}>
            <img src={m.media.src} alt={m.media.label} loading="lazy" decoding="async" />
          </button>
        ) : (
          <span className="chat-msg__text">{m.text}</span>
        )}
      </span>
    </div>
  );
}
