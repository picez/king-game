import { useEffect, useMemo, useRef, useState } from 'react';
import type { OnlineIntent } from '../hooks/useNetworkGame';
import { useRoomList } from '../hooks/useRoomList';
import type { RoomSummary } from '../net/messages';
import {
  filterRooms, sortRooms, countRoomsByGame, roomListAgo, ROOM_SORTS,
  type GameFilter, type RoomSort,
} from './menu/roomBrowser';

/** Auto-refresh cadence for the open room browser + how often the "ago" label ticks. */
const ROOM_AUTO_REFRESH_MS = 9000;
const ROOM_AGO_TICK_MS = 5000;
import { loadCustomServer, resolveServerUrl } from '../net/connection';
import type { ErrorCode } from '../net/messages';
import { loadSession, clearSession } from '../net/session';
import { roomCodeFromQuery, INVITE_ROOM_PARAM } from '../net/invite';
import { loadNickname, saveNickname, loadAvatar, saveAvatar, loadDefaultTimer, loadFavoriteGame } from '../net/prefs';
import { defaultAvatar } from '../core/avatars';
import { useI18n } from '../i18n';
import { useAccount } from '../hooks/useAccount';
import { GAME_CATALOG, GAME_TYPES, normalizeFavoriteGame, type GameType, type GameAvailability } from '../games/catalog';
import type { DurakVariant } from '../games/durak/types';
import type { DebercMatchSize } from '../games/deberc/types';
import AccountBar from './menu/AccountBar';
import ProfileMenu from './ProfileMenu';
import SelectMenu from './components/SelectMenu';
import GameIcon from './components/GameIcon';
import GameHelpModal from './components/GameHelpModal';
import { gameIconSrc } from '../visual/visualAssets';
import { setCardBackStyle } from './components/cardBackStore';
import { setCardFaceTheme } from './components/cardFaceStore';
import { setMotionPreference } from './components/motionPreferenceStore';

const ENV_WS_URL = (import.meta.env as Record<string, string | undefined>).VITE_WS_URL;

/** A unique-ish default name so two fresh devices don't both start as "Player". */
function defaultName(): string {
  return loadNickname() ?? `Player ${Math.floor(100 + Math.random() * 900)}`;
}

const JOIN_ERR_CODES = new Set(['ROOM_NOT_FOUND', 'ROOM_FULL', 'BAD_PASSWORD', 'NAME_TAKEN', 'GAME_ALREADY_STARTED']);

interface Props {
  /** Start a local game of the selected type (King unchanged; Durak prototype). */
  onLocal: (gameType: GameType) => void;
  onOnline: (url: string, intent: OnlineIntent) => void;
  /** A join error carried back from a failed attempt (highlights the field). */
  initialError?: ErrorCode | null;
}

type Pane = 'menu' | 'host' | 'join' | 'local' | 'profile';

export default function StartMenu({ onLocal, onOnline, initialError }: Props) {
  const { t } = useI18n();
  const errText = (code: ErrorCode) =>
    t(JOIN_ERR_CODES.has(code) || code === 'KICKED_BY_HOST' ? `err.${code}` : 'err.generic');

  const [pane, setPane] = useState<Pane>(initialError ? 'join' : 'menu');
  const [joinError, setJoinError] = useState<ErrorCode | null>(initialError ?? null);
  const [resumable, setResumable] = useState(() => loadSession());

  const [name, setName] = useState(defaultName);
  const [avatar, setAvatar] = useState<string>(() => loadAvatar() ?? defaultAvatar(loadNickname() ?? 'King'));
  // Connection (Stage 14.2): default server unless the user set a CUSTOM one in
  // Profile → Advanced connection. `url` is derived — no server input on the menu.
  const [customServer, setCustomServer] = useState<string | null>(() => loadCustomServer());
  const url = resolveServerUrl(customServer, ENV_WS_URL);
  const [code, setCode] = useState('');
  // The room code that arrived via an invite link (`?room=`), or null. Drives the
  // Join-sheet invite banner + the resume-vs-invited choice (Stage 18.2).
  const [invitedCode, setInvitedCode] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [modeSelectionType, setModeSelectionType] = useState<'fixed' | 'dealer_choice'>('dealer_choice');
  const [durakVariant, setDurakVariant] = useState<DurakVariant>('simple');
  const [debercMatchSize, setDebercMatchSize] = useState<DebercMatchSize>('small');
  const [defaultTimer, setDefaultTimer] = useState<number>(() => loadDefaultTimer());
  // Favorite game (Stage 13.3): the persisted default that pre-selects the picker.
  const [favoriteGame, setFavoriteGame] = useState<GameType>(() => loadFavoriteGame());
  // The game is chosen inside the Host / Local setup sheets (Stage 9.9) — not on
  // the main menu — so it carries through to host()/onLocal(). Seeded from the
  // favorite; opening a setup sheet re-seeds it (see openLocal/openHost).
  const [gameType, setGameType] = useState<GameType>(() => loadFavoriteGame());

  /** Favorite change from Profile: persist happens in ProfilePanel; here we keep
   *  the live picker default in sync so the next Local/Host reflects the choice. */
  function pickFavorite(g: GameType) { setFavoriteGame(g); setGameType(g); }
  function openLocal() { setGameType(favoriteGame); setPane('local'); }
  function openHost() { setGameType(favoriteGame); setPane('host'); }

  const account = useAccount(url);
  const roomList = useRoomList();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [needPassword, setNeedPassword] = useState(initialError === 'BAD_PASSWORD');
  // Client-only room-browser view controls (never touches the server payload).
  const [gameFilter, setGameFilter] = useState<GameFilter>('all');
  const [roomSort, setRoomSort] = useState<RoomSort>('open');
  const [nowTick, setNowTick] = useState(() => Date.now()); // drives the "updated Ns ago" label

  const roomCounts = useMemo(() => countRoomsByGame(roomList.rooms), [roomList.rooms]);
  const visibleRooms = useMemo(
    () => sortRooms(filterRooms(roomList.rooms, gameFilter), roomSort),
    [roomList.rooms, gameFilter, roomSort],
  );
  const ago = roomListAgo(roomList.lastUpdatedAt, nowTick);
  const updatedLabel = ago.state === 'never' ? t('join.notUpdated')
    : ago.state === 'now' ? t('join.updatedJustNow')
      : t('join.updatedAgo').replace('{n}', ago.unit);

  // Pull server-side profile/settings into the local fields once they hydrate
  // (so a signed-in player sees their saved name/avatar/timer across devices).
  useEffect(() => {
    const m = account.me;
    if (m?.authenticated && m.user) {
      if (m.user.displayName) setName(m.user.displayName);
      if (m.settings?.avatar) setAvatar(m.settings.avatar);
      // Apply the signed-in player's card-back style across devices (Stage 13.0).
      if (m.settings?.cardStyle) setCardBackStyle(m.settings.cardStyle);
      // Apply the signed-in player's card face theme (Stage 13.5).
      if (m.settings?.cardFaceTheme) setCardFaceTheme(m.settings.cardFaceTheme);
      // Apply the signed-in player's animation-intensity preference (Stage 13.2).
      if (m.settings?.animationPreference) setMotionPreference(m.settings.animationPreference);
      // Apply the signed-in player's favorite game as the picker default (Stage 13.3).
      if (m.settings?.favoriteGame) {
        const fav = normalizeFavoriteGame(m.settings.favoriteGame);
        setFavoriteGame(fav); setGameType(fav);
      }
    }
  }, [account.me]);
  useEffect(() => {
    if (account.serverTimer != null) setDefaultTimer(account.serverTimer);
  }, [account.serverTimer]);

  // Invite link (Stage 18.1 + edge cases 18.2): if the app was opened with `?room=`,
  // PREFILL the Join sheet with a VALID code and consume the param — never auto-join
  // (the user still presses Join, so a missing name / active game is never disrupted).
  // An INVALID/blank code is ignored quietly (no broken sheet) but the param is still
  // consumed so it can't linger. A saved resumable room is left intact — the Join sheet
  // surfaces a Resume-vs-Join choice. Runs once on mount; StartMenu only renders
  // pre-game, so a link opened mid-reconnect is a no-op.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const search = window.location.search;
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    if (!params.has(INVITE_ROOM_PARAM)) return; // no invite → nothing to do
    const invited = roomCodeFromQuery(search); // normalized (upper/trim) or null
    if (invited) {
      setInvitedCode(invited);
      setCode(invited);
      setPane('join');
    }
    // Consume the param either way (valid or not) so a refresh/back doesn't re-trigger.
    params.delete(INVITE_ROOM_PARAM);
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, []);

  // Room browser auto-refresh: while the Join pane is open, poll the room list on
  // a timer (the hook skips a tick if a fetch is still in flight, so requests never
  // overlap). Manual Refresh + the immediate fetch on open still work. Stops when
  // leaving the pane (cleanup). No protocol change — it just re-issues LIST_ROOMS.
  useEffect(() => {
    if (pane !== 'join') return;
    const id = setInterval(() => roomList.refresh(url), ROOM_AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [pane, url, roomList.refresh]);

  // Tick the local clock so the "updated Ns ago" label stays fresh without hitting
  // the server. Runs only while the Join pane is open.
  useEffect(() => {
    if (pane !== 'join') return;
    const id = setInterval(() => setNowTick(Date.now()), ROOM_AGO_TICK_MS);
    return () => clearInterval(id);
  }, [pane]);

  function resume() {
    if (!resumable) return;
    onOnline(resumable.serverUrl, {
      kind: 'resume', code: resumable.roomCode,
      reconnectToken: resumable.reconnectToken, name: resumable.playerName,
    });
  }
  function forgetResumable() { clearSession(); setResumable(null); }

  function host() {
    if (!name.trim() || !url.trim()) return;
    // Tarneeb (and any future game) with no online support cannot be hosted yet.
    if (!GAME_CATALOG[gameType].supportsOnline) return;
    saveNickname(name); saveAvatar(avatar);
    const pw = password.trim();
    onOnline(url.trim(), {
      kind: 'create', name: name.trim(), modeSelectionType, avatar,
      ...(gameType === 'durak' ? { gameType: 'durak' as const, variant: durakVariant } : {}),
      ...(gameType === 'deberc' ? { gameType: 'deberc' as const, matchSize: debercMatchSize } : {}),
      ...(gameType === 'tarneeb' ? { gameType: 'tarneeb' as const } : {}),
      ...(gameType === 'preferans' ? { gameType: 'preferans' as const } : {}),
      ...(defaultTimer > 0 ? { turnTimerSec: defaultTimer } : {}),
      ...(pw ? { password: pw } : {}),
    });
  }

  function join() {
    if (!name.trim() || !url.trim() || code.trim().length < 4) return;
    saveNickname(name); saveAvatar(avatar);
    const pw = password.trim();
    onOnline(url.trim(), {
      kind: 'join', code: code.trim().toUpperCase(), name: name.trim(), avatar,
      ...(pw ? { password: pw } : {}),
    });
  }

  function openJoin() {
    setPane('join'); setNeedPassword(false);
    setGameFilter('all'); setRoomSort('open'); // reset the browser view each open
    roomList.refresh(url);
  }

  function pickRoom(room: RoomSummary) {
    if (room.status !== 'lobby') return;
    setCode(room.code);
    if (room.hasPassword) {
      setPassword(''); setNeedPassword(true);
      setTimeout(() => passwordRef.current?.focus(), 0);
      return;
    }
    setNeedPassword(false);
    if (!name.trim() || !url.trim()) return;
    saveNickname(name); saveAvatar(avatar);
    onOnline(url.trim(), { kind: 'join', code: room.code, name: name.trim(), avatar });
  }

  return (
    <div className="screen menu-screen">
      <AccountBar account={account} name={name} avatar={avatar} />

      <header className="menu-header">
        <h1 className="menu-title">{t('app.title')}</h1>
        <p className="menu-tagline">{t('app.subtitle')}</p>
      </header>

      {pane === 'menu' && (
        <div className="menu-main">
          {resumable && (
            <div className="continue-block">
              <button className="continue-card" onClick={resume}>
                <span className="continue-card__icon" aria-hidden="true">↩</span>
                <span className="continue-card__text">
                  <span className="continue-card__title">{t('menu.resumeTitle')}</span>
                  <span className="continue-card__detail">{resumable.roomCode} · {resumable.playerName}</span>
                </span>
                <span className="continue-card__go" aria-hidden="true">▶</span>
              </button>
              <button className="link-btn" onClick={forgetResumable}>{t('menu.forget')}</button>
            </div>
          )}

          <div className="action-tiles">
            <button className="tile tile--primary" onClick={openLocal}>
              <span className="tile__icon" aria-hidden="true">📱</span>
              <span className="tile__text">
                <span className="tile__title">{t('menu.localTitle')}</span>
                <span className="tile__sub">{t('menu.localSub')}</span>
              </span>
            </button>
            <button className="tile" onClick={openHost}>
              <span className="tile__icon" aria-hidden="true">🌐</span>
              <span className="tile__text">
                <span className="tile__title">{t('menu.hostTitle')}</span>
                <span className="tile__sub">{t('menu.hostSub')}</span>
              </span>
            </button>
            <button className="tile" onClick={openJoin}>
              <span className="tile__icon" aria-hidden="true">🔑</span>
              <span className="tile__text">
                <span className="tile__title">{t('menu.joinTitle')}</span>
                <span className="tile__sub">{t('menu.joinSub')}</span>
              </span>
            </button>
            <button className="tile" onClick={() => setPane('profile')}>
              <span className="tile__icon" aria-hidden="true">⚙️</span>
              <span className="tile__text">
                <span className="tile__title">{t('menu.profileTitle')}</span>
                <span className="tile__sub">{t('menu.profileSub')}</span>
              </span>
            </button>
          </div>
        </div>
      )}

      {pane === 'profile' && (
        <div className="sheet">
          <div className="sheet__head">
            <h2 className="sheet__title">{t('menu.profileTitle')}</h2>
            <button className="btn btn--ghost btn--small" onClick={() => setPane('menu')}>{t('btn.backToMenu')}</button>
          </div>
          <ProfileMenu account={account}
            name={name} onName={setName} avatar={avatar} onAvatar={setAvatar}
            defaultTimer={defaultTimer} onDefaultTimer={setDefaultTimer}
            favoriteGame={favoriteGame} onFavoriteGame={pickFavorite}
            customServer={customServer} onCustomServer={setCustomServer} />
        </div>
      )}

      {pane === 'local' && (
        <div className="sheet">
          <div className="sheet__head">
            <h2 className="sheet__title">{t('menu.localSetupTitle')}</h2>
            <span className="sheet__who"><span aria-hidden="true">{avatar}</span> {name}</span>
          </div>
          <GamePicker gameType={gameType} onPick={setGameType} t={t} mode="local" />
          <button type="button" className="btn btn--primary sheet__cta" onClick={() => onLocal(gameType)}>
            {t('menu.startLocal')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setPane('menu')}>{t('btn.backToMenu')}</button>
        </div>
      )}

      {(pane === 'host' || pane === 'join') && (
        <div className="sheet">
          <div className="sheet__head">
            <h2 className="sheet__title">{pane === 'host' ? t('host.title') : t('join.title')}</h2>
            <span className="sheet__who"><span aria-hidden="true">{avatar}</span> {name}</span>
          </div>

          {joinError && (
            <p className="lobby-error">
              {errText(joinError)} <span className="error-code">({joinError})</span>
            </p>
          )}
          {joinError === 'NAME_TAKEN' && resumable && resumable.roomCode === code.trim().toUpperCase() && (
            <button className="btn btn--primary" onClick={resume}>{t('menu.resume')}</button>
          )}

          {/* Invite banner (Stage 18.2): shown while the invited code is still the one
              in the field. If a DIFFERENT room is saved, offer a clear Resume-vs-Join
              choice (never auto-anything); otherwise a gentle "check your name" nudge. */}
          {pane === 'join' && invitedCode && code.trim().toUpperCase() === invitedCode && (
            <div className="invite-banner">
              <p className="invite-banner__room">
                🔗 {t('invite.invitedRoom')}: <strong>{invitedCode}</strong>
              </p>
              {resumable && resumable.roomCode !== invitedCode ? (
                <>
                  <p className="invite-banner__conflict">⚠️ {t('invite.resumeConflict')}</p>
                  <div className="button-row">
                    <button type="button" className="btn btn--outline btn--small" onClick={resume}>
                      {t('invite.resumeCurrent')} ({resumable.roomCode})
                    </button>
                    <button type="button" className="btn btn--primary btn--small" onClick={join}>
                      {t('invite.joinInvited')}
                    </button>
                  </div>
                </>
              ) : (
                <p className="field__hint invite-banner__hint">{t('invite.checkName')}</p>
              )}
            </div>
          )}

          <div className="field">
            <label className="field__label">{t('form.name')}</label>
            {/* Display name is read-only here — it is changed only in Profile (Stage 9.10). */}
            <div className={`name-readonly ${joinError === 'NAME_TAKEN' ? 'name-readonly--error' : ''}`}>
              <span className="member-avatar" aria-hidden="true">{avatar}</span>
              <span className="name-readonly__name">{name}</span>
            </div>
            <p className="field__hint">{t('menu.nameInProfile')}</p>
          </div>
          {/* No server address here (Stage 14.2): the app auto-uses the default
              server; a custom server lives in Profile → Advanced connection. */}

          {pane === 'host' && (
            <>
              <GamePicker gameType={gameType} onPick={setGameType} t={t} mode="host" />
              {gameType === 'durak' && (
                <div className="field">
                  <label className="field__label">{t('durak.variant')}</label>
                  <div className="segmented segmented--inline">
                    {(['simple', 'transfer'] as const).map((v) => (
                      <button key={v} type="button"
                        className={`segmented__tab ${durakVariant === v ? 'segmented__tab--active' : ''}`}
                        onClick={() => setDurakVariant(v)}>
                        {v === 'simple' ? t('durak.variantSimple') : t('durak.variantTransfer')}
                      </button>
                    ))}
                  </div>
                  <p className="durak-variant-desc">{durakVariant === 'simple' ? t('durak.simpleDesc') : t('durak.transferDesc')}</p>
                </div>
              )}
              {gameType === 'deberc' && (
                <div className="field">
                  <label className="field__label">{t('deberc.matchSize')}</label>
                  <div className="segmented segmented--inline">
                    {(['small', 'big'] as const).map((m) => (
                      <button key={m} type="button"
                        className={`segmented__tab ${debercMatchSize === m ? 'segmented__tab--active' : ''}`}
                        onClick={() => setDebercMatchSize(m)}>
                        {m === 'small' ? t('deberc.small') : t('deberc.big')}
                      </button>
                    ))}
                  </div>
                  <p className="durak-variant-desc">{debercMatchSize === 'small' ? t('deberc.smallDesc') : t('deberc.bigDesc')}</p>
                </div>
              )}
              {gameType === 'tarneeb' && (
                <div className="field">
                  <p className="durak-variant-desc">{t('tarneeb.setupTagline')}</p>
                </div>
              )}
              {gameType === 'preferans' && (
                <div className="field">
                  <p className="durak-variant-desc">{t('preferans.setupTagline')}</p>
                </div>
              )}
              {gameType === 'king' && (
                <div className="field">
                  <label className="field__label">{t('form.mode')}</label>
                  <div className="segmented segmented--inline">
                    {(['dealer_choice', 'fixed'] as const).map((m) => (
                      <button key={m} type="button"
                        className={`segmented__tab ${modeSelectionType === m ? 'segmented__tab--active' : ''}`}
                        onClick={() => setModeSelectionType(m)}>
                        {m === 'dealer_choice' ? t('form.dealerChoice') : t('form.fixedOrder')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="field">
                <label className="field__label">{t('form.passwordHost')}</label>
                <input className="input" type="password" value={password} maxLength={40}
                  onChange={(e) => setPassword(e.target.value)} />
              </div>
              {!GAME_CATALOG[gameType].supportsOnline && (
                <p className="lobby-error">{t('tarneeb.onlineSoon')}</p>
              )}
              <button className="btn btn--primary btn--large" onClick={host}
                disabled={!GAME_CATALOG[gameType].supportsOnline}>{t('btn.create')}</button>
            </>
          )}

          {pane === 'join' && (
            <>
              <div className="field">
                <div className="room-list-head">
                  <label className="field__label">{t('join.openRooms')}</label>
                  <span className="room-updated" aria-live="polite">{updatedLabel}</span>
                  <button className="btn btn--ghost btn--small" onClick={() => roomList.refresh(url)}
                    disabled={roomList.loading}>{roomList.loading ? `${t('btn.refresh')}…` : t('btn.refresh')}</button>
                </div>

                {/* A failed refresh keeps the last-known list — soft-warn instead of
                    wiping it. Only hard-error when there is nothing to show. */}
                {roomList.error && (
                  roomList.rooms.length > 0
                    ? <p className="setup-hint room-stale">⚠️ {t('join.staleWarning')}</p>
                    : <p className="lobby-error">{t(`roomList.${roomList.error}`)}</p>
                )}
                {roomList.loading && roomList.rooms.length === 0 && (
                  <p className="setup-hint">{t('net.connecting')}…</p>
                )}
                {!roomList.error && !roomList.loading && roomList.rooms.length === 0 && (
                  <p className="setup-hint">{t('join.noRooms')}</p>
                )}

                {roomList.rooms.length > 0 && (
                  <>
                    <div className="room-filter-bar">
                      <div className="room-filter" role="group" aria-label={t('join.filterGame')}>
                        {(['all', ...GAME_TYPES] as GameFilter[]).map((g) => (
                          <button key={g} type="button"
                            className={`room-filter__chip ${gameFilter === g ? 'room-filter__chip--on' : ''}`}
                            aria-pressed={gameFilter === g}
                            aria-label={`${g === 'all' ? t('join.all') : t(`gameType.${g}`)} (${roomCounts[g] ?? 0})`}
                            onClick={() => setGameFilter(g)}>
                            {g === 'all'
                              ? <span aria-hidden="true">{t('join.all')}</span>
                              : <GameIcon game={g} size="sm" />}
                            <span className="room-filter__count">{roomCounts[g] ?? 0}</span>
                          </button>
                        ))}
                      </div>
                      <SelectMenu
                        ariaLabel={t('join.sortBy')}
                        className="room-sort"
                        value={roomSort}
                        onChange={(v) => setRoomSort(v as RoomSort)}
                        options={ROOM_SORTS.map((s) => ({ value: s, label: t(`join.sort.${s}`) }))}
                      />
                    </div>

                    {visibleRooms.length === 0 ? (
                      <p className="setup-hint">{t('join.noRoomsForGame')}</p>
                    ) : (
                  <div className="server-browser" role="table" aria-label={t('join.openRooms')}>
                    <div className="server-browser__head" role="row">
                      <span role="columnheader">{t('join.col.host')}</span>
                      <span role="columnheader">{t('join.col.game')}</span>
                      <span role="columnheader">{t('join.col.players')}</span>
                      <span role="columnheader">{t('join.col.password')}</span>
                      <span role="columnheader">{t('join.col.connection')}</span>
                      <span role="columnheader">{t('join.col.status')}</span>
                    </div>
                    <ul className="server-browser__body">
                      {visibleRooms.map((r) => {
                        const joinable = r.status === 'lobby';
                        const gameType = r.gameType ?? 'king';
                        const online = r.hostConnected;
                        const statusLabel = t(`status.${r.status}`);
                        return (
                          <li key={r.code}>
                            <button
                              type="button" role="row"
                              className={`server-browser__row server-browser__row--${r.status} ${code === r.code ? 'server-browser__row--selected' : ''}`}
                              onClick={() => pickRoom(r)} disabled={!joinable}
                              aria-disabled={!joinable} title={joinable ? r.code : statusLabel}>
                              <span className="sb-cell sb-host" data-label={t('join.col.host')} role="cell">
                                <span className="sb-host__avatar" aria-hidden="true">{r.hostAvatar}</span>
                                <span className="sb-host__meta">
                                  <span className="sb-host__name">{r.hostName}</span>
                                  <span className="sb-host__code">{r.code}</span>
                                </span>
                                <span className={`sb-dot ${online ? 'sb-dot--on' : 'sb-dot--off'}`} aria-hidden="true" />
                              </span>
                              <span className="sb-cell sb-game" data-label={t('join.col.game')} role="cell">
                                <span className="sb-game__val">
                                  <GameIcon game={gameType} size="sm" className="sb-game__icon" />
                                  <span className="sb-game__name">{t(`gameType.${gameType}`)}</span>
                                  {r.variant ? <span className="sb-variant"> · {t(`durak.variant${r.variant === 'transfer' ? 'Transfer' : 'Simple'}`)}</span> : null}
                                  {r.matchSize ? <span className="sb-variant"> · {t(r.matchSize === 'big' ? 'deberc.big' : 'deberc.small')}</span> : null}
                                  {gameType === 'tarneeb' ? <span className="sb-variant"> · {t('tarneeb.twoTeams')}</span> : null}
                                  {gameType === 'preferans' ? <span className="sb-variant"> · {t('preferans.metaShort')}</span> : null}
                                </span>
                              </span>
                              <span className="sb-cell sb-players" data-label={t('join.col.players')} role="cell">
                                {r.occupiedSeats}/{r.playerCount}
                              </span>
                              <span className="sb-cell sb-pass" data-label={t('join.col.password')} role="cell">
                                {r.hasPassword
                                  ? <span className="sb-lock">🔒 {t('join.locked')}</span>
                                  : <span className="sb-open">{t('join.open')}</span>}
                              </span>
                              <span className="sb-cell sb-conn" data-label={t('join.col.connection')} role="cell">
                                <span className={`sb-dot ${online ? 'sb-dot--on' : 'sb-dot--off'}`} aria-hidden="true" />
                                {online ? t('join.good') : t('join.poor')}
                              </span>
                              <span className="sb-cell sb-status" data-label={t('join.col.status')} role="cell">
                                <span className={`tag room-list__status--${r.status}`}>{statusLabel}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                    )}
                  </>
                )}
              </div>

              <div className="field">
                <label className="field__label">{t('join.roomCode')}</label>
                <input className="input room-code-input" value={code} maxLength={4}
                  onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD" />
                <p className="field__hint">{t('join.tapHint')}</p>
              </div>
              <div className="field">
                <label className="field__label">{t('form.passwordJoin')}</label>
                <input ref={passwordRef}
                  className={`input ${joinError === 'BAD_PASSWORD' ? 'input--error' : ''}`}
                  type="password" value={password} maxLength={40}
                  onChange={(e) => { setPassword(e.target.value); if (joinError === 'BAD_PASSWORD') setJoinError(null); }}
                  placeholder={needPassword ? '🔒' : ''} />
                {needPassword && <p className="field__hint">🔒 {t('form.passwordJoin')}</p>}
              </div>
              <button className="btn btn--primary btn--large" onClick={join}>{t('btn.join')}</button>
            </>
          )}

          <button className="btn btn--ghost" onClick={() => setPane('menu')}>{t('btn.back')}</button>
        </div>
      )}
    </div>
  );
}

/** Per-game glyph + a short descriptor key for the picker sublabel. */
const GAME_ICON: Record<GameType, string> = { king: '👑', durak: '🃏', deberc: '🎴', tarneeb: '♠️', preferans: '🎩' };
const GAME_META_KEY: Record<GameType, string> = {
  king: 'king.modesShort', durak: 'durak.variantsShort', deberc: 'deberc.matchShort', tarneeb: 'tarneeb.twoTeams',
  preferans: 'preferans.metaShort', // "Contract" — Preferans is a solo contract trick game (3p)
};

/** "3–4" / "4" player-count range from the catalog (data-driven, all games). */
export function playersRange(id: GameType): string {
  const e = GAME_CATALOG[id];
  return e.minPlayers === e.maxPlayers ? `${e.minPlayers}` : `${e.minPlayers}–${e.maxPlayers}`;
}

/**
 * Compact game picker — a custom dropdown. Each option shows the game name + a
 * `👥 <players> · <short meta>` subtitle (player-count from the catalog, so it
 * scales to every game without per-game code).
 *
 * Gating is per `mode` (Stage 19.3): a game is selectable when it supports THIS
 * mode (`supportsLocal` locally / `supportsOnline` when hosting); otherwise it is
 * shown DISABLED with a "coming soon" note. A game that IS supported but still
 * `experimental` (e.g. Preferans local) is selectable and flagged "Experimental".
 * SelectMenu ignores clicks on a disabled option.
 */
function GamePicker({ gameType, onPick, t, mode }: {
  gameType: GameType;
  onPick: (g: GameType) => void;
  t: (key: string) => string;
  mode: 'local' | 'host';
}) {
  const [showHelp, setShowHelp] = useState(false);
  const options = GAME_TYPES.map((id) => {
    const entry = GAME_CATALOG[id];
    const usable = mode === 'host' ? entry.supportsOnline : entry.supportsLocal;
    // Cast widens the (literal-narrowed) status so the forward-compat experimental
    // branch stays valid even when every catalog entry is currently `available`.
    const experimental = (entry.status as GameAvailability) === 'experimental';
    const meta = !usable
      ? t('menu.comingSoon')
      : experimental ? t('menu.experimental') : t(GAME_META_KEY[id]);
    return {
      value: id,
      label: t(`gameType.${id}`),
      icon: GAME_ICON[id],           // emoji fallback if the emblem PNG 404s
      iconSrc: gameIconSrc(id),      // Stage 12.3 image emblem
      sublabel: `👥 ${playersRange(id)} · ${meta}`,
      disabled: !usable,
    };
  });
  return (
    <div className="field">
      <label className="field__label">{t('menu.game')}</label>
      <SelectMenu
        ariaLabel={t('menu.game')}
        className="game-picker"
        value={gameType}
        onChange={(v) => onPick(v as GameType)}
        options={options}
      />
      {/* Quick-rules sheet for the selected game (Stage 22.0) — generic, one modal
          for every game from the help catalog + i18n. */}
      <button type="button" className="btn btn--ghost btn--small game-help-trigger"
        onClick={() => setShowHelp(true)}>❓ {t('help.howToPlay')}</button>
      {showHelp && <GameHelpModal game={gameType} onClose={() => setShowHelp(false)} />}
    </div>
  );
}
