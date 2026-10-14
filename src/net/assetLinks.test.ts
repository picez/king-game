import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANDROID_PACKAGE_ID, DIRECT_RELEASE_FINGERPRINTS, assetLinkFingerprints, assetLinksPayload } from '../../server/assetLinks';

const FP = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

describe('Digital Asset Links (/.well-known/assetlinks.json)', () => {
  it('names the TWA package and the project release key', () => {
    const twa = JSON.parse(readFileSync(join(process.cwd(), 'android-twa', 'twa-manifest.json'), 'utf8'));
    expect(ANDROID_PACKAGE_ID).toBe(twa.packageId);
    expect(DIRECT_RELEASE_FINGERPRINTS.length).toBeGreaterThan(0);
    for (const fp of DIRECT_RELEASE_FINGERPRINTS) expect(fp).toMatch(FP);
    const [stmt] = assetLinksPayload('') as Array<{ relation: string[]; target: Record<string, unknown> }>;
    expect(stmt.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(stmt.target).toEqual({
      namespace: 'android_app', package_name: 'com.cardmajlis.app',
      sha256_cert_fingerprints: [...DIRECT_RELEASE_FINGERPRINTS],
    });
  });

  it('adds valid env fingerprints (the Play App-Signing key), upper-cased and de-duplicated', () => {
    const play = '0a:1b:2c:3d:4e:5f:60:71:82:93:a4:b5:c6:d7:e8:f9:0a:1b:2c:3d:4e:5f:60:71:82:93:a4:b5:c6:d7:e8:f9';
    const got = assetLinkFingerprints(` ${play} , ${DIRECT_RELEASE_FINGERPRINTS[0]}, not-a-sha ,`);
    expect(got).toEqual([...DIRECT_RELEASE_FINGERPRINTS, play.toUpperCase()]);
  });

  it('is served by the HTTP server before the static/SPA fallback', () => {
    const src = readFileSync(join(process.cwd(), 'server', 'index.ts'), 'utf8');
    const route = src.indexOf("'/.well-known/assetlinks.json'");
    expect(route).toBeGreaterThan(0);
    expect(route).toBeLessThan(src.indexOf('if (SERVE_STATIC) { void serveStatic'));
  });
});
