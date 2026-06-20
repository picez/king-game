import { useRef, useState } from 'react';
import type { OnlineIntent } from '../hooks/useNetworkGame';
import { useRoomList } from '../hooks/useRoomList';
import type { RoomSummary } from '../net/messages';
import { defaultServerUrl, isInsecureWsOnSecurePage } from '../net/online';
import type { ErrorCode } from '../net/messages';
import { loadSession, clearSession } from '../net/session';
import { loadNickname, saveNickname } from '../net/prefs';
import { useI18n, LanguageSelector } from '../i18n';

const ENV_WS_URL = (import.meta.env as Record<string, string | undefined>).VITE_WS_URL;

/** A unique-ish default name so two fresh devices don't both start as "Player". */
function defaultName(): string {
  return loadNickname() ?? `Player ${Math.floor(100 + Math.random() * 900)}`;
}

const JOIN_ERR_CODES = new Set(['ROOM_NOT_FOUND', 'ROOM_FULL', 'BAD_PASSWORD', 'NAME_TAKEN', 'GAME_ALREADY_STARTED']);

interface Props {
  onLocal: () => void;
  onOnline: (url: string, intent: OnlineIntent) => void;
  /** A join error carried back from a failed attempt (highlights the field). */
  initialError?: ErrorCode | null;
}

type Pane = 'menu' | 'host' | 'join';

export default function StartMenu({ onLocal, onOnline, initialError }: Props) {
  const { t } = useI18n();
  const errText = (code: ErrorCode) =>
    t(JOIN_ERR_CODES.has(code) || code === 'KICKED_BY_HOST' ? `err.${code}` : 'err.generic');

  const [pane, setPane] = useState<Pane>(initialError ? 'join' : 'menu');
  const [joinError, setJoinError] = useState<ErrorCode | null>(initialError ?? null);
  const [resumable, setResumable] = useState(() => loadSession());

  const [name, setName] = useState(defaultName);
  const [url, setUrl] = useState(() => defaultServerUrl(undefined, ENV_WS_URL));
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [playerCount, setPlayerCount] = useState<3 | 4>(4);
  const [modeSelectionType, setModeSelectionType] = useState<'fixed' | 'dealer_choice'>('dealer_choice');

  const roomList = useRoomList();
  const passwordRef = useRef<HTMLInputElement>(null);
  const [needPassword, setNeedPassword] = useState(initialError === 'BAD_PASSWORD');

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
    saveNickname(name);
    const pw = password.trim();
    onOnline(url.trim(), {
      kind: 'create', name: name.trim(), playerCount, modeSelectionType,
      ...(pw ? { password: pw } : {}),
    });
  }

  function join() {
    if (!name.trim() || !url.trim() || code.trim().length < 4) return;
    saveNickname(name);
    const pw = password.trim();
    onOnline(url.trim(), {
      kind: 'join', code: code.trim().toUpperCase(), name: name.trim(),
      ...(pw ? { password: pw } : {}),
    });
  }

  function openJoin() { setPane('join'); setNeedPassword(false); roomList.refresh(url); }

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
    saveNickname(name);
    onOnline(url.trim(), { kind: 'join', code: room.code, name: name.trim() });
  }

  return (
    <div className="screen setup-screen">
      <div className="topbar"><LanguageSelector /></div>
      <h1 className="screen__title">{t('app.title')}</h1>
      <p className="screen__subtitle">{t('app.subtitle')}</p>

      <div className="setup-card">
        {pane === 'menu' && (
          <>
            {resumable && (
              <div className="resume-panel">
                <p className="resume-panel__title">{t('menu.resumeTitle')}</p>
                <p className="resume-panel__detail">
                  {resumable.roomCode} · {resumable.playerName}
                  <span className="resume-panel__server"> · {resumable.serverUrl}</span>
                </p>
                <div className="button-row">
                  <button className="btn btn--primary" onClick={resume}>{t('menu.resume')}</button>
                  <button className="btn btn--ghost" onClick={forgetResumable}>{t('menu.forget')}</button>
                </div>
              </div>
            )}

            <h2>{t('menu.play')}</h2>
            <button className="btn btn--primary btn--large" onClick={onLocal}>{t('menu.local')}</button>
            <button className="btn btn--outline btn--large" onClick={() => setPane('host')}>{t('menu.host')}</button>
            <button className="btn btn--outline btn--large" onClick={openJoin}>{t('menu.join')}</button>
          </>
        )}

        {pane !== 'menu' && (
          <>
            <h2>{pane === 'host' ? t('host.title') : t('join.title')}</h2>

            {joinError && (
              <p className="lobby-error">
                {errText(joinError)} <span className="error-code">({joinError})</span>
              </p>
            )}
            {/* If the name clash is the player's own offline seat, offer Resume. */}
            {joinError === 'NAME_TAKEN' && resumable && resumable.roomCode === code.trim().toUpperCase() && (
              <button className="btn btn--primary" onClick={resume}>{t('menu.resume')}</button>
            )}

            <div className="field-group">
              <label>{t('form.name')}</label>
              <input
                className={`input ${joinError === 'NAME_TAKEN' ? 'input--error' : ''}`}
                value={name} maxLength={20}
                onChange={(e) => { setName(e.target.value); if (joinError === 'NAME_TAKEN') setJoinError(null); }}
                placeholder={t('form.name')}
              />
            </div>

            <div className="field-group">
              <label>{t('form.server')}</label>
              <input className="input" value={url}
                onChange={(e) => setUrl(e.target.value)} placeholder="ws://host-ip:3001/ws" />
              <p className="setup-hint">LAN: ws://192.168.1.20:3001/ws · Production: wss://your-domain/ws</p>
              {isInsecureWsOnSecurePage(url) && (
                <p className="lobby-error">⚠️ HTTPS page needs <code>wss://</code> (not <code>ws://</code>).</p>
              )}
            </div>

            {pane === 'host' && (
              <>
                <div className="field-group">
                  <label>{t('form.players')}</label>
                  <div className="button-row">
                    {([3, 4] as const).map((n) => (
                      <button key={n}
                        className={`btn btn--outline ${playerCount === n ? 'btn--active' : ''}`}
                        onClick={() => setPlayerCount(n)}>{n}</button>
                    ))}
                  </div>
                </div>
                <div className="field-group">
                  <label>{t('form.mode')}</label>
                  <div className="button-row">
                    {(['dealer_choice', 'fixed'] as const).map((m) => (
                      <button key={m}
                        className={`btn btn--outline ${modeSelectionType === m ? 'btn--active' : ''}`}
                        onClick={() => setModeSelectionType(m)}>
                        {m === 'dealer_choice' ? t('form.dealerChoice') : t('form.fixedOrder')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field-group">
                  <label>{t('form.passwordHost')}</label>
                  <input className="input" type="password" value={password} maxLength={40}
                    onChange={(e) => setPassword(e.target.value)} />
                </div>
                <button className="btn btn--primary btn--large" onClick={host}>{t('btn.create')}</button>
              </>
            )}

            {pane === 'join' && (
              <>
                <div className="field-group">
                  <div className="room-list-head">
                    <label>{t('join.openRooms')}</label>
                    <button className="btn btn--ghost btn--small" onClick={() => roomList.refresh(url)}
                      disabled={roomList.loading}>{t('btn.refresh')}</button>
                  </div>

                  {roomList.error && <p className="lobby-error">{roomList.error}</p>}
                  {!roomList.error && roomList.rooms.length === 0 && !roomList.loading && (
                    <p className="setup-hint">{t('join.noRooms')}</p>
                  )}

                  <ul className="room-list">
                    {roomList.rooms.map((r) => {
                      const joinable = r.status === 'lobby';
                      return (
                        <li key={r.code}>
                          <button
                            className={`room-list__item ${code === r.code ? 'room-list__item--selected' : ''}`}
                            onClick={() => pickRoom(r)} disabled={!joinable}>
                            <span className="room-list__code">
                              {r.code}{r.hasPassword && <span title="Password required"> 🔒</span>}
                            </span>
                            <span className="room-list__host">{r.hostName}</span>
                            <span className="room-list__seats">{r.occupiedSeats}/{r.playerCount}</span>
                            <span className={`tag room-list__status--${r.status}`}>{t(`status.${r.status}`)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="field-group">
                  <label>{t('join.roomCode')}</label>
                  <input className="input room-code-input" value={code} maxLength={4}
                    onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD" />
                  <p className="setup-hint">{t('join.tapHint')}</p>
                </div>
                <div className="field-group">
                  <label>{t('form.passwordJoin')}</label>
                  <input ref={passwordRef}
                    className={`input ${joinError === 'BAD_PASSWORD' ? 'input--error' : ''}`}
                    type="password" value={password} maxLength={40}
                    onChange={(e) => { setPassword(e.target.value); if (joinError === 'BAD_PASSWORD') setJoinError(null); }}
                    placeholder={needPassword ? '🔒' : ''} />
                  {needPassword && <p className="setup-hint">🔒 {t('form.passwordJoin')}</p>}
                </div>
                <button className="btn btn--primary btn--large" onClick={join}>{t('btn.join')}</button>
              </>
            )}

            <button className="btn btn--ghost" onClick={() => setPane('menu')}>{t('btn.back')}</button>
          </>
        )}
      </div>
    </div>
  );
}
