// ---------------------------------------------------------------------------
// MyAvatar (Stage 14.1) — renders the LOCAL user's own avatar: the local custom
// image if one is set, otherwise the whitelisted emoji. Use this ONLY for "me"
// surfaces (AccountBar, Profile preview) — never for other players / online seats,
// which must keep showing the server-safe emoji from the room payload.
// ---------------------------------------------------------------------------

import { useCustomAvatar } from './customAvatarStore';

interface Props {
  /** The server-safe emoji avatar (the fallback + what everyone else ever sees). */
  emoji: string;
  /** Applied to the wrapper span (so callers keep their existing avatar styling). */
  className?: string;
}

export default function MyAvatar({ emoji, className }: Props) {
  const custom = useCustomAvatar();
  if (custom) {
    return (
      <span className={className} aria-hidden="true">
        <img className="my-avatar__img" src={custom} alt="" draggable={false} decoding="async" />
      </span>
    );
  }
  return <span className={className} aria-hidden="true">{emoji}</span>;
}
