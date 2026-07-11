// Tests for the Stage 24.8 client-side avatar compressor. The canvas decode/crop needs a
// browser, so the QUALITY LADDER is extracted as `pickUnderCap(encode, cap)` and tested
// with a mocked encoder (no real canvas). Source guards cover the rest (shared crop reuse,
// synthetic filename, no original filename, compress-before-upload wiring).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickUnderCap, MAX_AVATAR_UPLOAD_TARGET_BYTES } from './avatarCompress';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const blob = (size: number, type: string) => new Blob([new Uint8Array(size)], { type });

describe('pickUnderCap — quality ladder targets <= cap', () => {
  it('picks the FIRST WebP step at/under the cap (highest quality that fits)', async () => {
    // 0.82,0.72 → 200 (over); 0.62 → 80 (under) → chosen.
    const enc = async (type: string, q: number) =>
      type === 'image/webp' ? blob(q > 0.7 ? 200 : 80, 'image/webp') : null;
    const r = await pickUnderCap(enc, 100);
    expect(r?.name).toBe('avatar.webp');
    expect(r?.blob.type).toBe('image/webp');
    expect(r?.blob.size).toBeLessThanOrEqual(100);
  });

  it('falls back to JPEG when every WebP step stays over the cap', async () => {
    const enc = async (type: string) =>
      type === 'image/webp' ? blob(500, 'image/webp') : blob(90, 'image/jpeg');
    const r = await pickUnderCap(enc, 100);
    expect(r?.name).toBe('avatar.jpg');
    expect(r?.blob.type).toBe('image/jpeg');
    expect(r?.blob.size).toBeLessThanOrEqual(100);
  });

  it('falls back to JPEG when WebP export is unsupported (a non-webp blob comes back)', async () => {
    const enc = async (type: string) =>
      type === 'image/webp' ? blob(40, 'image/png') : blob(50, 'image/jpeg');
    const r = await pickUnderCap(enc, 100);
    expect(r?.name).toBe('avatar.jpg'); // did NOT accept the png-typed webp attempt
  });

  it('returns null when even the lowest quality stays over the cap (caller → "too large")', async () => {
    const enc = async (type: string) => blob(999, type); // webp + jpeg both over
    expect(await pickUnderCap(enc, 100)).toBeNull();
  });

  it('the default cap is 100 KB', () => {
    expect(MAX_AVATAR_UPLOAD_TARGET_BYTES).toBe(100 * 1024);
  });
});

describe('compressor wiring + privacy (source guards)', () => {
  const compress = read('src/net/avatarCompress.ts');
  const account = read('src/hooks/useAccount.ts');
  const local = read('src/ui/components/customAvatarImage.ts');

  it('compressAvatarForUpload reuses the shared crop + ladder and emits a SYNTHETIC filename', () => {
    expect(compress).toContain('drawAvatarSquareCanvas');
    expect(compress).toContain('pickUnderCap');
    expect(compress).toMatch(/new File\(\[picked\.blob\], picked\.name/);
    expect(compress).toContain("'avatar.webp'");
    expect(compress).toContain("'avatar.jpg'");
    // The original filename / bytes / metadata never leave the browser — the canvas
    // re-encode drops them and we never read file.name.
    expect(compress).not.toContain('file.name');
    expect(compress).not.toMatch(/base64|dataURL|readAsDataURL/);
  });

  it('useAccount COMPRESSES before uploading (small payload → fast POST)', () => {
    expect(account).toContain('compressAvatarForUpload(file)');
    expect(account).toMatch(/compressAvatarForUpload\(file\)[\s\S]*uploadAvatar\(base, prepared\)/);
    // Compression failure maps to typed errors, never throws to the caller.
    expect(account).toContain("'compress_too_large'");
    expect(account).toContain("'compress_failed'");
  });

  it('the LOCAL-only avatar path is unchanged — still reuses the shared canvas → data URL', () => {
    expect(local).toContain('drawAvatarSquareCanvas');
    expect(local).toContain("canvas.toDataURL('image/webp'");
    expect(local).toContain('isValidCustomAvatar'); // same local size guard as before
  });
});
