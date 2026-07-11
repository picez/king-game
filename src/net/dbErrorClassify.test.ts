// Tests for the server DB-error classifier (Stage 24.5). A schema drift (a missing
// migration) must be told apart from a transient fault, so the API can surface a safe
// `migration_required` code instead of masking it as a guest / a transient db_error.
// Importing server/db/client is side-effect-free (the pg driver loads lazily inside
// functions, never at module load).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyDbError, REQUIRED_USER_SETTINGS_COLUMNS } from '../../server/db/client';

describe('classifyDbError', () => {
  it('maps Postgres schema-drift SQLSTATEs to migration_required', () => {
    expect(classifyDbError({ code: '42703' })).toBe('migration_required'); // undefined_column
    expect(classifyDbError({ code: '42P01' })).toBe('migration_required'); // undefined_table
  });

  it('maps connection / other faults to db_error (transient)', () => {
    for (const code of ['08006', '08003', '57P01', '53300', undefined]) {
      expect(classifyDbError({ code }), String(code)).toBe('db_error');
    }
    expect(classifyDbError(new Error('boom'))).toBe('db_error');
    expect(classifyDbError(null)).toBe('db_error');
  });
});

describe('required user_settings columns (the ones migrations 0005–0008 add)', () => {
  it('lists exactly the columns the /api/me profile read needs', () => {
    expect([...REQUIRED_USER_SETTINGS_COLUMNS]).toEqual(
      ['animation_preference', 'favorite_game', 'card_face_theme', 'avatar_image_version'],
    );
  });

  it('the schema probe checks those columns cheaply (information_schema), TTL-cached', () => {
    const src = readFileSync(join(process.cwd(), 'server/db/client.ts'), 'utf8');
    expect(src).toContain('information_schema.columns');
    expect(src).toContain("table_name = 'user_settings'");
    expect(src).toMatch(/SCHEMA_PROBE_TTL_MS/);       // cached so health checks don't hammer the DB
    expect(src).toContain('migration_required');
  });
});
