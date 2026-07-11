import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { sanitizeAvatar } from '../../core/avatars';
import {
  fetchFriends, requestFriend, acceptFriend, declineFriend, removeFriend,
  type Friend, type FriendsData, type FriendRequestOutcome,
} from '../../net/friendsApi';

interface Props {
  base: string;
  signedIn: boolean;
  /** When provided (Lobby/room), each ONLINE friend shows an "Invite" button. */
  onInvite?: (userId: string) => void;
  /** userIds already invited this session (to show "Invited ✓" and disable). */
  invited?: ReadonlySet<string>;
  /** Bumping this re-fetches (e.g. on a FRIEND_PRESENCE push). */
  refreshNonce?: number;
  /** Called after any local mutation (add/accept/decline/remove) so a parent badge can refresh. */
  onChanged?: () => void;
  /** 'full' = the Profile tab; 'invite' = a compact online-first invite list for the Lobby. */
  variant?: 'full' | 'invite';
}

/** A friend's avatar — the server-safe emoji, with the same-origin synced image on top
 *  when present (falls back to the emoji on load error). NEVER the local "me" avatar. */
function FriendAvatar({ friend }: { friend: Friend }) {
  const [imgOk, setImgOk] = useState(true);
  const emoji = sanitizeAvatar(friend.avatar ?? '', friend.displayName ?? '');
  return (
    <span className="friend-avatar" aria-hidden="true">
      {friend.avatarImageUrl && imgOk
        ? <img src={friend.avatarImageUrl} alt="" onError={() => setImgOk(false)} draggable={false} />
        : emoji}
    </span>
  );
}

/**
 * Friends panel (Stage 25.2). Signed-in only: your friend code + add-by-code, incoming
 * requests (accept/decline), outgoing pending, and the friends list (online first). All
 * over the HTTP API — no email is ever shown. With `onInvite`, online friends get an
 * Invite button (used in the Lobby). Guests see a sign-in prompt (no API calls).
 */
export default function FriendsPanel({ base, signedIn, onInvite, invited, refreshNonce = 0, onChanged, variant = 'full' }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<FriendsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // userId currently mutating
  const [errored, setErrored] = useState(false); // last fetch failed (unreachable / no-DB / migration)

  const load = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true); setErrored(false);
    try {
      const d = await fetchFriends(base);
      if (d) setData(d); else setErrored(true);
    } finally { setLoading(false); }
  }, [base, signedIn]);

  useEffect(() => { void load(); }, [load, refreshNonce]);

  const addOutcomeMsg = (o: FriendRequestOutcome): string => t(`friends.add.${o}`);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const code = codeInput.trim();
    if (!code) return;
    setAddMsg(null);
    const outcome = await requestFriend(base, code);
    setAddMsg(addOutcomeMsg(outcome));
    if (outcome === 'created' || outcome === 'accepted') { setCodeInput(''); await load(); onChanged?.(); }
  }
  async function act(userId: string, fn: () => Promise<boolean>) {
    setBusy(userId);
    try { if (await fn()) { await load(); onChanged?.(); } } finally { setBusy(null); }
  }
  function copyCode() {
    if (!data?.friendCode) return;
    void navigator.clipboard?.writeText(data.friendCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }

  // Compact Lobby invite block (Stage 25.8): always visible, online-first, with clear empty /
  // guest states so a player can always find "invite a friend" while hosting a room.
  if (variant === 'invite') {
    const list = data?.friends ?? [];
    return (
      <div className="friends-invite">
        <div className="friends-invite__head">
          <span className="friends-invite__title">👥 {t('friends.inviteFriends')}</span>
          {signedIn && (
            <button type="button" className="btn btn--ghost btn--small" onClick={() => void load()}
              disabled={loading} aria-label={t('friends.refresh')} title={t('friends.refresh')}>↻</button>
          )}
        </div>
        {!signedIn && <p className="field__hint">{t('friends.signInToInvite')}</p>}
        {signedIn && loading && !data && <p className="field__hint">{t('friends.loading')}</p>}
        {signedIn && !loading && errored && (
          <p className="field__hint friends-invite__error">
            {t('friends.loadError')}{' '}
            <button type="button" className="btn btn--ghost btn--small" onClick={() => void load()}>{t('account.retry')}</button>
          </p>
        )}
        {signedIn && !loading && !errored && list.length === 0 && <p className="field__hint">{t('friends.addInProfile')}</p>}
        {signedIn && !errored && list.map((f) => (
          <div key={f.userId} className={`friend-row ${f.online ? 'friend-row--online' : 'friend-row--offline'}`}>
            <FriendAvatar friend={f} />
            <span className="friend-row__name">{f.displayName ?? t('account.guestShort')}</span>
            <span className={`friend-status ${f.online ? 'friend-status--online' : 'friend-status--offline'}`}>
              <span className="friend-status__dot" aria-hidden="true" />
              {f.online ? t('friends.online') : t('friends.offline')}
            </span>
            <span className="friend-row__actions">
              {f.online
                ? (invited?.has(f.userId)
                    ? <span className="friend-row__invited">✓ {t('friends.invited')}</span>
                    : <button type="button" className="btn btn--outline btn--small" onClick={() => onInvite?.(f.userId)}>{t('friends.invite')}</button>)
                : <button type="button" className="btn btn--outline btn--small" disabled title={t('friends.friendOffline')}>{t('friends.invite')}</button>}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (!signedIn) {
    return <p className="friends-guest field__hint">{t('friends.guestCta')}</p>;
  }

  const friends = data?.friends ?? [];
  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];

  return (
    <div className="friends-panel">
      {/* Your friend code + copy + add-by-code */}
      <div className="friends-code">
        <span className="friends-code__label">{t('friends.yourCode')}</span>
        <code className="friends-code__value">{data?.friendCode ?? '…'}</code>
        <button type="button" className="btn btn--ghost btn--small" onClick={copyCode} disabled={!data?.friendCode}>
          {copied ? `✓ ${t('friends.copied')}` : t('friends.copy')}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void load()} disabled={loading}
          aria-label={t('friends.refresh')} title={t('friends.refresh')}>↻</button>
      </div>
      <form className="friends-add" onSubmit={onAdd}>
        <input className="input" value={codeInput} onChange={(e) => setCodeInput(e.target.value)}
          placeholder={t('friends.addPlaceholder')} maxLength={16} autoCapitalize="characters" spellCheck={false} />
        <button type="submit" className="btn btn--primary btn--small">{t('friends.add')}</button>
      </form>
      {addMsg && <p className="friends-add__msg field__hint">{addMsg}</p>}

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <div className="friends-section">
          <h4 className="friends-section__head">{t('friends.requests')} ({incoming.length})</h4>
          {incoming.map((f) => (
            <div key={f.userId} className="friend-row">
              <FriendAvatar friend={f} />
              <span className="friend-row__name">{f.displayName ?? t('account.guestShort')}</span>
              <span className="friend-row__actions">
                <button type="button" className="btn btn--primary btn--small" disabled={busy === f.userId}
                  onClick={() => void act(f.userId, () => acceptFriend(base, f.userId))}>{t('friends.accept')}</button>
                <button type="button" className="btn btn--ghost btn--small" disabled={busy === f.userId}
                  onClick={() => void act(f.userId, () => declineFriend(base, f.userId))}>{t('friends.decline')}</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Friends list (online first) */}
      <div className="friends-section">
        <h4 className="friends-section__head">{t('friends.title')}{friends.length > 0 ? ` (${friends.length})` : ''}</h4>
        {friends.length === 0 && !loading && <p className="field__hint">{t('friends.empty')}</p>}
        {/* Menu context (no invite handler): tell the user how to invite. */}
        {!onInvite && friends.some((f) => f.online) && (
          <p className="friends-invite-hint field__hint">💡 {t('friends.inviteNeedsRoom')}</p>
        )}
        {friends.map((f) => (
          <div key={f.userId} className={`friend-row ${f.online ? 'friend-row--online' : 'friend-row--offline'}`}>
            <FriendAvatar friend={f} />
            <span className="friend-row__name">{f.displayName ?? t('account.guestShort')}</span>
            <span className={`friend-status ${f.online ? 'friend-status--online' : 'friend-status--offline'}`}>
              <span className="friend-status__dot" aria-hidden="true" />
              {f.online ? t('friends.online') : t('friends.offline')}
            </span>
            <span className="friend-row__actions">
              {onInvite && (
                f.online
                  ? (invited?.has(f.userId)
                      ? <span className="friend-row__invited">✓ {t('friends.invited')}</span>
                      : <button type="button" className="btn btn--outline btn--small" onClick={() => onInvite(f.userId)}>{t('friends.invite')}</button>)
                  : <button type="button" className="btn btn--outline btn--small" disabled
                      title={t('friends.friendOffline')}>{t('friends.invite')}</button>
              )}
              <button type="button" className="btn btn--ghost btn--small" disabled={busy === f.userId}
                onClick={() => void act(f.userId, () => removeFriend(base, f.userId))}>{t('friends.remove')}</button>
            </span>
          </div>
        ))}
      </div>

      {/* Outgoing pending */}
      {outgoing.length > 0 && (
        <div className="friends-section">
          <h4 className="friends-section__head">{t('friends.outgoing')} ({outgoing.length})</h4>
          {outgoing.map((f) => (
            <div key={f.userId} className="friend-row friend-row--pending">
              <FriendAvatar friend={f} />
              <span className="friend-row__name">{f.displayName ?? t('account.guestShort')}</span>
              <span className="friend-row__pending-tag field__hint">{t('friends.pending')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
