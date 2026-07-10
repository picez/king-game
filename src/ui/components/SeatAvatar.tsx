// ---------------------------------------------------------------------------
// SeatAvatar (Stage 17.3) — renders ANOTHER player's seat avatar in online rooms:
// the server-synced uploaded image when present + same-origin-valid, else the
// whitelisted emoji. Used for lobby seats + the King table (any surface that shows
// a room member's avatar). It NEVER reads the device-local image store — that local
// image is a self-only preview; other players only ever see the emoji or the
// server-approved `/api/avatar/...` URL.
//
// Hard gate: the URL must pass `isSafeAvatarImageUrl` (same-origin `/api/avatar/<uuid>
// .webp`), so a remote / `data:` / `javascript:` URL — even if one somehow reached
// the payload — is rejected and the emoji is shown. A load error (404 / stale) also
// falls back to the emoji.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { isSafeAvatarImageUrl } from '../../net/avatarImage';

interface Props {
  /** The whitelisted emoji avatar (fallback + what everyone sees without an upload). */
  emoji?: string;
  /** The member's server avatar URL from the room snapshot (validated before use). */
  imageUrl?: string | null;
  /** Wrapper class (defaults to the existing `.member-avatar` seat styling). */
  className?: string;
}

export default function SeatAvatar({ emoji, imageUrl, className = 'member-avatar' }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = !failed && isSafeAvatarImageUrl(imageUrl);

  if (showImage) {
    return (
      <span className={className} aria-hidden="true">
        <img
          className="member-avatar__img" src={imageUrl as string} alt="" draggable={false}
          decoding="async" onError={() => setFailed(true)}
        />
      </span>
    );
  }
  if (!emoji) return null;
  return <span className={className} aria-hidden="true">{emoji}</span>;
}
