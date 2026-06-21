import { describe, it, expect } from 'vitest';
import { resolveStorageKind, assertStorageEnv, StorageConfigError } from './storageConfig';

describe('resolveStorageKind', () => {
  it('defaults to file when unset/empty/unknown', () => {
    expect(resolveStorageKind(undefined)).toBe('file');
    expect(resolveStorageKind('')).toBe('file');
    expect(resolveStorageKind('file')).toBe('file');
    expect(resolveStorageKind('something-else')).toBe('file');
  });

  it('selects memory and pg explicitly', () => {
    expect(resolveStorageKind('memory')).toBe('memory');
    expect(resolveStorageKind('pg')).toBe('pg');
  });
});

describe('assertStorageEnv', () => {
  it('requires DATABASE_URL for pg (fail fast)', () => {
    expect(() => assertStorageEnv('pg', {})).toThrow(StorageConfigError);
    expect(() => assertStorageEnv('pg', { DATABASE_URL: '' })).toThrow(StorageConfigError);
  });

  it('passes for pg when DATABASE_URL is present', () => {
    expect(() => assertStorageEnv('pg', { DATABASE_URL: 'postgres://x' })).not.toThrow();
  });

  it('never requires DATABASE_URL for file/memory', () => {
    expect(() => assertStorageEnv('file', {})).not.toThrow();
    expect(() => assertStorageEnv('memory', {})).not.toThrow();
  });
});
