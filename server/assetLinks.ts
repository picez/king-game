/**
 * Digital Asset Links for the Android app (2026-10-14).
 *
 * The Android app is a Trusted Web Activity: a thin shell that opens this site in Chrome.
 * Chrome shows it FULL-SCREEN only when `/.well-known/assetlinks.json` on this origin names
 * the app's package AND the SHA-256 of the certificate the installed APK is signed with;
 * otherwise it falls back to a Custom Tab with a URL bar.
 *
 * The file is generated here rather than committed as a static asset, so a new certificate
 * is one line (or one env var) and never a hand-edited JSON:
 *   - {@link DIRECT_RELEASE_FINGERPRINTS} — the project's own release key
 *     (`card-majlis-release.jks`, kept OUTSIDE the repo by the owner). It signs the APK that
 *     is installed directly, and it is the upload key if the app goes to Google Play.
 *   - `ANDROID_CERT_SHA256` — extra fingerprints, comma-separated. With Play App Signing,
 *     Google re-signs the store build with ITS key: that fingerprint (Play Console → App
 *     integrity → App signing) must be added here, or the store install opens with a URL bar.
 *
 * A certificate fingerprint is public by design (it is printed by any APK inspector); the
 * private key never leaves the owner's machine.
 */

export const ANDROID_PACKAGE_ID = 'com.cardmajlis.app';

/** SHA-256 of the project's own release signing certificate (alias `cardmajlis`). */
export const DIRECT_RELEASE_FINGERPRINTS: readonly string[] = [
  'AF:FC:A7:44:20:7F:C0:3E:3F:F5:1D:CB:49:2F:81:BE:ED:A3:B6:56:FD:AD:6D:3E:F4:37:6A:73:91:8A:F1:EB',
];

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** Upper-cased, validated, de-duplicated fingerprints: the committed ones plus the env list. */
export function assetLinkFingerprints(env: string | undefined = process.env.ANDROID_CERT_SHA256): string[] {
  const extra = (env ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const out: string[] = [];
  for (const fp of [...DIRECT_RELEASE_FINGERPRINTS, ...extra]) {
    if (FINGERPRINT.test(fp) && !out.includes(fp)) out.push(fp);
  }
  return out;
}

export function assetLinksPayload(env?: string): unknown[] {
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: ANDROID_PACKAGE_ID,
      sha256_cert_fingerprints: assetLinkFingerprints(env),
    },
  }];
}
