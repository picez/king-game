import { useState, type ReactNode } from 'react';
import type { RoomSnapshot } from '../../net/messages';
import { useI18n } from '../../i18n';
import { getGameCatalogEntry, DEFAULT_GAME_TYPE } from '../../games/catalog';
import { buildInviteLink } from '../../net/invite';
import GameIcon from '../components/GameIcon';
import { teamDisplayName } from '../teamName';
import SeatAvatar from '../components/SeatAvatar';

interface Props {
  room: RoomSnapshot;
  isHost: boolean;
  myPlayerId: string | null;
  /** This client's connection id — used to never show "Kick" against yourself. */
  myClientId: string | null;
  onStart: () => void;
  onLeave: () => void;
  /** Host-only: remove another member (by clientId) before the game starts. */
  onKick: (clientId: string) => void;
  /** Host-only: add a server-side AI bot to a free seat before the game starts. */
  onAddBot: () => void;
  /** Host-only: set the per-turn timer (seconds; 0 = off). */
  onSetTimer: (turnTimerSec: number) => void;
  error: string | null;
  /** Friends invite block (Stage 25.9) — rendered INSIDE the lobby card, always visible. */
  inviteSlot?: ReactNode;
}

const TIMER_OPTIONS = [0, 30, 60, 90];

/**
 * Minimal lobby: shows the room code to share, the members, and (for the host)
 * a Start button enabled once enough players have joined. The host can also
 * remove other members before the game starts.
 */
export default function Lobby({ room, isHost, myPlayerId, myClientId, onStart, onLeave, onKick, onAddBot, onSetTimer, error, inviteSlot }: Props) {
  const { t } = useI18n();
  const players = room.members.filter((m) => m.role === 'player');
  // Stage 9.10: start once >= minPlayers are seated; the room caps at maxPlayers.
  const gameType = room.gameType ?? DEFAULT_GAME_TYPE;
  const entry = getGameCatalogEntry(gameType);
  const minPlayers = entry?.minPlayers ?? 3;
  // The room's actual seat cap is its own playerCount (the host's Solo/Pairs choice
  // for Deberc; the catalog max for every other game). Prefer it over the catalog max
  // so a 3-seat Deberc Solo room shows "/3", not "/4" (Stage 28.2).
  const maxPlayers = room.playerCount ?? entry?.maxPlayers ?? 4;
  // Deberc Solo (3 seats) is every-player-for-self: it must fill all 3 seats to start;
  // Pairs (4) needs all 4. Other games keep their catalog minimum.
  const needed = gameType === 'deberc' ? maxPlayers : minPlayers;
  const enough = players.length >= needed;
  const hasFreeSeat = players.length < maxPlayers;

  // Team lobby (Stage 18.0; refined 28.2): Deberc Pairs (4p) and Tarneeb are 2×2
  // partnership games — Team A = seats 0 & 2, Team B = seats 1 & 3 (partners opposite).
  // We show all four seats grouped by team so players see who's with whom before Start.
  // Deberc SOLO (3p) is every-player-for-self, so it must NOT use the team grid — it
  // falls through to the flat individual-seat list. Purely presentational; seat
  // assignment/order and the game rules are unchanged.
  const debercSolo = gameType === 'deberc' && maxPlayers === 3;
  // Tarneeb Solo (Stage 28.4): 4-player cutthroat — no partnerships, so no team grid.
  const tarneebSolo = gameType === 'tarneeb' && room.tarneebVariant === 'solo';
  const soloSeating = debercSolo || tarneebSolo;        // shown as flat individual seats
  const isTeamGame = gameType === 'tarneeb' || gameType === 'deberc';
  const showTeamGrid = isTeamGame && !soloSeating;      // Solo → flat individual seats
  const strictTeams = gameType === 'tarneeb';           // must be 4 to start (both variants)
  const teamsFull = showTeamGrid && players.length >= maxPlayers; // 4/4 seated (Pairs)
  const mySeat = myPlayerId ? Number(myPlayerId.split('-')[1]) : -1;
  const myTeam = mySeat >= 0 ? mySeat % 2 : -1;          // 0 = Team A, 1 = Team B
  const seatMember = (s: number) => room.members.find((m) => m.role === 'player' && m.seatIndex === s) ?? null;

  // Invite (Stage 18.1): share the room code or a same-origin invite link. The link
  // carries ONLY the room code (no session/token) and always uses the browser origin
  // — never the ws / custom-server URL. Copy via the Clipboard API; Share via
  // navigator.share when supported (a cancelled share stays silent). Host + guests
  // can both invite.
  const inviteLink = typeof window !== 'undefined' ? buildInviteLink(window.location.origin, room.code) : '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && !!inviteLink;
  const [copied, setCopied] = useState<null | 'code' | 'link'>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copyText(text: string, which: 'code' | 'link') {
    setCopyFailed(false);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(which);
        setTimeout(() => setCopied(null), 1600);
        return;
      }
    } catch { /* fall through to the manual-copy hint */ }
    setCopyFailed(true);
  }

  async function shareInvite() {
    if (!canShare) return;
    // A cancelled or unsupported share must NOT surface a scary error.
    try { await navigator.share({ title: t('app.title'), text: t('invite.shareText'), url: inviteLink }); }
    catch { /* silent */ }
  }

  function handleKick(clientId: string) {
    // The lobby is pre-start; a simple confirm is enough to avoid mis-taps.
    if (typeof window === 'undefined' || window.confirm(t('lobby.kickConfirm'))) onKick(clientId);
  }

  function handleLeave() {
    // A host leaving transfers the host role (or deletes an empty room), so
    // confirm to avoid a mis-tap. A non-host just frees their seat — leave now.
    if (isHost && typeof window !== 'undefined' && !window.confirm(t('lobby.leaveConfirm'))) return;
    onLeave();
  }

  // Shared member tags (host / AI / spectator / connection) + the host-only Kick
  // button — rendered the same way in both the flat list and the team seats.
  function renderTags(m: RoomSnapshot['members'][number]) {
    return (
      <span className="lobby-member__tags">
        {m.isHost && <span className="tag tag--host">{t('lobby.host')}</span>}
        {m.type === 'ai' && <span className="tag tag--bot" title={t('lobby.aiPlayer')}>{t('lobby.bot')}</span>}
        {m.role === 'spectator' && <span className="tag">{t('lobby.spectator')}</span>}
        {m.type !== 'ai' && (
          <span className={`tag ${m.connected ? 'tag--ok' : 'tag--off'}`}>
            {m.connected ? t('lobby.online') : t('lobby.offline')}
          </span>
        )}
        {isHost && !room.started && m.clientId !== myClientId && (
          <button type="button" className="btn btn--ghost btn--small lobby-kick"
            onClick={() => handleKick(m.clientId)}>
            {t('lobby.kick')}
          </button>
        )}
      </span>
    );
  }

  return (
    <div className="screen setup-screen">
      <h1 className="screen__title">{t('lobby.title')}</h1>

      <div className="setup-card">
        <div className="field-group">
          <label>{t('lobby.share')}</label>
          <div className="room-code">
            {room.code}{room.hasPassword && <span className="room-lock" title="🔒"> 🔒</span>}
          </div>
          {/* Invite actions (Stage 18.1): copy the code / a same-origin link, or Share. */}
          <div className="lobby-invite" role="group" aria-label={t('invite.title')}>
            <button type="button" className="btn btn--outline btn--small"
              onClick={() => void copyText(room.code, 'code')}>
              {copied === 'code' ? `✓ ${t('invite.copied')}` : `📋 ${t('invite.copyCode')}`}
            </button>
            {inviteLink && (
              <button type="button" className="btn btn--outline btn--small"
                onClick={() => void copyText(inviteLink, 'link')}>
                {copied === 'link' ? `✓ ${t('invite.copied')}` : `🔗 ${t('invite.copyLink')}`}
              </button>
            )}
            {canShare && (
              <button type="button" className="btn btn--outline btn--small" onClick={() => void shareInvite()}>
                📤 {t('invite.share')}
              </button>
            )}
          </div>
          {copyFailed && inviteLink && (
            <p className="setup-hint lobby-invite__manual">
              {t('invite.copyManual')}
              {/* Selectable, read-only text (not an editable field) — tap to select all. */}
              <code className="lobby-invite__field" aria-label={t('invite.roomLink')}>{inviteLink}</code>
            </p>
          )}
          <p className="setup-hint lobby-game-line">
            <GameIcon game={gameType} size="sm" className="lobby-game-icon" />
            {players.length} / {maxPlayers} {t('lobby.playersWord')} ·{' '}
            {room.gameType === 'durak' ? (
              <>🃏 {t(room.variant === 'transfer' ? 'durak.variantTransfer' : 'durak.variantSimple')}</>
            ) : room.gameType === 'deberc' ? (
              // Stage 28.0: name the mode explicitly — 3 seats = Solo (each for self),
              // 4 seats = Pairs (fixed 2×2). Engine/scoring unchanged; label only.
              <>🎴 {t(room.matchSize === 'big' ? 'deberc.big' : 'deberc.small')} · {t(room.playerCount === 3 ? 'lobby.debercSolo' : 'lobby.debercPairs')}</>
            ) : room.gameType === 'tarneeb' ? (
              // Tarneeb has two modes (Stage 28.4): Pairs (fixed 2×2) or Solo (cutthroat).
              // Show the chosen mode + the match target (Stage 29.8; default 41 for legacy rooms).
              <>♠️ {t(room.tarneebVariant === 'solo' ? 'tarneeb.modeSolo' : 'tarneeb.modePairs')} · 🎯 {room.tarneebTargetScore ?? 41}</>
            ) : room.gameType === 'preferans' ? (
              // Preferans (3-player, each-for-self) has no King-style mode; show its
              // contract-game label rather than a dealer's-choice/fixed-order term.
              <>🎩 {t('preferans.metaShort')}</>
            ) : room.gameType === 'fifty-one' ? (
              // 51 (Stage 30.5) is cutthroat rummy — no King-style mode; show its
              // Rummy meta + the elimination score (Stage 30.15; default 510 for legacy rooms).
              <>🀄 {t('fiftyOne.metaShort')} · ☠ {room.fiftyOneEliminationScore ?? 510}</>
            ) : (
              room.modeSelectionType === 'dealer_choice' ? t('form.dealerChoice') : t('form.fixedOrder')
            )}
            {room.hasPassword ? ` · 🔒 ${t('lobby.passwordRequired')}` : ''}
          </p>
        </div>

        <div className="field-group">
          <label>{t('lobby.players')}</label>
          {showTeamGrid ? (
            <>
              <div className="lobby-teams">
                {([0, 1] as const).map((team) => {
                  const seats = team === 0 ? [0, 2] : [1, 3];
                  const isMine = team === myTeam;
                  return (
                    <div key={team} className={`lobby-team lobby-team--${team === 0 ? 'a' : 'b'}${isMine ? ' lobby-team--mine' : ''}`}>
                      <div className="lobby-team__head">
                        <span className="lobby-team__label">
                          {teamDisplayName(seats, (s) => seatMember(s)?.name, t, team === 0 ? 'lobby.teamA' : 'lobby.teamB')}
                        </span>
                        {isMine && <span className="lobby-team__you">{t('lobby.yourTeam')}</span>}
                      </div>
                      <ul className="lobby-team__seats">
                        {seats.map((s) => {
                          const m = seatMember(s);
                          if (!m) {
                            return (
                              <li key={s} className="lobby-seat lobby-seat--empty">
                                <span className="lobby-seat__name">🪑 {t('lobby.emptySeat')}</span>
                              </li>
                            );
                          }
                          const role = s === mySeat ? t('lobby.you')
                            : (myTeam >= 0 && s % 2 === myTeam) ? t('lobby.partner') : null;
                          return (
                            <li key={s} className={`lobby-seat${m.type === 'human' && !m.connected ? ' lobby-seat--offline' : ''}`}>
                              <span className="lobby-seat__name">
                                <SeatAvatar emoji={m.avatar} imageUrl={m.avatarImageUrl} />
                                {m.name}
                                {role && <span className="lobby-seat__role">{role}</span>}
                              </span>
                              {renderTags(m)}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
              <p className="setup-hint lobby-teams-hint">👥 {t('lobby.partnerHint')}</p>
              {gameType === 'deberc' && <p className="setup-hint">{t('lobby.debercTeams')}</p>}
            </>
          ) : (
            <ul className="lobby-members">
              {room.members.map((m) => {
                const isMe = `player-${m.seatIndex}` === myPlayerId;
                return (
                  <li key={m.clientId} className={`lobby-member${m.type === 'human' && !m.connected ? ' lobby-member--offline' : ''}`}>
                    <span className="lobby-member__name">
                      <SeatAvatar emoji={m.avatar} imageUrl={m.avatarImageUrl} />
                      {m.name}{isMe ? ` ${t('lobby.you')}` : ''}
                    </span>
                    {renderTags(m)}
                  </li>
                );
              })}
            </ul>
          )}
          {/* Solo (Deberc 3p or Tarneeb): make the every-player-for-self framing explicit,
              mirroring the Pairs partner hint on the team grid above. */}
          {soloSeating && <p className="setup-hint">🙋 {t('lobby.debercSoloHint')}</p>}
        </div>

        {/* Friends invite (Stage 25.9): INSIDE the lobby card, right after the players — always
            visible (never below the fold / behind a collapsed section). */}
        {inviteSlot && <div className="lobby-friends-slot">{inviteSlot}</div>}

        {isHost && !room.started && hasFreeSeat && (
          <button className="btn btn--outline" onClick={onAddBot}>🤖 {t('lobby.addBot')}</button>
        )}

        {/* Per-turn timer (host sets; others see the current value). */}
        <div className="field-group">
          <label>⏱ {t('lobby.turnTimer')}</label>
          {isHost && !room.started ? (
            <div className="button-row">
              {TIMER_OPTIONS.map((sec) => (
                <button key={sec}
                  className={`btn btn--outline btn--small ${room.turnTimerSec === sec ? 'btn--active' : ''}`}
                  onClick={() => onSetTimer(sec)}>
                  {sec === 0 ? t('lobby.timerOff') : `${sec}s`}
                </button>
              ))}
            </div>
          ) : (
            <p className="setup-hint">{room.turnTimerSec === 0 ? t('lobby.timerOff') : `${room.turnTimerSec}s`}</p>
          )}
        </div>

        {error && <p className="lobby-error">{error}</p>}

        {isHost ? (
          <button className="btn btn--primary btn--large" disabled={!enough} onClick={onStart}>
            {teamsFull ? t('lobby.teamsReady')
              : !enough ? (strictTeams && showTeamGrid
                ? t('lobby.needTeams')
                : `${t('wait.waitingFor')} ${needed - players.length} ${t('lobby.waitingMore')}`)
                : t('btn.start')}
          </button>
        ) : (
          <p className="setup-hint">{t('lobby.waitingHost')}</p>
        )}

        <button className="btn btn--danger lobby-leave" onClick={handleLeave}>🚪 {t('lobby.leave')}</button>
      </div>
    </div>
  );
}
