import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { processAvatarToWebp, ffmpegAvailable } from '../../server/avatarProcess';
import { detectImageType, readWebpDimensions, AVATAR_OUTPUT_PX, MAX_AVATAR_OUTPUT_BYTES } from './avatarImage';

const hasFfmpeg = await ffmpegAvailable();
const text = (s: string): Buffer => Buffer.from(s, 'latin1');

/** Synthesises a solid-colour source image of the given format via ffmpeg (stdout). */
function synth(format: 'png' | 'jpeg' | 'webp', color: string, w: number, h: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const codec = format === 'png' ? 'png' : format === 'jpeg' ? 'mjpeg' : 'libwebp';
    const muxer = format === 'webp' ? 'webp' : 'image2pipe';
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h},format=rgb24`,
      '-frames:v', '1', '-c:v', codec, '-f', muxer, 'pipe:1',
    ];
    const child = spawn('ffmpeg', args);
    const out: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg exit ${code}`))));
  });
}

describe.skipIf(!hasFfmpeg)('processAvatarToWebp — decode/crop/resize/re-encode', () => {
  it('processes a PNG into a square 192x192 WebP under the cap', async () => {
    const png = await synth('png', 'red', 500, 300);
    expect(detectImageType(png)).toBe('png');
    const r = await processAvatarToWebp(png);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mimeType).toBe('image/webp');
    expect(detectImageType(r.bytes)).toBe('webp');
    expect(r.width).toBe(AVATAR_OUTPUT_PX);
    expect(r.height).toBe(AVATAR_OUTPUT_PX);
    expect(readWebpDimensions(r.bytes)).toEqual({ width: 192, height: 192 });
    expect(r.byteSize).toBeLessThanOrEqual(MAX_AVATAR_OUTPUT_BYTES);
    expect(r.byteSize).toBe(r.bytes.length);
  });

  it('processes a JPEG source', async () => {
    const jpg = await synth('jpeg', 'blue', 400, 400);
    expect(detectImageType(jpg)).toBe('jpeg');
    const r = await processAvatarToWebp(jpg);
    expect(r.ok).toBe(true);
    if (r.ok) expect(readWebpDimensions(r.bytes)).toEqual({ width: 192, height: 192 });
  });

  it('processes a WebP source', async () => {
    const webp = await synth('webp', 'green', 300, 500);
    expect(detectImageType(webp)).toBe('webp');
    const r = await processAvatarToWebp(webp);
    expect(r.ok).toBe(true);
  });
});

// These rejections happen on magic-byte detection BEFORE ffmpeg — no binary needed.
describe('processAvatarToWebp — rejects unsupported / invalid inputs', () => {
  it('rejects SVG (script vector) as unsupported_type', async () => {
    const r = await processAvatarToWebp(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    expect(r).toEqual({ ok: false, reason: 'unsupported_type' });
  });
  it('rejects GIF as unsupported_type', async () => {
    const r = await processAvatarToWebp(text('GIF89a' + '\0'.repeat(20)));
    expect(r).toEqual({ ok: false, reason: 'unsupported_type' });
  });
  it('rejects unknown bytes as invalid_image', async () => {
    const r = await processAvatarToWebp(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
    expect(r).toEqual({ ok: false, reason: 'invalid_image' });
  });
});
