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
   * Where the LAUNCHER and the caller's utility controls live (Stage 38.0.3).
   *
   * (Stage 38.0.13 — owner FAIL) This prop decides NOTHING about the chat any more. It
   * used to pick the chat's whole SHELL as well, which is how the seven games ended up
   * with visibly different chats from one component: measured at 75a3b6d, 390px wide,
   * Durak opened a fixed 320×844 right-hand drawer with no backdrop while Fifty-One
   * opened a 390×544 modal card with one, and Poker a 371×400 in-flow box. Now every
   * variant opens the SAME `chat-dialog`; only the button placement differs:
   *  - `floating` (default) — the historical fixed bottom-corner cluster;
   *  - `docked` — the cluster and any caller panel render IN NORMAL FLOW wherever the
   *    caller placed this component, so they occupy layout space instead of covering
   *    it. A game whose action controls sit at the bottom of the screen (Poker) must
   *    use this: a fixed cluster provably lands on top of those controls on a phone.
   *  - `sheet` (Stage 38.0.5.1) — TWO compact launchers (💬 with the unread badge, and
   *    ☰ for voice / the utility panel / the destructive action) rendered wherever the
   *    caller placed them, costing no toolbar row at all when nothing is open.
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

/**
 * The mutually-exclusive social surfaces. `utility` belongs to the caller's slot.
 * (Stage 38.0.12) There is no `reactions` surface any more: emoji live INSIDE the chat,
 * behind the composer's picker, in every game and every layout variant.
 */
export type SocialPanel = 'none' | 'chat' | 'utility';

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
 * Room-social overlay (Stage 7): the floating reaction/sticker display, the launcher
 * cluster and THE chat dialog. Collapsed it is non-blocking — it never covers the hand or
 * the current trick — and the chat is closed by default (mobile-safe).
 *
 * (Stage 38.0.13) `variant` positions the LAUNCHERS only. Pressing 💬 opens ONE canonical
 * dialog — the same element, the same CSS, the same geometry — in all seven games, and a
 * tap on an emoji inside it reads the message field's FOCUS to decide whether the emoji
 * joins the message or flies onto the table. There is no mode to switch.
 *
 * Reactions and chat are room-social UX only; they are NOT game state. No userId/token is
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
  const chatOpen = panel === 'chat';
  const docked = variant === 'docked';
  const sheet = variant === 'sheet';
  /** The sheet's ☰ MENU (voice / utility panel / destructive action). Chat is never here. */
  const hasMenu = !!(utilitySlot || utilityPanelSlot || voiceButton || onLeaveGame || dangerSlot);
  const menuOpen = sheet && hasMenu && panel === 'utility';
  // (38.0.12) EVERY variant offers exactly one outer control for chat (plus the caller's
  // utility slot). Emoji and stickers live INSIDE the chat, behind the composer's picker,
  // so the player keeps reading, typing and sending while it is open.
  const chatLauncherRef = useRef<HTMLButtonElement>(null);
  const utilityLauncherRef = useRef<HTMLButtonElement>(null);
  const launcherFor = (p: SocialPanel) => (p === 'utility' ? utilityLauncherRef : chatLauncherRef);
  /** Close the chat (or the utility panel) and hand focus back to its launcher. */
  const closeChat = () => {
    const opener = launcherFor(panel).current;
    focusedRef.current = false;              // the field is going away with the dialog
    setInputFocused(false);
    setPanel('none');
    opener?.focus();
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);
  /**
   * (38.0.13) The ONE thing that decides what an emoji tap does: is the message field
   * ACTIVE? Kept as state (the hint re-renders with it) and as a ref (a click handler
   * must read the live value, never a stale closure). Never `text.length` — a blurred
   * field with a half-typed draft still means "send it to the table".
   */
  const [inputFocused, setInputFocused] = useState(false);
  const focusedRef = useRef(false);
  const setFocused = (on: boolean) => { focusedRef.current = on; setInputFocused(on); };
  /**
   * Pressing a picker control must NOT move focus: that is what decides the emoji's
   * destination, so stealing it would silently flip the player's intent between the tap
   * starting and the click landing. Cancelling `mousedown` blocks the focus change on
   * desktop AND on touch (phones synthesise a mousedown from the tap) while the `click`
   * still fires — measured at 75a3b6d: opening the picker moved focus to the button.
   */
  const keepFocus = (e: { preventDefault: () => void }) => { e.preventDefault(); };
  /** Close ONLY the picker; the conversation — and the caret — stay exactly where they were. */
  const closePicker = () => {
    setPickerOpen(false);
    if (!focusedRef.current) pickerBtnRef.current?.focus();
  };
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

  // Mark chat seen while it is open; keep the conversation scrolled to the newest.
  // (38.0.12) The message list is the history's ONE scroller in every variant.
  useEffect(() => {
    if (!chatOpen) return;
    setSeen(chat.length);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chatOpen, chat.length]);

  // While the chat dialog is open the PAGE behind it does not scroll. Two reasons, and the
  // second is the one that makes the seven games measurably identical:
  //  1. it is a modal — scrolling the table under an open dialog is never what was meant;
  //  2. the dialog is centred on the initial containing block, which EXCLUDES a classic
  //     scrollbar. A game whose screen happens to be taller than the viewport therefore
  //     drew the same dialog 7px further left than one that fits (measured at 1366:
  //     Poker 420 vs Durak/51 427). Locking the scroll removes the scrollbar; the matching
  //     padding keeps the page from jumping sideways as it goes.
  useEffect(() => {
    if (!chatOpen || typeof document === 'undefined') return;
    const root = document.documentElement;
    const gap = window.innerWidth - root.clientWidth;
    const prevOverflow = root.style.overflow;
    const prevPad = root.style.paddingInlineEnd;
    root.style.overflow = 'hidden';
    if (gap > 0) root.style.paddingInlineEnd = `${gap}px`;
    return () => { root.style.overflow = prevOverflow; root.style.paddingInlineEnd = prevPad; };
  }, [chatOpen]);

  // Opening the picker shortens the conversation above it — keep the newest message in
  // view instead of leaving the reader mid-history.
  useEffect(() => {
    if (!pickerOpen) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [pickerOpen]);

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

  // Escape peels one layer at a time: the lightbox, then the picker, then the chat —
  // the same order in every variant.
  useEffect(() => {
    if (!lightbox && !pickerOpen && panel === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightbox) { setLightbox(null); return; }
      if (pickerOpen) { closePicker(); return; }
      closeChat();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox, pickerOpen, panel]);

  const unread = chatOpen ? 0 : Math.max(0, chat.length - seen);
  const activeReactions = reactions.filter((r) => now - r.at < REACTION_TTL_MS);
  const activeFloats = floats.filter((f) => now - f.at < REACTION_TTL_MS);

  /**
   * Field NOT active → the emoji goes to the TABLE: the EXISTING server reaction (Stage 7
   * protocol, no new transport). The server stamps the sender and every client anchors it
   * on that player's SEAT, so two players sharing a display name are still told apart.
   * It never touches the draft and never closes anything.
   */
  function react(emoji: string) {
    onReact(emoji);
  }
  /**
   * A sticker/GIF is ALWAYS chat media, focused or not (38.0.13) — it is a message, not a
   * character, so there is nothing to insert. Sent once; the chat and the picker stay open.
   */
  function sendMedia(item: ChatMediaItem) {
    onChatMedia(item.id);
  }
  /**
   * Field ACTIVE → the emoji is TEXT: it lands AT THE CARET, so it can be dropped in the
   * middle of a half-typed line without wiping it, and the caret follows it.
   */
  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, MAX_CHAT_LEN);
    setText(next);
    const caret = Math.min(start + emoji.length, next.length);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
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

  /** The ☰ menu's heading — the sheet variant's non-chat surface (voice / utility / quit). */
  const menuTitle = `☰ ${t('social.menu')}`;
  /** What the next emoji tap will do, in words. Non-interactive: never a mode to pick. */
  const emojiAction = inputFocused ? t('chat.emojiHintMessage') : t('chat.emojiHintTable');

  // --- shared pieces, so every variant renders the SAME surfaces -------------
  const stickerGrid = CHAT_MEDIA.length > 0 ? (
    <div className="reaction-bar__stickers" role="listbox" aria-label={t('chat.mediaPicker')}>
      {CHAT_MEDIA.map((item) => (
        <button key={item.id} type="button" role="option" aria-selected={false}
          className="chat-media-thumb" onMouseDown={keepFocus} onClick={() => sendMedia(item)}
          aria-label={`${t('chat.sendMedia')}: ${item.label}`} title={item.label}>
          <img src={item.src} alt={item.label} loading="lazy" decoding="async" />
        </button>
      ))}
    </div>
  ) : null;

  const chatList = (
    <div className="chat-dialog__list" ref={listRef}>
      {chat.length === 0
        ? <p className="chat-empty">{t('chat.empty')}</p>
        : chat.map((m) => (
          <ChatRow key={m.id} m={m} mine={!!myClientId && m.clientId === myClientId} onOpenMedia={setLightbox} />
        ))}
    </div>
  );

  const chatCompose = (
    <form className="chat-dialog__compose" onSubmit={(e) => { e.preventDefault(); submitChat(); }}>
      {/* ONE picker control, next to the field, in every variant — and it does not take
          focus, so whatever the player was doing before the tap still holds. */}
      <button ref={pickerBtnRef} type="button" className="btn btn--ghost btn--small chat-picker-btn"
        aria-expanded={pickerOpen} aria-label={t('chat.openMedia')} title={t('chat.openMedia')}
        onMouseDown={keepFocus}
        onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}>😀</button>
      <input ref={inputRef} className="input chat-input" value={text} maxLength={MAX_CHAT_LEN}
        onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} aria-label={t('chat.message')}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
      <button type="submit" className="btn btn--primary btn--small" disabled={!text.trim()}>{t('chat.send')}</button>
    </form>
  );

  /**
   * The in-chat picker: the emoji row and the sticker catalog. It is a BOUNDED SIBLING of
   * the conversation — never a replacement for it — and the single scroller of its region.
   *
   * (38.0.13) There is NO mode switch. A tap on an emoji reads the ONE state the player
   * already controls with their thumb: is the message field active? Typing → the emoji
   * joins the message at the caret. Not typing → it flies onto the table over their seat.
   * The hint says which, and is deliberately inert.
   */
  const chatPicker = pickerOpen ? (
    <div className="chat-picker" role="group" aria-label={t('chat.mediaPicker')}>
      <p className="chat-picker__hint">{emojiAction}</p>
      <div className="reaction-bar__emojis">
        {REACTIONS.map((e) => (
          <button key={e} type="button" className="reaction-bar__btn"
            onMouseDown={keepFocus}
            onClick={() => (focusedRef.current ? insertEmoji(e) : react(e))}
            aria-label={`${emojiAction} ${e}`}>
            {e}
          </button>
        ))}
      </div>
      {stickerGrid}
    </div>
  ) : null;

  /**
   * THE chat (Stage 38.0.13). Declared ONCE and rendered by every layout variant, so all
   * seven games open the very same dialog: a backdrop, one card, a "Chat" header with ✕,
   * the bounded history, the composer and the bounded picker. `variant` decides where the
   * 💬 button sits — never what opens when it is pressed.
   */
  const chatDialog = chatOpen ? (
    <div className="chat-dialog-backdrop" role="presentation" onClick={closeChat}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div className="chat-dialog" role="dialog" aria-modal="true" aria-label={t('chat.title')}
        onClick={(e) => e.stopPropagation()}>
        <div className="chat-dialog__head">
          <h2 className="chat-dialog__title">💬 {t('chat.title')}</h2>
          <button type="button" className="chat-dialog__close" onClick={closeChat} aria-label={t('btn.back')}>✕</button>
        </div>
        {chatList}
        {chatCompose}
        {chatPicker}
      </div>
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

      {/* `sheet` (Stage 38.0.5.1): compact launchers instead of a toolbar. Collapsed there
          is no row at all — the owner's complaint about the docked row was that it ate a
          whole band of the phone between the melds and the prompt.
          (38.0.13) The 💬 launcher opens the SHARED `chatDialog` below, exactly like the
          other two variants; the ☰ sheet keeps only what is NOT chat — voice, the caller's
          utility panel and the destructive action. */}
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
            onClick={() => (chatOpen ? closeChat() : setPanel('chat'))}
          >
            💬
            {unread > 0 && <span className="social-fab__badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
          {hasMenu && (
            <button
              ref={utilityLauncherRef}
              type="button"
              className="social-fab social-menu__launcher"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-label={t('social.menu')}
              title={t('social.menu')}
              onClick={() => (menuOpen ? closeChat() : setPanel('utility'))}
            >
              ☰
            </button>
          )}
          {menuOpen && (
            <div className="social-sheet-backdrop" role="presentation" onClick={closeChat}>
              {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
              <div className="social-sheet" role="dialog" aria-modal="true" aria-label={menuTitle}
                onClick={(e) => e.stopPropagation()}>
                <div className="social-sheet__head">
                  <h2 className="social-sheet__title">{menuTitle}</h2>
                  <button type="button" className="social-sheet__close" onClick={closeChat} aria-label={t('btn.back')}>✕</button>
                </div>
                {utilityPanelSlot && <div className="social-sheet__body">{utilityPanelSlot}</div>}
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
        <div className="social-controls__row">
          {docked && timerSlot}
          {utilitySlot}
          {voiceButton}
          {/* (38.0.12) ONE social control: chat. Emoji are inside it, in every game. */}
          <button ref={chatLauncherRef} type="button" className="social-fab"
            aria-expanded={chatOpen} aria-label={t('chat.title')}
            onClick={() => (chatOpen ? closeChat() : setPanel('chat'))}>
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
      </div>
      )}

      {/* THE chat — the same dialog for every variant and therefore for every game
          (Stage 38.0.13). It is declared once, above, and rendered here once. */}
      {chatDialog}

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
