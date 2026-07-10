import { describe, it, expect } from 'vitest';
import {
  detectImageType, isAcceptedUpload, readWebpDimensions, multipartBoundary,
  parseSingleFileMultipart, avatarImageUrlPath, avatarPublicIdFromPath, isSafeAvatarImageUrl,
} from './avatarImage';

const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);
const pad = (b: Uint8Array, n = 16): Uint8Array => {
  const out = new Uint8Array(Math.max(b.length, n));
  out.set(b);
  return out;
};
const text = (s: string): Uint8Array => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));

// PNG signature, JPEG SOI, WebP RIFF/WEBP, GIF87/89, SVG text.
const PNG = pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0));
const JPEG = pad(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0));
const WEBP = (() => { const b = new Uint8Array(16); b.set(text('RIFF'), 0); b.set(text('WEBP'), 8); return b; })();
const GIF = text('GIF89a-------------');
const SVG = text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const SVG2 = text('<svg width="10"></svg>-----');
const UNKNOWN = pad(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12));

describe('detectImageType — magic bytes, not MIME', () => {
  it('accepts png/jpeg/webp', () => {
    expect(detectImageType(PNG)).toBe('png');
    expect(detectImageType(JPEG)).toBe('jpeg');
    expect(detectImageType(WEBP)).toBe('webp');
  });
  it('detects (to reject) gif/svg', () => {
    expect(detectImageType(GIF)).toBe('gif');
    expect(detectImageType(SVG)).toBe('svg');
    expect(detectImageType(SVG2)).toBe('svg');
  });
  it('unknown / too-short → unknown', () => {
    expect(detectImageType(UNKNOWN)).toBe('unknown');
    expect(detectImageType(bytes(1, 2, 3))).toBe('unknown');
  });
  it('a lying label cannot change the detected type (bytes win)', () => {
    // A GIF body is a GIF no matter what a client claims — isAcceptedUpload gates it.
    expect(isAcceptedUpload(detectImageType(GIF))).toBe(false);
    expect(isAcceptedUpload(detectImageType(SVG))).toBe(false);
    expect(isAcceptedUpload(detectImageType(PNG))).toBe(true);
  });
});

describe('readWebpDimensions', () => {
  it('reads a lossy VP8 keyframe (192x192)', () => {
    const b = new Uint8Array(30);
    b.set(text('RIFF'), 0); b.set(text('WEBP'), 8); b.set(text('VP8 '), 12);
    b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
    b[26] = 0xc0; b[27] = 0x00; // width 192
    b[28] = 0xc0; b[29] = 0x00; // height 192
    expect(readWebpDimensions(b)).toEqual({ width: 192, height: 192 });
  });
  it('returns null for a non-webp buffer', () => {
    expect(readWebpDimensions(PNG)).toBeNull();
  });
});

describe('multipart parsing', () => {
  it('extracts the boundary token (quoted or bare)', () => {
    expect(multipartBoundary('multipart/form-data; boundary=abc123')).toBe('abc123');
    expect(multipartBoundary('multipart/form-data; boundary="x-y-z"')).toBe('x-y-z');
    expect(multipartBoundary('application/json')).toBeNull();
    expect(multipartBoundary(undefined)).toBeNull();
  });

  it('extracts the first file part bytes (binary-safe)', () => {
    const boundary = 'BOUNDARY42';
    const head = text(
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="a.png"\r\n' +
      'Content-Type: image/png\r\n\r\n',
    );
    const tail = text(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + PNG.length + tail.length);
    body.set(head, 0); body.set(PNG, head.length); body.set(tail, head.length + PNG.length);

    const file = parseSingleFileMultipart(body, boundary);
    expect(file).not.toBeNull();
    expect(Array.from(file!.bytes)).toEqual(Array.from(PNG));
    expect(file!.declaredType).toBe('image/png');
    // The DETECTED type comes from the bytes, not the declared header.
    expect(detectImageType(file!.bytes)).toBe('png');
  });

  it('returns null for a non-file part (no filename)', () => {
    const boundary = 'B';
    const body = text(`--${boundary}\r\nContent-Disposition: form-data; name="x"\r\n\r\nvalue\r\n--${boundary}--\r\n`);
    expect(parseSingleFileMultipart(body, boundary)).toBeNull();
  });
});

describe('URL shape + opaque id parsing (traversal-safe)', () => {
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  it('builds a same-origin versioned path', () => {
    expect(avatarImageUrlPath(uuid, 3)).toBe(`/api/avatar/${uuid}.webp?v=3`);
  });
  it('parses a valid UUID avatar path', () => {
    expect(avatarPublicIdFromPath(`/api/avatar/${uuid}.webp`)).toBe(uuid);
  });
  it('rejects traversal / non-uuid ids', () => {
    expect(avatarPublicIdFromPath('/api/avatar/../../etc/passwd.webp')).toBeNull();
    expect(avatarPublicIdFromPath('/api/avatar/..%2f..%2fx.webp')).toBeNull();
    expect(avatarPublicIdFromPath('/api/avatar/not-a-uuid.webp')).toBeNull();
    expect(avatarPublicIdFromPath('/api/avatar/3f2504e0.png')).toBeNull();
    expect(avatarPublicIdFromPath('/api/me')).toBeNull();
  });
});

describe('isSafeAvatarImageUrl — same-origin gate for OTHER players', () => {
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  it('accepts a same-origin /api/avatar URL (with or without ?v)', () => {
    expect(isSafeAvatarImageUrl(`/api/avatar/${uuid}.webp?v=3`)).toBe(true);
    expect(isSafeAvatarImageUrl(`/api/avatar/${uuid}.webp`)).toBe(true);
  });
  it('rejects remote / data / javascript / non-string / off-path values', () => {
    expect(isSafeAvatarImageUrl(`https://evil.example/api/avatar/${uuid}.webp`)).toBe(false);
    expect(isSafeAvatarImageUrl('data:image/webp;base64,AAAA')).toBe(false);
    expect(isSafeAvatarImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeAvatarImageUrl(`//evil/api/avatar/${uuid}.webp`)).toBe(false);
    expect(isSafeAvatarImageUrl(`/api/avatar/${uuid}.png`)).toBe(false);
    expect(isSafeAvatarImageUrl('/api/avatar/not-a-uuid.webp')).toBe(false);
    expect(isSafeAvatarImageUrl(null)).toBe(false);
    expect(isSafeAvatarImageUrl(undefined)).toBe(false);
    expect(isSafeAvatarImageUrl(123)).toBe(false);
  });
});
