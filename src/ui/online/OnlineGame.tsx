import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GameContext } from '../../hooks/useGame';
import { useNetworkGame } from '../../hooks/useNetworkGame';
import type { OnlineIntent, ClientTimer } from '../../hooks/useNetworkGame';
import { getActingPlayerId } from '../../core/gameEngine';
import { getGameDefinition } from '../../games/registry';
import TurnTimerBar from '../components/TurnTimerBar';
import { isJoinError } from '../../net/online';
import { apiBaseFromWsUrl } from '../../net/profileApi';
import FriendsPanel from '../components/FriendsPanel';
import VoiceControl from '../components/VoiceControl';
import { useRoomVoice } from '../../voice/useRoomVoice';
import type { ErrorCode } from '../../net/messages';
import { clearSession } from '../../net/session';
import { isSafeAvatarImageUrl } from '../../net/avatarImage';
import { useI18n } from '../../i18n';
import GameRouter from '../GameRouter';
import DurakOnlineGame from '../durak/DurakOnlineGame';
import type { DurakState } from '../../games/durak/types';
import DebercOnlineGame from '../deberc/DebercOnlineGame';
import type { DebercState } from '../../games/deberc/types';
import TarneebOnlineGame from '../tarneeb/TarneebOnlineGame';
import type { TarneebState } from '../../games/tarneeb/types';
import PreferansOnlineGame from '../preferans/PreferansOnlineGame';
import type { PreferansState } from '../../games/preferans/types';
import FiftyOneOnlineGame from '../fiftyOne/FiftyOneOnlineGame';
import type { FiftyOneState } from '../../games/fiftyOne/types';
import { PokerOnlineGame, PokerActionLogButton, PokerActionLogPanel, useLogUnread } from '../poker';
import PokerRebuyPanel from '../poker/PokerRebuyPanel';
import PokerUnrankedDialog from '../poker/PokerUnrankedDialog';
import { rebuyWindowOf, canSeatRebuy } from '../../games/poker/rules';
import { bankrollRebuysLeft } from '../../games/poker/stakes';
import type { PokerState } from '../../games/poker/types';
import Lobby from './Lobby';
import OnlineWaitingScreen from './OnlineWaitingScreen';
import RoomSocial, { SOCIAL_REGION_ID, type SocialPanel } from './RoomSocial';
import PermanentLeaveControl from './PermanentLeaveControl';
import type { RematchUi } from './RematchControls';

const JOIN_ERR_CODES = new Set(['ROOM_NOT_FOUND', 'ROOM_FULL', 'BAD_PASSWORD', 'NAME_TAKEN', 'GAME_ALREADY_STARTED']);

/** Cards still in play — a game-agnostic progress signal (drops on each play) used to
 *  gate the low-time alert to MY turn. */

/**
 * The per-turn timer element for a NON-King online game (Stage 29.2; authoritative
 * deadline Stage 37.5). Computes the acting player game-agnostically via the
 * GameDefinition (to gate the low-time alert to MY turn) and drives the countdown from
 * the authoritative server `timer` (deadline/revision) — never a local full-length
 * clock, so reload/reconnect can't reset or extend it. Rendered INSIDE the RoomSocial
 * control cluster (Stage 29.7) — next to the voice/emoji/chat buttons, never over the
 * table or hand. Returns null when the host left the timer off (turnTimerSec 0). King
 * keeps its own in-banner TurnTimer.
 */
function onlineTurnTimer(gameType: string | undefined, state: unknown, myPlayerId: string | null, turnTimerSec: number, timer: ClientTimer | null): ReactNode {
  if (turnTimerSec <= 0 || !gameType || !state) return null;
  const def = getGameDefinition(gameType);
  const actingId = def ? def.getActingPlayerId(state as never) : null;
  return (
    <TurnTimerBar
      turnTimerSec={turnTimerSec}
      deadlineAt={timer?.deadlineAt ?? null}
      revision={timer?.revision ?? 0}
      clockOffset={timer?.clockOffset ?? 0}
      active={actingId != null && actingId === myPlayerId}
      className="turn-timer--social"
    />
  );
}

interface Props {
  url: string;
  intent: OnlineIntent;
  /** Return to the menu. A join error code is passed back so the menu can
   *  highlight the offending field. */
  onExit: (joinError?: ErrorCode) => void;
  /** Whether the local user is a signed-in account (enables the Friends invite panel). */
  signedIn?: boolean;
  /** Accept a friend invite for a DIFFERENT room: leave here and join `code` via the menu (26.1). */
  onJoinInvite?: (code: string) => void;
}

const PUBLIC_STATUSES = new Set(['trick_complete', 'round_scoring', 'game_finished']);

/**
 * Online game root. Connects via useNetworkGame, shows the lobby until the
 * game starts, then renders the shared game screens. A client sees the action
 * screen only on its own turn; otherwise a read-only waiting view. Each client
 * receives only its own hand (server-side redaction).
 */
export default function OnlineGame({ url, intent, onExit, signedIn = false, onJoinInvite }: Props) {
  const net = useNetworkGame(url, intent);
  const { t } = useI18n();
  // Friends (Stage 25.2): API base is same-origin as the WS host; invited-this-session set.
  const friendsBase = apiBaseFromWsUrl(url);
  // In-room voice (Stage 25.4) — opt-in; nothing captured until the user taps Join voice.
  // ICE config (STUN/TURN) is resolved from the same API host at runtime (Stage 25.6).
  const voice = useRoomVoice(net, friendsBase);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  // (38.0.8) Synchronous single-flight for the confirmed unranked START: React state is
  // async, so two clicks before the next render would otherwise send two STARTs.
  const startPending = useRef(false);
  const inviteFriend = (uid: string) => { net.sendFriendInvite(uid); setInvited((s) => new Set(s).add(uid)); };

  // Rematch / "Play again" (Stage 25.9): a shared object passed to each online finish screen so
  // "Play again" restarts the same room's game (bots auto-ready; multi-human needs everyone ready)
  // instead of leaving to the menu. Null until we have a room.
  const rematchUi: RematchUi | null = net.room ? {
    progress: net.rematch,
    members: net.room.members,
    myClientId: net.myClientId,
    onReady: net.sendRematchReady,
    onDecline: net.sendRematchDecline,
  } : null;

  // A received friend invite while already IN a room (Stage 26.1). "Join room" is now actionable:
  //  - same room as the invite → just dismiss (already here);
  //  - a DIFFERENT room → confirm (leaving loses the current game), then route the code through
  //    the menu (App.onJoinInvite), which owns the name/server/JOIN flow and remounts OnlineGame.
  const acceptInvite = () => {
    const code = net.friendInvite?.code;
    if (!code) return;
    if (net.room?.code === code) { net.dismissFriendInvite(); return; }
    if (typeof window !== 'undefined' && !window.confirm(t('friends.leaveToJoin'))) return;
    net.dismissFriendInvite();
    onJoinInvite?.(code);
  };
  const inviteToast = net.friendInvite ? (
    <div className="friend-invite-toast" role="status">
      <span className="friend-invite-toast__text">
        <strong>{net.friendInvite.fromName}</strong> {t('friends.invitedYou')} · <code>{net.friendInvite.code}</code>
      </span>
      <span className="friend-invite-toast__actions">
        <button type="button" className="btn btn--primary btn--small" onClick={acceptInvite}>
          {t('friends.joinRoom')}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={net.dismissFriendInvite}>
          {t('friends.dismiss')}
        </button>
      </span>
    </div>
  ) : null;
  const errText = (code: ErrorCode | null) => t(code && JOIN_ERR_CODES.has(code) ? `err.${code}` : 'err.generic');

  // Room-social overlay (reactions + chat). Rendered ONCE at this online level,
  // as a sibling of the game/lobby, so it never unmounts when the game status
  // switches (mode_selection → playing → trick_complete → …) or when the view
  // flips between the action screen and the waiting screen. `handVisible` lifts
  // the corner controls above the hand on the playing screen so cards stay clear.
  // Active-game "Leave game": return to the menu but stay reconnectable so the
  // start menu still offers Resume (does NOT remove the seat or log out).
  const leaveGameToMenu = () => { net.backToMenu(); onExit(); };
  // Stage 38.0.5 — PERMANENT leave. The server has already committed the forfeit and the
  // seat takeover (or closed the room) and the hook has cleared the local session, so the
  // only thing left for the screen to do is exit. Never called for a refused attempt.
  useEffect(() => {
    if (net.permanentLeave.status === 'accepted') onExit();
    // `onExit` is stable for the lifetime of an online session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.permanentLeave.status]);
  // Poker docks its social cluster in flow and owns the single open surface (Stage
  // 38.0.3). Declared unconditionally (hooks) and inert for the other six games.
  const [socialPanel, setSocialPanel] = useState<SocialPanel>('none');
  const pokerLogLength = net.room?.gameType === 'poker'
    ? ((net.state as unknown as PokerState | null)?.actionLog?.length ?? 0) : 0;
  const pokerLogUnread = useLogUnread(pokerLogLength, socialPanel === 'utility');
  // The viewer's seat + table size (Stage 27.1) so RoomSocial floats a reaction over the sender's
  // seat. Derived from the room snapshot (public); null/0 for a spectator → reactions stay centred.
  const myMember = net.room?.members.find((m) => m.clientId === net.myClientId);
  const mySeatIndex = myMember?.role === 'player' ? myMember.seatIndex : null;
  const seatCount = net.room?.members.filter((m) => m.role === 'player').length ?? 0;
  // Tarneeb mirrors its seats left↔right on screen (TarneebGameScreen `seatPosition`), so a reaction
  // must be anchored with the mirrored convention or it lands on the wrong side for remote viewers
  // (Stage 29.5). Every other game seats forward, so the default (false) is correct there.
  const reactionsMirrored = net.room?.gameType === 'tarneeb';
  // The per-turn timer (non-King online games) rides in the social cluster (Stage 29.7),
  // next to voice/emoji/chat — never a table overlay. `null` when the host timer is off.
  // `utilitySlot` is RoomSocial's GENERIC extra-control slot (it knows nothing about any
  // game). Poker passes its compact action-history control there (Stage 38.0.2) so the
  // button lives in the same cluster as chat/emoji/voice/timer instead of a block under
  // the table — exactly one log control per table.
  // The destructive permanent-leave control (Stage 38.0.5). Offered ONLY on an ACTIVE
  // online non-Poker game and ONLY to a SEATED player: the lobby leave is free and
  // reversible, a spectator has no seat to forfeit, and Poker is out of scope (its seats
  // carry real chips). Rendered inside the RoomSocial control row, so it inherits that
  // cluster's safe position in every game and never covers the table/hand/melds/actions.
  const canLeavePermanently = !!net.room?.started && net.room?.gameType !== 'poker' && mySeatIndex != null;
  const permanentLeaveSlot = canLeavePermanently
    ? <PermanentLeaveControl state={net.permanentLeave} onConfirm={net.leavePermanently} />
    : null;
  // (38.0.14) The node is IN-FLOW now: every branch hands it to its game screen through
  // the generic `socialSlot`, and the screen renders it in its own safe zone. The lobby /
  // dealing screens render it as an ordinary trailing block of the page.
  const renderSocial = (handVisible: boolean, onLeaveGame?: () => void, timerSlot?: ReactNode, utilitySlot?: ReactNode) => (
    <>
      {inviteToast}
      <RoomSocial
        reactions={net.reactions} chat={net.chat} myClientId={net.myClientId}
        onReact={net.sendReaction} onChat={net.sendChat} onChatMedia={net.sendChatMedia}
        notice={net.socialNotice} onClearNotice={net.clearSocialNotice}
        handVisible={handVisible} onLeaveGame={onLeaveGame}
        voiceButton={<VoiceControl voice={voice} variant="compact" />}
        mySeatIndex={mySeatIndex} seatCount={seatCount} reactionsMirrored={reactionsMirrored}
        timerSlot={timerSlot} utilitySlot={utilitySlot}
        dangerSlot={permanentLeaveSlot}
      />
    </>
  );

  /**
   * (38.0.16) THE room layout. Two regions, and only one of them is allowed to change
   * size with the chat:
   *   `.game-stage`   — the whole game scene. Every screen is a `min-height: 100vh` flex
   *                     column whose board grows with `flex: 1 1 auto`, so ANY sibling
   *                     mounted inside it is subtracted from the board. Measured at
   *                     7105e1f: opening the chat took the Durak felt from 649.67px to
   *                     304px at 768 and from 705.67px to 315.28px at 1920, and pushed the
   *                     hand ~330px down. The stage is now a closed box: its contents
   *                     never depend on whether a panel is open.
   *   `.social-region` — where the panels land. On a wide screen it is a reserved rail
   *                     beside the stage (reserved whether or not the chat is open, so
   *                     opening it can never add a column and re-centre the game); below
   *                     that width it follows the whole scene in normal flow and the page
   *                     simply gets taller.
   * The region is always in the DOM so `RoomSocial`'s portal has a home from the first
   * paint, and it is EMPTY when nothing is open — an empty region has no size.
   */
  const roomLayout = (screen: ReactNode) => (
    <div className="room-layout">
      <div className="game-stage">{screen}</div>
      <div className="social-region" id={SOCIAL_REGION_ID} />
    </div>
  );

  if (net.status === 'connecting') {
    return <CenterNote title={t('net.connecting')} sub={url} />;
  }

  if (net.status === 'error') {
    const joinRejected = isJoinError(net.errorCode);
    const title = joinRejected ? t('net.joinFailTitle') : t('net.problemTitle');
    const sub = net.errorCode ? errText(net.errorCode) : (net.error ?? t('err.generic'));
    return (
      <CenterNote title={title} sub={sub}>
        <div className="button-row">
          <button
            className="btn btn--primary"
            onClick={() => onExit(joinRejected ? (net.errorCode ?? undefined) : undefined)}
          >
            {joinRejected ? t('net.backRetry') : t('btn.backToMenu')}
          </button>
          {!joinRejected && (
            <button className="btn btn--ghost" onClick={() => { clearSession(); onExit(); }}>
              {t('net.forgetSaved')}
            </button>
          )}
        </div>
      </CenterNote>
    );
  }

  if (net.status === 'disconnected') {
    return (
      <CenterNote title={t('net.reconnecting')} sub={t('net.reconnectingSub')}>
        <button className="btn btn--ghost" onClick={() => onExit()}>{t('btn.backToMenu')}</button>
      </CenterNote>
    );
  }

  if (net.status === 'kicked') {
    // Host removed this client from the lobby. Show a clear message; the menu
    // also surfaces err.KICKED_BY_HOST when we exit.
    return (
      <CenterNote title={t('lobby.title')} sub={t('err.KICKED_BY_HOST')}>
        <button className="btn btn--primary" onClick={() => onExit('KICKED_BY_HOST')}>
          {t('btn.backToMenu')}
        </button>
      </CenterNote>
    );
  }

  // Lobby (room exists, game not started yet).
  if (net.room && !net.room.started) {
    return (
      <>
        <Lobby
          room={net.room}
          isHost={net.isHost}
          myPlayerId={net.myPlayerId}
          myClientId={net.myClientId}
          onStart={() => { net.clearPokerPolicy(); startPending.current = false; net.startGame(); }}
          onLeave={() => { net.leave(); onExit(); }}
          onKick={net.kick}
          onAddBot={net.addBot}
          onSetTimer={net.setTimer}
          error={net.error}
          inviteSlot={
            // Always-visible invite block INSIDE the lobby card (Stage 25.9): online friends first
            // with a clear Invite button; guests / no-friends / loading / error get an explicit state.
            <FriendsPanel base={friendsBase} signedIn={signedIn} variant="invite"
              onInvite={inviteFriend} invited={invited} refreshNonce={net.presenceNonce} />
          }
        />
        <div className="lobby-voice"><VoiceControl voice={voice} variant="card" /></div>
        {/* (38.0.8) The ONE pre-debit handshake. The server already refused the START without
            debiting anything; confirming re-sends it with the acknowledgement, and the server
            recomputes the decision under its lock right before the debit. */}
        {net.pokerPolicy?.kind === 'unranked_confirm' && (
          <PokerUnrankedDialog
            pending={startPending.current}
            onConfirm={() => {
              if (startPending.current) return;      // double-click → exactly ONE START
              startPending.current = true;
              net.startGame(true);
            }}
            onCancel={() => { startPending.current = false; net.clearPokerPolicy(); }}
          />
        )}
        {/* A cooldown refusal is inert: nothing was debited and the lobby keeps working. */}
        {net.pokerPolicy?.kind === 'cooldown' && (
          <div className="poker-policy-note" role="status">
            <strong>{t('poker.cooldownTitle')}</strong>
            <span>{t('poker.cooldownBody')}</span>
            {net.pokerPolicy.retryAfterSeconds != null && (
              <span className="poker-policy-note__retry">
                {t('poker.cooldownRetry').replace('{n}', String(Math.max(1, Math.ceil(net.pokerPolicy.retryAfterSeconds / 60))))}
              </span>
            )}
            <button type="button" className="btn btn--ghost btn--small" onClick={net.clearPokerPolicy}>
              {t('btn.back')}
            </button>
          </div>
        )}
        {renderSocial(false)}
      </>
    );
  }

  // Game started but the first authoritative state has not arrived yet.
  if (!net.state) {
    return (
      <>
        <CenterNote title={t('net.dealing')} />
        {renderSocial(false, leaveGameToMenu)}
      </>
    );
  }

  // Human seats currently disconnected (for offline badges / dimming at the table).
  const disconnectedSeats = (net.room?.members ?? [])
    .filter((m) => m.type === 'human' && !m.connected && m.seatIndex != null)
    .map((m) => m.seatIndex as number);

  // Stage 17.3: seat index → a member's SAME-ORIGIN uploaded avatar URL, from the
  // room snapshot. Only validated same-origin values are kept; everyone else (bots /
  // guests / no upload) is absent → the seat shows the emoji. Never the local image.
  const seatAvatarImages: Record<number, string> = {};
  for (const m of net.room?.members ?? []) {
    if (m.seatIndex != null && isSafeAvatarImageUrl(m.avatarImageUrl)) {
      seatAvatarImages[m.seatIndex] = m.avatarImageUrl;
    }
  }

  // Per-turn timer for the non-King online games (Stage 29.2) — visible when the host set
  // 30/60/90. Rendered inside the RoomSocial control cluster (Stage 29.7), not as a table
  // overlay. King renders its own TurnTimer inside the GameRouter branch.
  const timerEl = onlineTurnTimer(net.room?.gameType, net.state, net.myPlayerId, net.room?.turnTimerSec ?? 0, net.timer);

  // Experimental online Durak: render the Durak screens (NOT King's GameRouter).
  // The Durak screen itself shows the read-only table + "waiting / bot thinking /
  // offline — AI may play" when it is not this client's turn.
  if (net.room?.gameType === 'durak') {
    return roomLayout(
      <DurakOnlineGame
        state={net.state as unknown as DurakState}
        myPlayerId={net.myPlayerId}
        dispatch={net.dispatch}
        onExit={leaveGameToMenu}
        rematch={rematchUi}
        disconnectedSeats={disconnectedSeats}
        socialSlot={renderSocial(true, leaveGameToMenu, timerEl)}
      />,
    );
  }

  // Online Deberc: render the Deberc screens (NOT King's GameRouter). The server
  // drives bots + the public-screen advances (NEXT_TRICK / NEXT_HAND).
  if (net.room?.gameType === 'deberc') {
    return roomLayout(
      <DebercOnlineGame
        state={net.state as unknown as DebercState}
        myPlayerId={net.myPlayerId}
        dispatch={net.dispatch}
        onExit={leaveGameToMenu}
        rematch={rematchUi}
        disconnectedSeats={disconnectedSeats}
        socialSlot={renderSocial(true, leaveGameToMenu, timerEl)}
      />,
    );
  }

  // Experimental online Tarneeb: render the Tarneeb screens (NOT King's
  // GameRouter). The server drives bots + the public hand_complete advance
  // (START_NEXT_HAND); the screen is read-only when it is not this client's turn.
  if (net.room?.gameType === 'tarneeb') {
    // No Leave-game pill here: Tarneeb's board ✕ already leaves the game (reconnectable).
    // Social keeps only the compact control row + timer.
    return roomLayout(
      <TarneebOnlineGame
        state={net.state as unknown as TarneebState}
        myPlayerId={net.myPlayerId}
        dispatch={net.dispatch}
        onExit={leaveGameToMenu}
        rematch={rematchUi}
        disconnectedSeats={disconnectedSeats}
        socialSlot={renderSocial(true, undefined, timerEl)}
      />,
    );
  }

  // Experimental online Preferans (Stage 19.5): render the Preferans screens (NOT
  // King's GameRouter). The server drives bots + the public hand_complete advance
  // (START_NEXT_HAND); the screen is read-only when it is not this client's turn.
  if (net.room?.gameType === 'preferans') {
    return roomLayout(
      <>
        <PreferansOnlineGame
          state={net.state as unknown as PreferansState}
          myPlayerId={net.myPlayerId}
          dispatch={net.dispatch}
          onExit={leaveGameToMenu}
          rematch={rematchUi}
          disconnectedSeats={disconnectedSeats}
          socialSlot={renderSocial(true, undefined, timerEl)}
        />
        {/* Like Tarneeb: no Leave-game pill (the board ✕ leaves, reconnectable);
            social keeps the compact control row + timer. */}
      </>
    );
  }

  // Online 51 (Stage 30.5): render the 51 screens (NOT King's GameRouter). The
  // server drives bots + the public round_complete advance (seeded
  // START_NEXT_ROUND); the screen is read-only when it is not this client's turn.
  if (net.room?.gameType === 'fifty-one') {
    // (38.0.14) 51 hands the SAME game-agnostic RoomSocial to its generic `socialSlot`,
    // which the screen renders IN NORMAL FLOW between the public melds and the prompt.
    // 38.0.5.1's top-bar launcher + bottom sheet and 38.0.13's centred modal both covered
    // the melds and the action row; the modal also froze the page scroll, so the player
    // could not act at all while the chat was open.
    const fiftyOneSocial = (
      <>
        {inviteToast}
        <RoomSocial
          reactions={net.reactions} chat={net.chat} myClientId={net.myClientId}
          onReact={net.sendReaction} onChat={net.sendChat} onChatMedia={net.sendChatMedia}
          notice={net.socialNotice} onClearNotice={net.clearSocialNotice}
          handVisible={false}
          voiceButton={<VoiceControl voice={voice} variant="compact" />}
          mySeatIndex={mySeatIndex} seatCount={seatCount}
          dangerSlot={permanentLeaveSlot}
          openPanel={socialPanel}
          onPanelChange={setSocialPanel}
        />
      </>
    );
    return roomLayout(
      <FiftyOneOnlineGame
        state={net.state as unknown as FiftyOneState}
        myPlayerId={net.myPlayerId}
        dispatch={net.dispatch}
        onExit={leaveGameToMenu}
        rematch={rematchUi}
        disconnectedSeats={disconnectedSeats}
        socialSlot={fiftyOneSocial}
        timerSlot={timerEl}
      />
    );
  }

  // Online poker (Stage 37.4): render the poker screens (NOT King's GameRouter). The
  // server drives bots + the between-hands advance (seeded START_NEXT_HAND).
  if (net.room?.gameType === 'poker') {
    const pokerState = net.state as unknown as PokerState;
    // Stage 38.0.3 (owner FAIL): poker's action controls live at the BOTTOM of the
    // screen, so the fixed corner cluster landed straight on top of them on a phone.
    // Poker therefore renders the social cluster DOCKED and IN FLOW, between the table
    // and the action row, and owns which single surface is open (history / chat /
    // reactions) so two panels can never stack on the same spot.
    const logOpen = socialPanel === 'utility';
    // §17 — the between-hands rebuy. The client decides NOTHING: it renders the server's
    // window, shows the countdown from the server's absolute deadline, and offers the
    // buttons ONLY for this viewer's own eligible seat. Every other seat is public
    // seat/name/decision — never a balance or an economy identifier.
    const rebuyWin = rebuyWindowOf(pokerState);
    const myRebuySeat = mySeatIndex != null && canSeatRebuy(pokerState, mySeatIndex) ? mySeatIndex : null;
    const rebuySlot = rebuyWin ? (
      <PokerRebuyPanel
        state={pokerState}
        amount={net.room?.pokerBuyIn ?? pokerState.options.startingStack}
        actionableSeats={myRebuySeat != null ? [myRebuySeat] : []}
        onRebuy={() => net.sendPokerRebuy()}
        onDecline={() => net.sendPokerRebuyDecline()}
        secondsLeft={net.room?.pokerRebuyDeadlineAt
          ? Math.max(0, Math.ceil((net.room.pokerRebuyDeadlineAt - Date.now()) / 1000))
          : null}
        busySeat={net.pokerRebuy?.status === 'pending' ? myRebuySeat : null}
        walletBalance={net.pokerRebuy?.balance ?? null}
        insufficient={net.pokerRebuy?.status === 'insufficient'}
        failed={net.pokerRebuy?.status === 'refused'}
      />
    ) : null;
    const social = (
      <>
        {inviteToast}
        <RoomSocial
          reactions={net.reactions} chat={net.chat} myClientId={net.myClientId}
          onReact={net.sendReaction} onChat={net.sendChat} onChatMedia={net.sendChatMedia}
          notice={net.socialNotice} onClearNotice={net.clearSocialNotice}
          handVisible={false} onLeaveGame={leaveGameToMenu}
          voiceButton={<VoiceControl voice={voice} variant="compact" />}
          mySeatIndex={mySeatIndex} seatCount={seatCount}
          timerSlot={timerEl}
          openPanel={socialPanel}
          onPanelChange={setSocialPanel}
          utilitySlot={
            <PokerActionLogButton
              open={logOpen}
              unread={pokerLogUnread}
              onToggle={(next) => setSocialPanel(next ? 'utility' : 'none')}
            />
          }
          utilityPanelSlot={logOpen
            ? <PokerActionLogPanel state={pokerState} docked onClose={() => setSocialPanel('none')} />
            : null}
        />
      </>
    );
    return roomLayout(
      <>
        {/* Recovery banner is owned by PokerOnlineGame (37.7.7 FAIL 3 — exactly one banner per state).
            (38.0.8) `statsEligible` / `rebuysLeft` are the ONLY public anti-dumping facts, both
            derived from the public snapshot + public state — never from a server-only field. */}
        <PokerOnlineGame
          state={pokerState}
          myPlayerId={net.myPlayerId}
          dispatch={net.dispatch}
          onExit={leaveGameToMenu}
          rematch={rematchUi}
          recovery={net.room?.pokerRecovery}
          socialSlot={social}
          rebuySlot={rebuySlot}
          statsEligible={net.room?.pokerStatsEligible}
          rebuysLeft={
            net.room?.pokerStatsEligible === undefined || mySeatIndex == null
              ? undefined
              : bankrollRebuysLeft((pokerState.appliedRebuys ?? []).filter((r) => r.seat === mySeatIndex).length)
          }
        />
      </>
    );
  }

  const status = net.state.status;
  const isPublic = PUBLIC_STATUSES.has(status);
  const actorId = getActingPlayerId(net.state);
  const showAction = isPublic || actorId === net.myPlayerId;
  // (38.0.5) King's in-game ✕ now behaves exactly like the other five games: it drops the
  // socket and stays RECONNECTABLE (Resume still offered). It used to send LEAVE_ROOM,
  // which during an active match deleted the seat and re-numbered everyone else's.
  const exitToMenu = leaveGameToMenu;

  return roomLayout(
    <>
      <GameContext.Provider value={{
        state: net.state, dispatch: net.dispatch, online: true, onExit: exitToMenu,
        turnTimerSec: net.room?.turnTimerSec ?? 0, timer: net.timer, myPlayerId: net.myPlayerId, disconnectedSeats,
        seatAvatarImages, rematch: rematchUi,
        socialSlot: renderSocial(status === 'playing', leaveGameToMenu),
      }}>
        {showAction ? <GameRouter /> : <OnlineWaitingScreen myPlayerId={net.myPlayerId} />}
      </GameContext.Provider>
    </>
  );
}

function CenterNote({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="screen center-screen">
      <div className="modal-card">
        <h2>{title}</h2>
        {sub && <p className="modal-card__sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}
