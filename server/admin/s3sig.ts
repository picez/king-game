// ---------------------------------------------------------------------------
// AWS Signature V4 for S3-compatible storage (Cloudflare R2), Stage 44.1.
//
// Hand-rolled on node:crypto so the cloud backup adds NO npm dependency (the repo's
// lockfile policy forbids casual installs). Pure: the caller passes `now`, so the
// AWS documentation test vector pins it (src/net/cloudBackup.test.ts).
// ---------------------------------------------------------------------------

import { createHash, createHmac } from 'node:crypto';

export interface SignInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  now: Date;
}

export const sha256Hex = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Uint8Array | string, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it (encodeURIComponent leaves !'()* alone). */
export function awsEncode(v: string): string {
  return encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** An object key as a URL path: every segment encoded, the slashes kept. */
export const encodeKeyPath = (key: string): string => key.split('/').map(awsEncode).join('/');

/**
 * Returns the headers to send (lower-case names, incl. `authorization`,
 * `x-amz-date`, `x-amz-content-sha256`). `host` is signed but not returned:
 * fetch sets it from the URL itself.
 */
export function signRequest(i: SignInput): Record<string, string> {
  const u = new URL(i.url);
  const amzDate = i.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const service = i.service ?? 's3';
  const payloadHash = sha256Hex(i.body ?? '');

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  headers.host = u.host;
  headers['x-amz-date'] = amzDate;
  headers['x-amz-content-sha256'] = payloadHash;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [i.method.toUpperCase(), u.pathname || '/', query, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${day}/${i.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');

  const out: Record<string, string> = { ...headers };
  delete out.host;
  out.authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}
