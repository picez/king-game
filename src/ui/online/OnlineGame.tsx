import { useState, type ReactNode } from 'react';
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
import { PokerOnlineGame, PokerRecoveryBanner } from '../poker';
import type { PokerState } from '../../games/poker/types';
import Lobby from './Lobby';
import OnlineWaitingScreen from './OnlineWaitingScreen';
import RoomSocial from './RoomSocial';
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
  const renderSocial = (handVisible: boolean, onLeaveGame?: () => void, timerSlot?: ReactNode) => (
    <>
      {inviteToast}
      <RoomSocial
        reactions={net.reactions} chat={net.chat} myClientId={net.myClientId}
        onReact={net.sendReaction} onChat={net.sendChat} onChatMedia={net.sendChatMedia}
        notice={net.socialNotice} onClearNotice={net.clearSocialNotice}
        handVisible={handVisible} onLeaveGame={onLeaveGame}
        voiceButton={<VoiceControl voice={voice} variant="compact" />}
        mySeatIndex={mySeatIndex} seatCount={seatCount} reactionsMirrored={reactionsMirrored}
        timerSlot={timerSlot}
      />
    </>
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
          onStart={net.startGame}
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
    return (
      <>
        <DurakOnlineGame
          state={net.state as unknown as DurakState}
          myPlayerId={net.myPlayerId}
          dispatch={net.dispatch}
          onExit={leaveGameToMenu}
          rematch={rematchUi}
          disconnectedSeats={disconnectedSeats}
        />
        {renderSocial(true, leaveGameToMenu, timerEl)}
      </>
    );
  }

  // Online Deberc: render the Deberc screens (NOT King's GameRouter). The server
  // drives bots + the public-screen advances (NEXT_TRICK / NEXT_HAND).
  if (net.room?.gameType === 'deberc') {
    return (
      <>
        <DebercOnlineGame
          state={net.state as unknown as DebercState}
          myPlayerId={net.myPlayerId}
          dispatch={net.dispatch}
          onExit={leaveGameToMenu}
          rematch={rematchUi}
          disconnectedSeats={disconnectedSeats}
        />
        {renderSocial(true, leaveGameToMenu, timerEl)}
      </>
    );
  }

  // Experimental online Tarneeb: render the Tarneeb screens (NOT King's
  // GameRouter). The server drives bots + the public hand_complete advance
  // (START_NEXT_HAND); the screen is read-only when it is not this client's turn.
  if (net.room?.gameType === 'tarneeb') {
    return (
      <>
        <TarneebOnlineGame
          state={net.state as unknown as TarneebState}
          myPlayerId={net.myPlayerId}
          dispatch={net.dispatch}
          onExit={leaveGameToMenu}
          rematch={rematchUi}
          disconnectedSeats={disconnectedSeats}
        />
        {/* No Leave-game pill here: Tarneeb's full-width bid/trump action bars would
            collide with it. The board's top-left ✕ already leaves the game
            (reconnectable). Social keeps only the compact emoji/chat corner + timer. */}
        {renderSocial(true, undefined, timerEl)}
      </>
    );
  }

  // Experimental online Preferans (Stage 19.5): render the Preferans screens (NOT
  // King's GameRouter). The server drives bots + the public hand_complete advance
  // (START_NEXT_HAND); the screen is read-only when it is not this client's turn.
  if (net.room?.gameType === 'preferans') {
    return (
      <>
        <PreferansOnlineGame
          state={net.state as unknown as PreferansState}
          myPlayerId={net.myPlayerId}
          dispatch={net.dispatch}
          onExit={leaveGameToMenu}
          rematch={rematchUi}
          disconnectedSeats={disconnectedSeats}
        />
        {/* Like Tarneeb: no Leave-game pill (the board ✕ leaves, reconnectable);
            social keeps the compact emoji/chat corner + timer. */}
        {renderSocial(true, undefined, timerEl)}
      </>
    );
  }

  // Online 51 (Stage 30.5): render the 51 screens (NOT King's GameRouter). The
  // server drives bots + the public round_complete advance (seeded
  // START_NEXT_ROUND); the screen is read-only when it is not this client's turn.
  if (net.room?.gameType === 'fifty-one') {
    return (
      <>
        <FiftyOneOnlineGame
          state={net.state as unknown as FiftyOneState}
          myPlayerId={net.myPlayerId}
          dispatch={net.dispatch}
          onExit={leaveGameToMenu}
          rematch={rematchUi}
          disconnectedSeats={disconnectedSeats}
        />
        {/* Like Tarneeb/Preferans: no Leave-game pill (the board ✕ leaves,
            reconnectable); social keeps the compact emoji/chat corner + timer. */}
        {renderSocial(true, undefined, timerEl)}
      </>
    );
  }

  // Online poker (Stage 37.4): render the poker screens (NOT King's GameRouter). The
  // server drives bots + the between-hands advance (seeded START_NEXT_HAND).
  if (net.room?.gameType === 'poker') {
    return (
      <>
        {/* Recovery banner (§16, 37.7.5) — covers a FROZEN table that still has a game state. */}
        <PokerRecoveryBanner status={net.room?.pokerRecovery} />
        <PokerOnlineGame
          state={net.state as unknown as PokerState}
          myPlayerId={net.myPlayerId}
          dispatch={net.dispatch}
          onExit={leaveGameToMenu}
        />
        {renderSocial(true, undefined, timerEl)}
      </>
    );
  }

  const status = net.state.status;
  const isPublic = PUBLIC_STATUSES.has(status);
  const actorId = getActingPlayerId(net.state);
  const showAction = isPublic || actorId === net.myPlayerId;
  const exitToMenu = () => { net.leave(); onExit(); };

  return (
    <>
      <GameContext.Provider value={{
        state: net.state, dispatch: net.dispatch, online: true, onExit: exitToMenu,
        turnTimerSec: net.room?.turnTimerSec ?? 0, timer: net.timer, myPlayerId: net.myPlayerId, disconnectedSeats,
        seatAvatarImages, rematch: rematchUi,
      }}>
        {showAction ? <GameRouter /> : <OnlineWaitingScreen myPlayerId={net.myPlayerId} />}
      </GameContext.Provider>
      {renderSocial(status === 'playing', leaveGameToMenu)}
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
