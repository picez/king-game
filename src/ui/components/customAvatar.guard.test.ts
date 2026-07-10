// Contract guards for the LOCAL-ONLY custom avatar (Stage 14.1): it must never
// reach the wire (WS/messages), the server profile (API/userSettings), or the DB;
// it is re-encoded client-side; and the emoji avatar stays the server-safe identity.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('custom avatar stays OFF the wire + out of the server profile', () => {
  it('messages.ts declares no custom-avatar / image / data-URL field', () => {
    const m = read('src/net/messages.ts');
    expect(/custom ?avatar/i.test(m)).toBe(false);
    expect(/avatarImage|avatarUrl|avatar_data/i.test(m)).toBe(false);
    expect(/data:image/i.test(m)).toBe(false);
    expect(/base64/i.test(m)).toBe(false);
  });

  it('no image DATA (local custom avatar) reaches the profile API or settings schema', () => {
    // Stage 17.1 adds a SERVER-synced avatar as a same-origin URL (`avatarImageUrl`)
    // in the profile API — that is a URL, NOT image bytes. The invariant that still
    // holds: neither the API nor the settings sanitize path ever carries the LOCAL
    // custom-avatar data URL / base64, and userSettings gains no avatar-image field.
    const api = read('src/net/profileApi.ts');
    const settings = read('src/net/userSettings.ts');
    for (const src of [api, settings]) {
      expect(/customAvatar|data:image|base64/i.test(src)).toBe(false);
    }
    // The global settings model/sanitizer stays free of ANY avatar-image field
    // (the uploaded-avatar version lives only in the avatar repo, not settings).
    expect(/avatarImage/i.test(settings)).toBe(false);
    // The profile API may expose the same-origin URL, but only as a URL string.
    expect(api).toContain('avatarImageUrl');
    expect(/data:image|base64/i.test(api)).toBe(false);
  });

  it('the store is local + never imports the WS protocol or the network', () => {
    const store = read('src/ui/components/customAvatarStore.ts');
    expect(store).toContain('useSyncExternalStore');
    expect(store).toMatch(/LOCAL|never goes into room\/WS state|local/i);
    expect(store).toContain("from '../../net/customAvatar'");
    expect(store).not.toContain('messages');
    expect(store).not.toContain('fetch');
  });
});

describe('custom avatar processing is client-side + safe', () => {
  it('re-encodes via canvas (strips EXIF) and validates type/size before decoding', () => {
    const proc = read('src/ui/components/customAvatarImage.ts');
    expect(proc).toContain('canvas');
    expect(proc).toContain('toDataURL');
    expect(proc).toContain('isAcceptedAvatarType');
    expect(proc).toContain('isAvatarInputTooLarge');
    // No upload / network in the processing path.
    expect(proc).not.toContain('fetch');
    expect(proc).not.toMatch(/XMLHttpRequest|\.upload/);
  });
});

describe('Profile avatar UI (Stage 14.1)', () => {
  const panel = read('src/ui/menu/ProfilePanel.tsx');

  it('keeps the emoji picker AND the LOCAL (this-device) image controls', () => {
    // Stage 17.2 relabelled the local upload button ("Choose local image") and added
    // a SEPARATE synced-avatar area — the local-only 14.1 feature stays intact.
    expect(panel).toContain('AVATARS.map');                 // emoji grid still there
    expect(panel).toContain("t('avatar.chooseLocal')");     // local (this-device) upload
    expect(panel).toContain("t('avatar.remove')");          // local remove
    expect(panel).toContain("t('avatar.localHint')");
  });

  it('the file input is accept-restricted to the png/jpeg/webp whitelist, not native-select', () => {
    expect(panel).toContain('AVATAR_ACCEPT_ATTR');
    expect(panel).toContain("type=\"file\"");
    expect(panel).toContain('visually-hidden');            // hidden input + styled button
    expect(panel).not.toMatch(/<select[\s>]/);
  });

  it('the custom image never touches the server emoji push (avatar stays server-safe)', () => {
    // changeAvatar (emoji) syncs to the server; the custom image only calls the
    // LOCAL save/clear + the local store — never account.push*.
    expect(panel).toContain('saveCustomAvatar(dataUrl)');
    expect(panel).toContain('clearCustomAvatar()');
    expect(panel).toContain('account.pushAvatar');         // emoji still syncs
    expect(panel).not.toMatch(/pushAvatar\(dataUrl\)|push\w*\(custom/);
  });
});

describe('MyAvatar is for the local user only', () => {
  const my = read('src/ui/components/MyAvatar.tsx');
  it('renders the custom image if set, else the emoji', () => {
    expect(my).toContain('useCustomAvatar');
    expect(my).toContain('my-avatar__img');
    expect(my).toContain('{emoji}');
  });
  it('is used on the AccountBar (a "me" surface), not on opponent seats', () => {
    expect(read('src/ui/menu/AccountBar.tsx')).toContain('<MyAvatar emoji={avatar}');
    // Opponent/seat renderers must NOT import MyAvatar.
    for (const f of ['src/ui/durak/DurakGameScreen.tsx', 'src/ui/online/Lobby.tsx']) {
      expect(read(f), f).not.toContain('MyAvatar');
    }
  });
});
