// Unit + privacy-guard tests for the Stage 24.0 production diagnostics payload
// (server/diagnostics.ts). buildDiagnostics is pure, so we test the field shape,
// the avatar-readiness logic, and — critically — that the serialized JSON leaks
// NONE of the forbidden private data (user/room/session/email/token/chat/card).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDiagnostics, availableGameIds, setFfmpegReady, getFfmpegReady,
  serverVersion, gitCommit, type DiagnosticsInput,
} from '../../server/diagnostics';
import { GAME_TYPES } from '../games/catalog';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const base: DiagnosticsInput = {
  version: '0.1.0',
  commit: 'abcdef1234',
  uptimeSeconds: 123.7,
  db: 'enabled',
  ffmpegReady: true,
  rooms: { total: 3, open: 1, inGame: 2 },
  connections: 5,
};

describe('buildDiagnostics — safe field shape', () => {
  it('returns exactly the allow-listed top-level keys (no extras can sneak in)', () => {
    const d = buildDiagnostics(base);
    expect(Object.keys(d).sort()).toEqual(
      ['avatarUploads', 'commit', 'connections', 'db', 'games', 'rooms', 'status', 'uptime', 'version'].sort(),
    );
  });

  it('reports status/version/commit/uptime/db/rooms/connections/games', () => {
    const d = buildDiagnostics(base);
    expect(d.status).toBe('ok');
    expect(d.version).toBe('0.1.0');
    expect(d.commit).toBe('abcdef1234');
    expect(d.uptime).toBe(124);                 // rounded
    expect(d.db).toBe('enabled');
    expect(d.rooms).toEqual({ total: 3, open: 1, inGame: 2 });
    expect(d.connections).toBe(5);
    expect(d.games.count).toBe(d.games.ids.length);
    expect(d.games.ids).toContain('king');
  });

  it('null version/commit pass through (unknown build env)', () => {
    const d = buildDiagnostics({ ...base, version: null, commit: null });
    expect(d.version).toBeNull();
    expect(d.commit).toBeNull();
  });
});

describe('buildDiagnostics — db + avatar readiness', () => {
  it('db disabled still reports status ok', () => {
    const d = buildDiagnostics({ ...base, db: 'disabled', ffmpegReady: false });
    expect(d.status).toBe('ok');
    expect(d.db).toBe('disabled');
  });

  it('db ERROR (probe failed) passes through, and disables avatar uploads', () => {
    const d = buildDiagnostics({ ...base, db: 'error', ffmpegReady: true });
    expect(d.status).toBe('ok');                  // the endpoint itself never fails
    expect(d.db).toBe('error');                   // distinct from disabled
    expect(d.avatarUploads.status).toBe('disabled');
    expect(d.avatarUploads.database).toBe(false); // an errored DB is not usable
  });

  it('db MIGRATION_REQUIRED passes through, and disables avatar uploads (schema not usable)', () => {
    const d = buildDiagnostics({ ...base, db: 'migration_required', ffmpegReady: true });
    expect(d.db).toBe('migration_required');      // reachable but behind on migrations
    expect(d.avatarUploads.database).toBe(false);
    // No SQL / column names leak — the db field is a plain state string.
    expect(JSON.stringify(d)).not.toMatch(/select|user_settings|column/i);
  });

  it('avatar uploads ENABLED only with both db AND ffmpeg', () => {
    const d = buildDiagnostics({ ...base, db: 'enabled', ffmpegReady: true });
    expect(d.avatarUploads.status).toBe('enabled');
    expect(d.avatarUploads.reason).toBeNull();
    expect(d.avatarUploads.ffmpeg).toBe(true);
    expect(d.avatarUploads.database).toBe(true);
  });

  it('avatar uploads DISABLED with a reason naming the missing piece', () => {
    expect(buildDiagnostics({ ...base, db: 'disabled', ffmpegReady: true }).avatarUploads.reason)
      .toBe('no_database');
    expect(buildDiagnostics({ ...base, db: 'enabled', ffmpegReady: false }).avatarUploads.reason)
      .toBe('no_ffmpeg');
    expect(buildDiagnostics({ ...base, db: 'disabled', ffmpegReady: false }).avatarUploads.reason)
      .toBe('no_database_and_ffmpeg');
  });

  it('avatar uploads UNKNOWN while the boot probe has not resolved (ffmpegReady null)', () => {
    const d = buildDiagnostics({ ...base, ffmpegReady: null });
    expect(d.avatarUploads.status).toBe('unknown');
    expect(d.avatarUploads.ffmpeg).toBe('unknown');
    expect(d.avatarUploads.reason).toBe('ffmpeg_probe_pending');
  });
});

describe('availableGameIds + ffmpeg cache + env readers', () => {
  it('lists the available game ids (all five are available today)', () => {
    const ids = availableGameIds();
    for (const g of GAME_TYPES) expect(ids).toContain(g);
    expect(ids.length).toBe(GAME_TYPES.length);
  });

  it('setFfmpegReady / getFfmpegReady round-trips the cached boot flag', () => {
    setFfmpegReady(true);
    expect(getFfmpegReady()).toBe(true);
    setFfmpegReady(false);
    expect(getFfmpegReady()).toBe(false);
  });

  it('serverVersion / gitCommit read env safely and never expose other env values', () => {
    expect(['string', 'object']).toContain(typeof serverVersion()); // string or null(object)
    const c = gitCommit();
    expect(c === null || (typeof c === 'string' && c.length <= 12)).toBe(true);
  });
});

describe('PRIVACY — the serialized payload leaks no private data', () => {
  // Feed values that WOULD be sensitive if any private field were ever added, then
  // assert the JSON contains none of the forbidden key names or value patterns.
  const d = buildDiagnostics(base);
  const json = JSON.stringify(d);

  it('contains none of the forbidden key/field names', () => {
    for (const forbidden of [
      'userId', 'user_id', 'email', 'token', 'reconnectToken', 'session', 'sessionId',
      'roomCode', 'avatarId', 'avatar_id', 'chat', 'password', 'secret', 'DATABASE_URL', 'cookie',
    ]) {
      expect(json.includes(forbidden), forbidden).toBe(false);
    }
  });

  it('every leaf value is a primitive count/boolean/short-string or a game id (no PII shapes)', () => {
    // No @ (emails), no long hex tokens/hashes in any value.
    expect(json).not.toMatch(/@/);
    expect(json).not.toMatch(/[a-f0-9]{32,}/i);
    const ids = availableGameIds();
    for (const v of d.games.ids) expect(ids).toContain(v);
  });
});

describe('SOURCE GUARD — the diagnostics module cannot touch private state', () => {
  const src = read('server/diagnostics.ts');

  it('never reads member/room private fields (structurally cannot leak them)', () => {
    for (const forbidden of [
      '.userId', '.email', '.members', '.reconnect', '.password', '.name',
      '.hand', '.gameState', 'sessionId',
    ]) {
      expect(src.includes(forbidden), forbidden).toBe(false);
    }
  });

  it('reads only whitelisted env keys (version + commit; never DATABASE_URL / tokens)', () => {
    const envRefs = src.match(/process\.env\.[A-Za-z_]+/g) ?? [];
    for (const ref of envRefs) {
      expect(
        ['process.env.npm_package_version', 'process.env.RENDER_GIT_COMMIT',
          'process.env.GIT_COMMIT', 'process.env.SOURCE_COMMIT'].includes(ref),
        ref,
      ).toBe(true);
    }
  });
});
