// ---------------------------------------------------------------------------
// MyAvatar (Stage 14.1 → 17.2) — renders the LOCAL user's own avatar with a
// priority chain: server SYNCED avatar (imageUrl) → local custom image → emoji.
// Use this ONLY for "me" surfaces (AccountBar, Profile) — never for other players /
// online seats, which keep showing the server-safe emoji from the room payload.
//
// Each image candidate falls back on load error (a 404 / network miss), so a stale
// synced URL degrades to the local image, and that to the emoji — never a broken img.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useCustomAvatar } from './customAvatarStore';

interface Props {
  /** The server-safe emoji avatar (the final fallback + what everyone else sees). */
  emoji: string;
  /** Applied to the wrapper span (so callers keep their existing avatar styling). */
  className?: string;
  /**
   * Optional server-synced avatar URL (Stage 17.2), same-origin + versioned. When
   * present + loadable it wins over the local image. Omit on surfaces that should
   * only ever show the local/emoji identity.
   */
  imageUrl?: string | null;
}

export default function MyAvatar({ emoji, className, imageUrl }: Props) {
  const custom = useCustomAvatar();
  const [errored, setErrored] = useState<Record<string, true>>({});

  // Priority: synced server image → local custom image. First candidate that has
  // not failed to load wins; if all fail / none set, we fall back to the emoji.
  const candidates = [imageUrl, custom].filter((s): s is string => !!s);
  const src = candidates.find((s) => !errored[s]);

  if (src) {
    return (
      <span className={className} aria-hidden="true">
        <img
          className="my-avatar__img" src={src} alt="" draggable={false} decoding="async"
          onError={() => setErrored((e) => ({ ...e, [src]: true }))}
        />
      </span>
    );
  }
  return <span className={className} aria-hidden="true">{emoji}</span>;
}
