import { useState, type ReactNode } from 'react';
import { GameContext } from '../../hooks/useGame';
import { useNetworkGame } from '../../hooks/useNetworkGame';
import type { OnlineIntent } from '../../hooks/useNetworkGame';
import { getActingPlayerId } from '../../core/gameEngine';
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
import Lobby from './Lobby';
import OnlineWaitingScreen from './OnlineWaitingScreen';
import RoomSocial from './RoomSocial';

const JOIN_ERR_CODES = new Set(['ROOM_NOT_FOUND', 'ROOM_FULL', 'BAD_PASSWORD', 'NAME_TAKEN', 'GAME_ALREADY_STARTED']);

interface Props {
  url: string;
  intent: OnlineIntent;
  /** Return to the menu. A join error code is passed back so the menu can
   *  highlight the offending field. */
  onExit: (joinError?: ErrorCode) => void;
  /** Whether the local user is a signed-in account (enables the Friends invite panel). */
  signedIn?: boolean;
}

const PUBLIC_STATUSES = new Set(['trick_complete', 'round_scoring', 'game_finished']);

/**
 * Online game root. Connects via useNetworkGame, shows the lobby until the
 * game starts, then renders the shared game screens. A client sees the action
 * screen only on its own turn; otherwise a read-only waiting view. Each client
 * receives only its own hand (server-side redaction).
 */
export default function OnlineGame({ url, intent, onExit, signedIn = false }: Props) {
  const net = useNetworkGame(url, intent);
  const { t } = useI18n();
  // In-room voice (Stage 25.4) — opt-in; nothing captured until the user taps Join voice.
  const voice = useRoomVoice(net);
  // Friends (Stage 25.2): API base is same-origin as the WS host; invited-this-session set.
  const friendsBase = apiBaseFromWsUrl(url);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const inviteFriend = (uid: string) => { net.sendFriendInvite(uid); setInvited((s) => new Set(s).add(uid)); };

  // A received friend invite → a Join/Dismiss toast (never auto-join). Join reuses the
  // existing `?room=CODE` invite flow (a same-origin navigation that lands on the Join
  // sheet prefilled). Built once so it shows in the lobby and in-game alike.
  const inviteToast = net.friendInvite ? (
    <div className="friend-invite-toast" role="status">
      <span className="friend-invite-toast__text">
        <strong>{net.friendInvite.fromName}</strong> {t('friends.invitedYou')} · <code>{net.friendInvite.code}</code>
      </span>
      <span className="friend-invite-toast__actions">
        <button type="button" className="btn btn--primary btn--small"
          onClick={() => { window.location.href = `/?room=${encodeURIComponent(net.friendInvite!.code)}`; }}>
          {t('friends.join')}
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
  const renderSocial = (handVisible: boolean, onLeaveGame?: () => void) => (
    <>
      {inviteToast}
      <RoomSocial
        reactions={net.reactions} chat={net.chat} myClientId={net.myClientId}
        onReact={net.sendReaction} onChat={net.sendChat} onChatMedia={net.sendChatMedia}
        notice={net.socialNotice} onClearNotice={net.clearSocialNotice}
        handVisible={handVisible} onLeaveGame={onLeaveGame}
        voiceButton={<VoiceControl voice={voice} variant="compact" />}
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
        />
        {signedIn && (
          <details className="lobby-friends">
            <summary className="lobby-friends__summary">👥 {t('friends.title')}</summary>
            <FriendsPanel base={friendsBase} signedIn={signedIn}
              onInvite={inviteFriend} invited={invited} refreshNonce={net.presenceNonce} />
          </details>
        )}
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
          disconnectedSeats={disconnectedSeats}
        />
        {renderSocial(true, leaveGameToMenu)}
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
          disconnectedSeats={disconnectedSeats}
        />
        {renderSocial(true, leaveGameToMenu)}
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
          disconnectedSeats={disconnectedSeats}
        />
        {/* No Leave-game pill here: Tarneeb's full-width bid/trump action bars would
            collide with it. The board's top-left ✕ already leaves the game
            (reconnectable). Social keeps only the compact emoji/chat corner. */}
        {renderSocial(true)}
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
          disconnectedSeats={disconnectedSeats}
        />
        {/* Like Tarneeb: no Leave-game pill (the board ✕ leaves, reconnectable);
            social keeps the compact emoji/chat corner. */}
        {renderSocial(true)}
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
        turnTimerSec: net.room?.turnTimerSec ?? 0, myPlayerId: net.myPlayerId, disconnectedSeats,
        seatAvatarImages,
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
