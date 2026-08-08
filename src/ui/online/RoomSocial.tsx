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
  /** True when the current game mirrors seats left↔right on screen (Tarneeb) — flips the
   *  reaction anchor so it lands over the sender's actual visible seat (Stage 29.5). */
  reactionsMirrored?: boolean;
  /** Optional per-turn timer node (Stage 29.7) — rendered inside this control cluster
   *  (next to voice/emoji/chat) instead of over the table. Null/undefined = timer off. */
  timerSlot?: ReactNode;
  /** Optional GENERIC utility control (Stage 37.7 §16 I) — a game-agnostic ReactNode
   *  rendered in the corner button row next to chat/emoji/voice (e.g. a Poker action-log
   *  toggle). No game dependency lives in RoomSocial; the caller supplies the node. */
  utilitySlot?: ReactNode;
  /** The PANEL belonging to `utilitySlot`, rendered with the other panels (Stage 38.0.3)
   *  so a docked cluster keeps it in normal flow instead of over the game's controls.
   *  Still game-agnostic: RoomSocial renders whatever node it is handed. */
  utilityPanelSlot?: ReactNode;
  /**
   * Optional DESTRUCTIVE room action (Stage 38.0.5) — a game-agnostic ReactNode rendered
   * at the END of the control button row, in BOTH layout variants. The permanent
   * "Leave game" control lives here so it inherits the cluster's proven safe position
   * (never over the table, the hand, the melds or a game's action bar) and its 44px
   * touch-target sizing. RoomSocial knows nothing about what the node does.
   */
  dangerSlot?: ReactNode;
  /**
   * Where the control cluster lives (Stage 38.0.3).
   *  - `floating` (default) — the historical fixed bottom-corner cluster;
   *  - `docked` — the cluster and any open panel render IN NORMAL FLOW wherever the
   *    caller placed this component, so they occupy layout space instead of covering
   *    it. A game whose action controls sit at the bottom of the screen (Poker) must
   *    use this: a fixed cluster provably lands on top of those controls on a phone.
   *  - `sheet` (Stage 38.0.5.1) — ONE compact launcher (with the unread badge) rendered
   *    wherever the caller placed it, plus a MODAL bottom sheet holding chat, reactions,
   *    voice, the utility slot and the destructive action. Collapsed, it costs a single
   *    44×44 target and no toolbar row at all; open, it deliberately covers the page as a
   *    dialog with a backdrop, a close button, a max-height and its own vertical scroll.
   * RoomSocial stays game-agnostic — this is a layout mode, not a game switch.
   */
  variant?: 'floating' | 'docked' | 'sheet';
  /**
   * Optional CONTROLLED panel selection. Chat, the reaction picker and a caller-owned
   * `utilitySlot` panel are mutually exclusive: two of them open at once would stack
   * on the same corner. Pass `openPanel` + `onPanelChange` to lift that choice into the
   * caller (which also owns the utility panel); omit both to keep the local behaviour.
   */
  openPanel?: SocialPanel;
  onPanelChange?: (panel: SocialPanel) => void;
}

/** The mutually-exclusive social surfaces. `utility` belongs to the caller's slot. */
export type SocialPanel = 'none' | 'reactions' | 'chat' | 'utility';

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
export default function RoomSocial({ reactions, chat, myClientId, onReact, onChat, onChatMedia, notice, onClearNotice, handVisible = false, onLeaveGame, voiceButton, mySeatIndex = null, seatCount = 0, reactionsMirrored = false, timerSlot = null, utilitySlot = null, utilityPanelSlot = null, dangerSlot = null, variant = 'floating', openPanel, onPanelChange }: Props) {
  const { t } = useI18n();
  // Panel selection is CONTROLLED when the caller passes `openPanel` (so a caller-owned
  // utility panel is mutually exclusive with chat/reactions), else local.
  const [ownPanel, setOwnPanel] = useState<SocialPanel>('none');
  const panel = openPanel ?? ownPanel;
  const setPanel = (next: SocialPanel) => {
    if (onPanelChange) onPanelChange(next); else setOwnPanel(next);
  };
  const reactOpen = panel === 'reactions';
  const chatOpen = panel === 'chat';
  const setReactOpen = (open: boolean) => setPanel(open ? 'reactions' : 'none');
  const setChatOpen = (open: boolean) => setPanel(open ? 'chat' : 'none');
  const docked = variant === 'docked';
  const sheet = variant === 'sheet';
  const sheetOpen = sheet && panel !== 'none';
  // (38.0.12) In the sheet, emoji and stickers live INSIDE the chat behind the composer's
  // own picker button — so a player keeps typing and sending while it is open. The only
  // launchers are chat and (when the caller supplies one) the utility slot.
  const chatLauncherRef = useRef<HTMLButtonElement>(null);
  const utilityLauncherRef = useRef<HTMLButtonElement>(null);
  const launcherFor = (p: SocialPanel) => (p === 'utility' ? utilityLauncherRef : chatLauncherRef);
  /** Close the sheet and hand focus back to the launcher that opened it. */
  const closeSheet = () => { const opener = launcherFor(panel).current; setPanel('none'); opener?.focus(); };
  const [mediaOpen, setMediaOpen] = useState(false);
  const [lightbox, setLightbox] = useState<ChatMedia | null>(null);
  const [text, setText] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState(0);
  const [floats, setFloats] = useState<FloatSticker[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
    if (!chatOpen) return;
    setSeen(chat.length);
    // Scroll whichever element actually scrolls: the drawer's own list in the
    // floating/docked clusters, or the sheet body — which since 38.0.12 is the sheet's
    // ONE scroller, so the list no longer has a scrollbar of its own.
    const list = listRef.current;
    if (!list) return;
    const scroller = list.closest('.social-sheet__body') ?? list;
    scroller.scrollTo({ top: scroller.scrollHeight });
  }, [chatOpen, chat.length]);

  // Opening the picker shortens the conversation above it — keep the newest message in
  // view instead of leaving the reader mid-history.
  useEffect(() => {
    if (!mediaOpen) return;
    const scroller = listRef.current?.closest('.social-sheet__body');
    scroller?.scrollTo({ top: scroller.scrollHeight });
  }, [mediaOpen]);

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

  // Escape closes the lightbox first, then whichever picker is open, then the whole
  // modal sheet (which also returns focus to its launcher).
  useEffect(() => {
    if (!lightbox && !mediaOpen && !reactOpen && !sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightbox) { setLightbox(null); return; }
      if (mediaOpen) { setMediaOpen(false); return; }
      if (sheetOpen) { closeSheet(); return; }
      setReactOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox, mediaOpen, reactOpen, sheetOpen]);

  const unread = chatOpen ? 0 : Math.max(0, chat.length - seen);
  const activeReactions = reactions.filter((r) => now - r.at < REACTION_TTL_MS);
  const activeFloats = floats.filter((f) => now - f.at < REACTION_TTL_MS);

  /**
   * (38.0.9 owner FAIL) Sending a reaction must NOT close the surface it was sent from.
   * In the `sheet` variant the picker is a deliberate, modal workspace: the player wants to
   * fire several reactions in a row, and closing after one wiped the panel, the tab and the
   * scroll position. The historical `floating`/`docked` clusters keep their old
   * close-after-send behaviour — Poker uses `docked` and must not change.
   */
  function react(emoji: string) {
    onReact(emoji);
    if (!sheet) setReactOpen(false);
  }
  /**
   * A media send closes the drawer's sticker grid; in the SHEET the picker stays open,
   * so several stickers can be fired without re-opening it (38.0.12).
   */
  function sendMedia(item: ChatMediaItem) {
    onChatMedia(item.id);
    if (!sheet) { setMediaOpen(false); setReactOpen(false); }
  }
  /**
   * (38.0.12) In the chat the emoji are TEXT: a tap types the emoji into the message
   * being composed instead of firing a table reaction, so the player can write
   * "Привіт 👍" and keep the picker open. The floating/docked clusters still send a
   * reaction straight from their own emoji bar.
   */
  function insertEmoji(emoji: string) {
    setText((prev) => (prev + emoji).slice(0, MAX_CHAT_LEN));
    inputRef.current?.focus();
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

  /** The open section's own heading — the sheet holds exactly one section (38.0.12). */
  const sheetTitle = chatOpen ? `💬 ${t('chat.title')}` : `☰ ${t('social.menu')}`;

  // --- shared pieces, so every variant renders the SAME surfaces -------------
  const stickerGrid = CHAT_MEDIA.length > 0 ? (
    <div className="reaction-bar__stickers" role="listbox" aria-label={t('chat.mediaPicker')}>
      {CHAT_MEDIA.map((item) => (
        <button key={item.id} type="button" role="option" aria-selected={false}
          className="chat-media-thumb" onClick={() => sendMedia(item)}
          aria-label={`${t('chat.sendMedia')}: ${item.label}`} title={item.label}>
          <img src={item.src} alt={item.label} loading="lazy" decoding="async" />
        </button>
      ))}
    </div>
  ) : null;

  const emojiGrid = (
    <div className="reaction-bar__emojis">
      {REACTIONS.map((e) => (
        <button key={e} type="button" className="reaction-bar__btn" onClick={() => react(e)} aria-label={`react ${e}`}>
          {e}
        </button>
      ))}
    </div>
  );

  const chatList = (
    <div className="chat-drawer__list" ref={listRef}>
      {chat.length === 0
        ? <p className="chat-empty">{t('chat.empty')}</p>
        : chat.map((m) => (
          <ChatRow key={m.id} m={m} mine={!!myClientId && m.clientId === myClientId} onOpenMedia={setLightbox} />
        ))}
    </div>
  );

  const chatMediaPicker = mediaOpen ? (
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
  ) : null;

  const chatCompose = (
    <form className="chat-drawer__compose" onSubmit={(e) => { e.preventDefault(); submitChat(); }}>
      {/* (38.0.12) The sheet's chat gets an emoji button of its own, next to the sticker
          one — both open the SAME in-chat picker, which never hides the conversation. */}
      {sheet && (
        <button type="button" className="btn btn--ghost btn--small chat-media-btn chat-emoji-btn"
          aria-expanded={mediaOpen} aria-label={t('social.emoji')} title={t('social.emoji')}
          onClick={() => setMediaOpen((o) => !o)}>😀</button>
      )}
      <button type="button" className="btn btn--ghost btn--small chat-media-btn"
        aria-expanded={mediaOpen} aria-label={t('chat.openMedia')}
        onClick={() => setMediaOpen((o) => !o)}>🖼️</button>
      <input ref={inputRef} className="input chat-input" value={text} maxLength={MAX_CHAT_LEN}
        onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} aria-label={t('chat.message')} />
      <button type="submit" className="btn btn--primary btn--small" disabled={!text.trim()}>{t('chat.send')}</button>
    </form>
  );

  /**
   * The in-chat picker (sheet variant): emoji that TYPE into the message on top, the
   * sticker catalog below. It is a sibling of the conversation, never a layer over it,
   * and it is the only scroller of its own region.
   */
  const chatPicker = mediaOpen ? (
    <div className="chat-picker" role="group" aria-label={t('chat.mediaPicker')}>
      <div className="reaction-bar__emojis">
        {REACTIONS.map((e) => (
          <button key={e} type="button" className="reaction-bar__btn"
            onClick={() => insertEmoji(e)} aria-label={`${t('social.emoji')} ${e}`}>
            {e}
          </button>
        ))}
      </div>
      {stickerGrid}
    </div>
  ) : null;

  return (
    <>
      {/* Floating reactions + stickers — anchored over the SENDER's seat (Stage 27.1), never over
          the hand/trick. Unknown seat (spectator / lobby / unseated) → centred, as before. */}
      <div className="reactions-float" aria-live="polite">
        {activeReactions.map((r) => (
          <div className={`reaction-anchor reaction-anchor--${reactionAnchorForSender(r.seatIndex, mySeatIndex, seatCount, reactionsMirrored)}`} key={r.key}>
            <span className="reaction-chip">
              <span className="reaction-chip__av" aria-hidden="true">{r.avatar}</span>
              <span className="reaction-chip__emoji">{r.emoji}</span>
              <span className="reaction-chip__name">{r.name}</span>
            </span>
          </div>
        ))}
        {activeFloats.map((f) => (
          <div className={`reaction-anchor reaction-anchor--${reactionAnchorForSender(f.seatIndex, mySeatIndex, seatCount, reactionsMirrored)}`} key={f.key}>
            <span className="reaction-chip reaction-chip--sticker">
              <span className="reaction-chip__av" aria-hidden="true">{f.avatar}</span>
              <img className="reaction-chip__sticker" src={f.media.src} alt={f.media.label} loading="lazy" decoding="async" />
              <span className="reaction-chip__name">{f.name}</span>
            </span>
          </div>
        ))}
      </div>

      {noticeText && <div className={`social-toast ${handVisible ? 'social-toast--raised' : ''}`} role="status">{noticeText}</div>}

      {/* `sheet` (Stage 38.0.5.1): ONE launcher + a modal bottom sheet. Collapsed there is
          no toolbar at all — the owner's complaint about the docked row was that it ate a
          whole band of the phone between the melds and the prompt. */}
      {sheet && (
        <div className="social-menu">
          <button
            ref={chatLauncherRef}
            type="button"
            className="social-fab social-menu__launcher"
            aria-haspopup="dialog"
            aria-expanded={chatOpen}
            aria-label={t('chat.title')}
            title={t('chat.title')}
            onClick={() => (chatOpen ? closeSheet() : setPanel('chat'))}
          >
            💬
            {unread > 0 && <span className="social-fab__badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
          {utilitySlot && (
            <button
              ref={utilityLauncherRef}
              type="button"
              className="social-fab social-menu__launcher"
              aria-haspopup="dialog"
              aria-expanded={panel === 'utility'}
              aria-label={t('social.menu')}
              title={t('social.menu')}
              onClick={() => (panel === 'utility' ? closeSheet() : setPanel('utility'))}
            >
              ☰
            </button>
          )}
          {sheetOpen && (
            <div className="social-sheet-backdrop" role="presentation" onClick={closeSheet}>
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
              <div className="social-sheet" role="dialog" aria-modal="true" aria-label={sheetTitle}
                onClick={(e) => e.stopPropagation()}>
                <div className="social-sheet__head">
                  {/* No tab strip (38.0.12): the sheet is the chat, and emoji/stickers are
                      a panel INSIDE it rather than a surface layered over it. */}
                  <h2 className="social-sheet__title">{sheetTitle}</h2>
                  <button type="button" className="social-sheet__close" onClick={closeSheet} aria-label={t('btn.back')}>✕</button>
                </div>
                {/* THE single scrolling region: no descendant of it scrolls on its own, so a
                    phone never shows two nested scrollbars (38.0.12 owner FAIL). */}
                <div className="social-sheet__body">
                  {chatOpen && chatList}
                  {panel === 'utility' && utilityPanelSlot}
                </div>
                {/* Composer and picker are pinned OUTSIDE the scroller, so the conversation
                    stays readable and the text field can never be pushed out of reach. */}
                {chatOpen && chatCompose}
                {chatOpen && chatPicker}
                <div className="social-sheet__foot">
                  {voiceButton}
                  {onLeaveGame && (
                    <button type="button" className="social-fab social-fab--leave" onClick={leaveGame}
                      aria-label={t('online.leaveGame')} title={t('online.leaveGame')}>🚪</button>
                  )}
                  {/* The destructive action keeps its OWN confirmation (the caller owns it). */}
                  {dangerSlot}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Controls. `floating` keeps the historical fixed bottom-corner cluster (column,
          panels above it). `docked` renders the SAME controls as a compact horizontal
          toolbar in NORMAL FLOW, with any open panel below it — so the cluster and its
          panels take layout space instead of covering the game's action controls
          (Stage 38.0.3 owner FAIL). */}
      {!sheet && (
      <div className={`social-controls ${docked ? 'social-controls--docked' : ''} ${handVisible && !docked ? 'social-controls--raised' : ''}`}>
        {/* Per-turn timer (Stage 29.7) sits at the TOP of the cluster — near voice/emoji/chat,
            clear of the hand/table. Null when the host left the timer off. */}
        {!docked && timerSlot}
        {!docked && onLeaveGame && (
          <button type="button" className="social-leave" onClick={leaveGame}>
            🚪 {t('online.leaveGame')}
          </button>
        )}
        {!docked && utilityPanelSlot}
        {!docked && reactOpen && (
          <div className="reaction-bar" role="menu" aria-label={t('social.reactions')}>
            <span className="reaction-bar__heading">{t('social.emoji')}</span>
            {emojiGrid}
            {CHAT_MEDIA.length > 0 && (
              <span className="reaction-bar__heading">{t('chat.mediaPicker')}</span>
            )}
            {stickerGrid}
          </div>
        )}
        <div className="social-controls__row">
          {docked && timerSlot}
          {utilitySlot}
          {voiceButton}
          <button type="button" className="social-fab"
            aria-expanded={reactOpen} aria-label={t('social.reactions')}
            onClick={() => setPanel(reactOpen ? 'none' : 'reactions')}>
            😀
          </button>
          <button type="button" className="social-fab"
            aria-expanded={chatOpen} aria-label={t('chat.title')}
            onClick={() => setPanel(chatOpen ? 'none' : 'chat')}>
            💬
            {unread > 0 && <span className="social-fab__badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
          {docked && onLeaveGame && (
            <button type="button" className="social-fab social-fab--leave" onClick={leaveGame}
              aria-label={t('online.leaveGame')} title={t('online.leaveGame')}>
              🚪
            </button>
          )}
          {/* (38.0.5) The destructive permanent-leave control — same row, both variants. */}
          {dangerSlot}
        </div>
        {/* Docked: the open panel is a normal-flow sibling UNDER the toolbar row. */}
        {docked && utilityPanelSlot}
        {docked && reactOpen && (
          <div className="reaction-bar reaction-bar--docked" role="menu" aria-label={t('social.reactions')}>
            {emojiGrid}
            {stickerGrid}
          </div>
        )}
      </div>
      )}

      {/* Chat: a fixed right-side drawer when floating; a normal-flow panel when docked
          (so it can never sit on the action controls). Collapsed by default either way.
          The `sheet` variant renders the same list/compose INSIDE its modal instead. */}
      {!sheet && chatOpen && (
        <div className={`chat-drawer ${docked ? 'chat-drawer--docked' : ''}`} role="dialog" aria-label={t('chat.title')}>
          <div className="chat-drawer__head">
            <span>💬 {t('chat.title')}</span>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setChatOpen(false)} aria-label={t('btn.back')}>✕</button>
          </div>
          {chatList}
          {/* Sticker picker: a grid of lazy-loaded thumbnails; a click sends by id. */}
          {chatMediaPicker}
          {chatCompose}
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
