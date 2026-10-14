import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n';
import { REACTIONS, MAX_CHAT_LEN } from '../../net/chatFilter';
import { TEXT_EMOJI } from '../../net/chatEmoji';
import { CHAT_MEDIA, type ChatMediaItem } from '../../net/chatMediaCatalog';
import type { ChatMessage, ChatMedia } from '../../net/messages';
import type { ReactionEvent, SocialNotice } from '../../hooks/useNetworkGame';
import { reactionAnchorForSender } from './reactionAnchor';

interface Props {
  reactions: ReactionEvent[];
  chat: ChatMessage[];
  myClientId: string | null;
  onReact: (emoji: string) => void;
  /** (38.0.16) `mediaId` attaches ONE whitelisted sticker to the SAME message. */
  onChat: (text: string, mediaId?: string) => void;
  /** Send a whitelisted sticker by catalog id (server validates + rate-limits). */
  onChatMedia: (mediaId: string) => void;
  notice: SocialNotice | null;
  onClearNotice: () => void;
  /** True while the player's hand is on screen — lifts the transient rate-limit toast
   *  (the only fixed element left here) clear of the cards. */
  handVisible?: boolean;
  /** When set (ACTIVE game only — not the lobby), shows a "Leave game" action
   *  that returns to the menu while keeping the seat reconnectable (Resume). */
  onLeaveGame?: () => void;
  /** Optional compact voice control (Stage 25.4), rendered in the control row. */
  voiceButton?: ReactNode;
  /** The viewer's seat + the table size (Stage 27.1) — used to float a reaction over the
   *  sender's seat. Null/0 (spectator / lobby / unknown) → the reaction stays centred. */
  mySeatIndex?: number | null;
  seatCount?: number;
  /** True when the current game mirrors seats left↔right on screen (Tarneeb) — flips the
   *  reaction anchor so it lands over the sender's actual visible seat (Stage 29.5). */
  reactionsMirrored?: boolean;
  /** Optional per-turn timer node (Stage 29.7) — rendered inside this control row
   *  (next to voice/chat) instead of over the table. Null/undefined = timer off. */
  timerSlot?: ReactNode;
  /** Optional GENERIC utility control (Stage 37.7 §16 I) — a game-agnostic ReactNode
   *  rendered in the control row next to chat/voice (e.g. a Poker action-log toggle).
   *  No game dependency lives in RoomSocial; the caller supplies the node. */
  utilitySlot?: ReactNode;
  /** The PANEL belonging to `utilitySlot`, rendered in normal flow under the row
   *  (Stage 38.0.3) instead of over the game's controls. Still game-agnostic. */
  utilityPanelSlot?: ReactNode;
  /**
   * Optional DESTRUCTIVE room action (Stage 38.0.5) — a game-agnostic ReactNode rendered
   * at the END of the control row. The permanent "Leave game" control lives here so it
   * inherits the row's proven safe position (never over the table, the hand, the melds or
   * a game's action bar) and its 44px touch-target sizing.
   */
  dangerSlot?: ReactNode;
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

/**
 * (38.0.16) The DOM id of the auxiliary social region — the ONE place a panel may take
 * layout space. `OnlineGame` renders it as a sibling of `.game-stage`, never inside it,
 * because every game screen is a `min-height: 100vh` flex column whose board grows with
 * `flex: 1 1 auto`: a panel mounted in THAT column is subtracted from the board. Measured
 * at 7105e1f, opening the chat cost the Durak felt 649.67px → 304px at 768 and
 * 705.67px → 315.28px at 1920, and pushed the hand down by ~330px.
 */
export const SOCIAL_REGION_ID = 'social-region';

/**
 * The picker's emoji tabs. Each does ONE thing, always, whatever the focus is doing:
 * `emoji` puts the emoji INTO THE MESSAGE at the caret, `table` floats a reaction over the
 * sender's seat. Stickers stay visible under both (a sticker is a message). (The older focus-derived destination
 * misfired on phones: hiding the keyboard to see the picker blurred the field, so the
 * emoji the player meant for their sentence was thrown onto the table instead.)
 */
export type PickerTab = 'emoji' | 'table';

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
 * Room social (Stage 7): the floating reaction/sticker display, one compact control row
 * and the chat panel. Reactions and chat are room-social UX only; they are NOT game
 * state. No userId/token is shown — only display name + emoji avatar.
 *
 * (Stage 38.0.14 — owner CRITICAL FAIL) The whole component now lives in NORMAL DOCUMENT
 * FLOW, wherever the game mounted it. 38.0.13 made the chat one canonical dialog — and
 * made it a MODAL, which was worse than the inconsistency it fixed: measured at 8523361
 * over all seven games, a 100%-viewport `rgba(0,0,0,.62)` backdrop dimmed the table,
 * `aria-modal="true"` announced the game as inert, `documentElement { overflow: hidden }`
 * froze the page, and every sampled tap over the board, the melds, the hand and the action
 * row landed in the chat instead — a legal card click reached the game **0 times** while
 * the authoritative timer kept running. A chat may never do that to a live game.
 *
 * So: no backdrop, no `aria-modal`, no focus trap, no scroll lock, no fixed overlay. The
 * open panel ADDS layout space in the safe zone each game gives it, and the hand, the
 * action bar and the timer keep working underneath it — the player moves without closing
 * the chat, and neither the move nor the STATE_UPDATE that follows closes it.
 */
export default function RoomSocial({ reactions, chat, myClientId, onReact, onChat, onChatMedia, notice, onClearNotice, handVisible = false, onLeaveGame, voiceButton, mySeatIndex = null, seatCount = 0, reactionsMirrored = false, timerSlot = null, utilitySlot = null, utilityPanelSlot = null, dangerSlot = null, openPanel, onPanelChange }: Props) {
  const { t } = useI18n();
  // Panel selection is CONTROLLED when the caller passes `openPanel` (so a caller-owned
  // utility panel is mutually exclusive with chat/reactions), else local.
  const [ownPanel, setOwnPanel] = useState<SocialPanel>('none');
  const panel = openPanel ?? ownPanel;
  const setPanel = (next: SocialPanel) => {
    if (onPanelChange) onPanelChange(next); else setOwnPanel(next);
  };
  const chatOpen = panel === 'chat';
  // (38.0.12) There is exactly one outer control for chat (plus the caller's utility
  // slot). Emoji and stickers live INSIDE the chat, behind the composer's picker, so the
  // player keeps reading, typing and sending while it is open.
  const chatLauncherRef = useRef<HTMLButtonElement>(null);
  /** Close the chat (or the caller's panel) and hand focus back to the 💬 launcher. */
  const closeChat = () => {
    const opener = chatLauncherRef.current;
    setPanel('none');
    opener?.focus();
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerBtnRef = useRef<HTMLButtonElement>(null);
  /**
   * Pressing a picker control must NOT move focus: the player is mid-sentence, and taking
   * the caret away would cost them the insertion point (and, on a phone, the keyboard).
   * Cancelling `mousedown` blocks the focus change on desktop AND on touch (phones
   * synthesise a mousedown from the tap) while the `click` still fires — measured at
   * 75a3b6d: opening the picker moved focus to the button.
   */
  const keepFocus = (e: { preventDefault: () => void }) => { e.preventDefault(); };
  const isTyping = () => typeof document !== 'undefined' && document.activeElement === inputRef.current;
  const [pickerTab, setPickerTab] = useState<PickerTab>('emoji');
  /**
   * The caret as the player last left it. On a phone the keyboard is usually closed while
   * they pick (it covers the picker), so the field is blurred — and a blurred input's own
   * `selectionStart` cannot be trusted (it reads 0 on some engines). Remembering the caret
   * lets an emoji land exactly where the player stopped typing, mid-sentence included.
   */
  const caretRef = useRef<{ start: number; end: number } | null>(null);
  const rememberCaret = () => {
    const el = inputRef.current;
    if (el && el.selectionStart != null) caretRef.current = { start: el.selectionStart, end: el.selectionEnd ?? el.selectionStart };
  };
  /** Close ONLY the picker; the conversation — and the caret — stay exactly where they were. */
  const closePicker = () => {
    setPickerOpen(false);
    if (!isTyping()) pickerBtnRef.current?.focus();
  };
  /**
   * (38.0.16) Where the PANELS render. The control row stays in the game — it is always
   * present, so it costs the same space open or closed — while the chat and the caller's
   * utility panel move to the social region, which is not in the stage's sizing context.
   * One component, one state: a portal moves the DOM, not the React tree. When no region
   * exists (the lobby, an isolated harness) they render in place, exactly as before.
   */
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setPanelHost(document.getElementById(SOCIAL_REGION_ID));
  }, [panel]);
  const [lightbox, setLightbox] = useState<ChatMedia | null>(null);
  const [text, setText] = useState('');
  /** (38.0.16) The ONE sticker riding along with this draft, if any. */
  const [attachment, setAttachment] = useState<ChatMediaItem | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [seen, setSeen] = useState(0);
  const [floats, setFloats] = useState<FloatSticker[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
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

  // (38.0.14) There is deliberately NO page-scroll lock. 38.0.13 froze
  // `documentElement.overflow` while the chat was open, which is exactly what a chat must
  // never do to a live game: the player could not scroll to their own hand.
  //
  // The panel opens IN FLOW, so on a tall board it can appear below the fold. Bring it
  // into view once — by SCROLLING THE PAGE, which is exactly what the player could have
  // done by hand, and which leaves the hand and the action row one scroll away.
  // (2026-10-14) In a room the panel FLOATS over the top of the table, already in view —
  // scrolling the page would only move the cards. Only the in-place fallback (no region:
  // the lobby, an isolated harness) still needs bringing into view.
  useEffect(() => {
    if (!chatOpen || panelHost) return;
    panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [chatOpen, panelHost]);

  //
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
   * The `table` tab → the EXISTING server reaction (Stage 7 protocol, no new transport). The
   * server stamps the sender and every client anchors it on that player's SEAT. It never
   * touches the draft, never pulls focus into the field, and never closes anything.
   */
  function react(emoji: string) {
    onReact(emoji);
  }
  /**
   * A sticker is a message, not a character — it cannot be typed into a plain `<input>`.
   * So it ATTACHES to the draft whenever there is a draft to attach it to (the field is
   * active, or something is already written); one Send then posts ONE message carrying
   * both. With no draft, the one-tap media-only message stands.
   */
  function sendMedia(item: ChatMediaItem) {
    if (isTyping() || text.trim().length > 0) {
      setAttachment(item);
      inputRef.current?.focus();
      return;
    }
    onChatMedia(item.id);
  }
  /**
   * The `emoji` tab → the emoji is TEXT: it lands at the caret (live, or as the player last
   * left it), so it drops into the middle of a half-typed line without wiping it, and the
   * caret follows it. Nothing is sent — the line leaves only on Send / Enter.
   *
   * Focus is handed back ONLY if the player was in the field. On a phone, re-focusing a
   * field the player had left would throw the keyboard up over the picker after every
   * single emoji; leaving it down lets them tap several in a row and read the result.
   */
  function insertEmoji(emoji: string) {
    const typing = isTyping();
    const el = inputRef.current;
    const saved = caretRef.current;
    const start = Math.min(typing ? (el?.selectionStart ?? text.length) : (saved?.start ?? text.length), text.length);
    const end = Math.min(Math.max(typing ? (el?.selectionEnd ?? start) : (saved?.end ?? start), start), text.length);
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, MAX_CHAT_LEN);
    setText(next);
    const caret = Math.min(start + emoji.length, next.length);
    caretRef.current = { start: caret, end: caret };
    if (!typing) return;
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
  /**
   * ONE submit → ONE message. Text, a sticker, or both: `onChat` is called exactly once,
   * so the server mints one id, one history entry and one rate-limit event. An empty draft
   * with no attachment sends nothing at all.
   */
  function submitChat() {
    const v = text.trim();
    if (!v && !attachment) return;
    onChat(v, attachment?.id);
    setText('');
    setAttachment(null);
    caretRef.current = null;
  }

  const noticeText = notice
    ? (notice.code === 'RATE_LIMITED' ? t('chat.tooMany') : t('chat.blocked'))
    : null;

  // --- shared pieces, all rendered inside the ONE in-flow cluster ------------
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
    <div className="chat-panel__list" ref={listRef}>
      {chat.length === 0
        ? <p className="chat-empty">{t('chat.empty')}</p>
        : chat.map((m) => (
          <ChatRow key={m.id} m={m} mine={!!myClientId && m.clientId === myClientId} onOpenMedia={setLightbox} />
        ))}
    </div>
  );

  /**
   * The attached sticker, shown as it will actually arrive — animated, at message size —
   * with one control to take it off again. It sits above the field so it never competes
   * with the caret for the row's width on a 360px phone.
   */
  const attachmentRow = attachment ? (
    <div className="chat-attach" role="group" aria-label={t('chat.attached')}>
      <img className="chat-attach__img" src={attachment.src} alt={attachment.label} decoding="async" />
      <span className="chat-attach__label">{t('chat.attached')}</span>
      <button type="button" className="chat-attach__remove" onMouseDown={keepFocus}
        onClick={() => { setAttachment(null); inputRef.current?.focus(); }}
        aria-label={t('chat.removeAttachment')} title={t('chat.removeAttachment')}>✕</button>
    </div>
  ) : null;

  const chatCompose = (
    <form className="chat-panel__compose" onSubmit={(e) => { e.preventDefault(); submitChat(); }}>
      {/* ONE picker control, next to the field, in every variant — and it does not take
          focus, so whatever the player was doing before the tap still holds. */}
      <button ref={pickerBtnRef} type="button" className="btn btn--ghost btn--small chat-picker-btn"
        aria-expanded={pickerOpen} aria-label={t('chat.openMedia')} title={t('chat.openMedia')}
        onMouseDown={keepFocus}
        onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}>😀</button>
      <input ref={inputRef} className="input chat-input" value={text} maxLength={MAX_CHAT_LEN}
        onChange={(e) => { setText(e.target.value); rememberCaret(); }}
        onSelect={rememberCaret} onBlur={rememberCaret}
        enterKeyHint="send" autoComplete="off" spellCheck
        placeholder={t('chat.placeholder')} aria-label={t('chat.message')} />
      <button type="submit" className="btn btn--primary btn--small chat-send-btn"
        disabled={!text.trim() && !attachment} aria-label={t('chat.send')} title={t('chat.send')}>
        <span className="chat-send-btn__label">{t('chat.send')}</span>
        <span className="chat-send-btn__icon" aria-hidden="true">➤</span>
      </button>
    </form>
  );

  /**
   * The in-chat picker: two emoji tabs, each with ONE fixed meaning (see {@link PickerTab}),
   * and the sticker catalog under them.
   * It is a BOUNDED SIBLING of the conversation — never a replacement for it — and the
   * single scroller of its region. No control in it takes focus (`keepFocus`).
   */
  const pickerTabs: { id: PickerTab; icon: string; label: string }[] = [
    { id: 'emoji', icon: '😀', label: t('chat.tabEmoji') },
    { id: 'table', icon: '🎭', label: t('chat.tabTable') },
  ];
  const chatPicker = pickerOpen ? (
    <div className="chat-picker" role="group" aria-label={t('chat.mediaPicker')}>
      <div className="chat-picker__tabs" role="tablist" aria-label={t('chat.mediaPicker')}>
        {pickerTabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={pickerTab === tab.id}
            className={`chat-picker__tab ${pickerTab === tab.id ? 'chat-picker__tab--on' : ''}`}
            onMouseDown={keepFocus} onClick={() => setPickerTab(tab.id)}>
            <span aria-hidden="true">{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>
      <div className="chat-picker__body">
      {pickerTab === 'emoji' && (
        <div className="chat-picker__emoji chat-picker__emoji--text" role="tabpanel">
          {TEXT_EMOJI.map((e) => (
            <button key={e} type="button" className="reaction-bar__btn"
              onMouseDown={keepFocus} onClick={() => insertEmoji(e)}
              aria-label={`${t('chat.insertEmoji')} ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
      {pickerTab === 'table' && (
        <div className="chat-picker__emoji chat-picker__emoji--table" role="tabpanel">
          <p className="chat-picker__note">{t('chat.tableHint')}</p>
          {REACTIONS.map((e) => (
            <button key={e} type="button" className="reaction-bar__btn"
              onMouseDown={keepFocus} onClick={() => react(e)}
              aria-label={`${t('social.emoji')} ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
      {stickerGrid}
      </div>
    </div>
  ) : null;

  /**
   * THE chat (Stage 38.0.13, made NON-MODAL in 38.0.14). One element, the same in all
   * seven games: a heading with ✕, the bounded history, the composer and the bounded
   * picker. It is a plain in-flow `section` — a labelled region, NOT a dialog: no
   * backdrop, no `aria-modal`, no focus trap, nothing that makes the game inert.
   */
  const chatPanel = chatOpen ? (
    <section className="chat-panel" ref={panelRef} aria-label={t('chat.title')}>
      <div className="chat-panel__head">
        <h2 className="chat-panel__title">💬 {t('chat.title')}</h2>
        <button type="button" className="chat-panel__close" onClick={closeChat} aria-label={t('btn.back')}>✕</button>
      </div>
      {chatList}
      {attachmentRow}
      {chatCompose}
      {chatPicker}
    </section>
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

      {/* (38.0.14, resized in 38.0.16) The control row lives IN NORMAL FLOW inside the game,
          in the safe zone the screen gave it: timer, utility control, voice, 💬, leave, the
          destructive action. Nothing is fixed, nothing is absolute, nothing covers the table,
          the melds, the hand or the action bar — and, because the row is always rendered, it
          costs the game exactly the same space whether the chat is open or shut. */}
      <div className="room-social">
        <div className="room-social__bar">
          {/* Per-turn timer (Stage 29.7) rides with the controls, never over the table. */}
          {timerSlot}
          {utilitySlot}
          {voiceButton}
          {/* (38.0.12) ONE social control: chat. Emoji are inside it, in every game. */}
          <button ref={chatLauncherRef} type="button" className="social-fab"
            aria-expanded={chatOpen} aria-label={t('chat.title')} title={t('chat.title')}
            onClick={() => (chatOpen ? closeChat() : setPanel('chat'))}>
            💬
            {unread > 0 && <span className="social-fab__badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
          {onLeaveGame && (
            <button type="button" className="social-fab social-fab--leave" onClick={leaveGame}
              aria-label={t('online.leaveGame')} title={t('online.leaveGame')}>
              🚪
            </button>
          )}
          {/* (38.0.5) The destructive permanent-leave control — same row, every game. */}
          {dangerSlot}
        </div>
      </div>

      {/* (38.0.16) The PANELS — the only parts whose size depends on state — render in the
          social region, a sibling of `.game-stage`. In the stage's own column they were
          subtracted from the board. Without a region (lobby, isolated harness) they render
          here, in flow, exactly as in 38.0.14. */}
      {panelHost
        ? createPortal(<>{utilityPanelSlot}{chatPanel}</>, panelHost)
        : (utilityPanelSlot || chatPanel)
          ? <div className="room-social room-social--inline">{utilityPanelSlot}{chatPanel}</div>
          : null}

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
        {/* (38.0.16) ONE bubble carries whatever the message has. Text-only and media-only
            entries — including every one already in history — render exactly as before;
            a combined message simply shows both, in the order they were written. */}
        {m.text ? <span className="chat-msg__text">{m.text}</span> : null}
        {m.media ? (
          <button type="button" className="chat-msg__media" onClick={() => onOpenMedia(m.media!)}
            aria-label={m.media.label}>
            <img src={m.media.src} alt={m.media.label} loading="lazy" decoding="async" />
          </button>
        ) : null}
      </span>
    </div>
  );
}
