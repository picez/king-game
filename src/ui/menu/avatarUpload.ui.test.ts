import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../i18n/dictionaries/en';

// Source-level contract for the Stage 17.2 Profile avatar upload/remove UI (no
// testing-library in the repo). Verifies the wiring, the server>local>emoji preview
// priority, the guest gating, and that NOTHING image-related leaks onto the wire or
// through the settings PATCH.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const panel = read('src/ui/menu/ProfilePanel.tsx');
const myAvatar = read('src/ui/components/MyAvatar.tsx');
const account = read('src/hooks/useAccount.ts');
const api = read('src/net/avatarApi.ts');

describe('Profile — synced avatar controls (signed-in) + guest gating', () => {
  it('shows the upload/remove controls only when signed in, else a sign-in hint', () => {
    expect(panel).toContain('account.signedIn ? (');
    expect(panel).toContain("t('avatar.uploadSynced')");
    expect(panel).toContain("t('avatar.syncedGuestHint')"); // guest branch
  });

  it('the remove button appears only when a synced avatar exists', () => {
    expect(panel).toContain('account.avatarImageUrl && (');
    expect(panel).toContain("t('avatar.removeSynced')");
  });

  it('upload/remove go through the dedicated account methods, not settings/emoji push', () => {
    expect(panel).toContain('account.uploadAvatarImage(file,'); // (+ an onPhase callback, Stage 24.8)
    expect(panel).toContain('account.removeAvatarImage()');
    // The synced image must NOT ride the emoji push or the settings PATCH.
    expect(panel).not.toMatch(/pushAvatar\([^)]*(image|synced|url)/i);
    expect(panel).not.toMatch(/updateSettings\([^)]*avatarImage/i);
  });

  it('the busy state shows an "uploading" label and disables the button', () => {
    expect(panel).toContain("t('avatar.uploading')");
    expect(panel).toContain('disabled={syncedBusy}');
  });

  it('maps every upload error to a friendly message (incl. 503 unavailable)', () => {
    for (const key of ['avatar.errType', 'avatar.errSize', 'avatar.errRate', 'avatar.errUnavailable', 'avatar.errSignIn', 'avatar.errFailed']) {
      expect(panel, key).toContain(`t('${key}')`);
    }
  });
});

describe('preview priority — server avatarImageUrl > local custom > emoji', () => {
  it('MyAvatar orders candidates [imageUrl, custom] and falls back to the emoji', () => {
    expect(myAvatar).toContain('[imageUrl, custom]');
    expect(myAvatar).toContain('useCustomAvatar');
    expect(myAvatar).toContain('onError');          // 404 → next candidate
    expect(myAvatar).toContain('{emoji}');          // final fallback
  });

  it('the Profile preview + summary pass the synced URL to MyAvatar', () => {
    expect(panel).toContain('imageUrl={account.avatarImageUrl}');
    // AccountBar (a "me" surface) also gets it.
    expect(read('src/ui/menu/AccountBar.tsx')).toContain('imageUrl={account.avatarImageUrl}');
  });
});

describe('account + API boundaries — no binary on settings/wire, OAuth kept separate', () => {
  it('useAccount exposes avatarImageUrl from /api/me and re-hydrates after upload/remove', () => {
    expect(account).toContain('avatarImageUrl: me?.avatarImageUrl ?? null');
    // Stage 24.8: the picked file is client-COMPRESSED first, then the small result uploaded.
    expect(account).toContain('compressAvatarForUpload(file)');
    expect(account).toContain('uploadAvatar(base, prepared)');
    expect(account).toContain('deleteServerAvatar(base)');
    expect(account).toContain('await hydrate()');
    // The uploaded image never goes through PATCH /api/settings.
    expect(account).not.toMatch(/updateSettings\([^)]*avatarImage/i);
  });

  it('the client API uses multipart FormData, never JSON base64 or a remote URL', () => {
    expect(api).toContain('new FormData()');
    expect(api).toContain("form.append('file', file)");
    expect(api).not.toMatch(/base64|data:image/i);
  });

  it('OAuth avatarUrl and the uploaded avatarImageUrl stay DISTINCT fields', () => {
    const profileApi = read('src/net/profileApi.ts');
    expect(profileApi).toContain('avatarUrl');       // OAuth provider picture
    expect(profileApi).toContain('avatarImageUrl');  // uploaded, same-origin
    // The account never treats the OAuth picture as the custom avatar.
    expect(account).not.toContain('avatarImageUrl: me?.avatarUrl');
  });

  it('the WS protocol carries only a same-origin URL — never image bytes', () => {
    // Stage 17.3 adds an OPTIONAL same-origin avatarImageUrl (a URL) to the room
    // member; the invariant that holds is no image DATA (data URI / base64) on the wire.
    expect(read('src/net/messages.ts')).not.toMatch(/data:image|base64/i);
    // The server snapshot emits it only behind the same-origin validation gate.
    expect(read('src/net/serverCore.ts')).toContain('isSafeAvatarImageUrl');
  });
});

describe('i18n parity — new avatar keys in every language', () => {
  const KEYS = [
    'avatar.emojiTitle', 'avatar.syncedTitle', 'avatar.deviceTitle', 'avatar.chooseLocal',
    'avatar.uploadSynced', 'avatar.removeSynced', 'avatar.uploading', 'avatar.syncedHint',
    'avatar.syncedGuestHint', 'avatar.errRate', 'avatar.errUnavailable', 'avatar.errSignIn',
  ];
  const dicts = ['en', 'uk', 'de', 'ar'].map((l) => read(join('src/i18n/dictionaries', `${l}.ts`)));
  for (const key of KEYS) {
    it(`${key} is present + non-blank everywhere`, () => {
      expect(EN[key as keyof typeof EN], `EN missing ${key}`).toBeTruthy();
      for (const d of dicts) expect(d, `dict missing ${key}`).toContain(`'${key}'`);
    });
  }
});
