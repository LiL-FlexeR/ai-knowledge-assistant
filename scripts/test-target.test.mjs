import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertOwnedTestDatabase,
  assertOwnedTestStorage,
} from './test-target.mjs';

const owned = { database: 'aka_test_0123456789abcdef', port: 55432 };
const good =
  'postgresql://aka_test_migrator:private@127.0.0.1:55432/aka_test_0123456789abcdef';
test('accepts only the exact owned local test database', () => {
  assert.doesNotThrow(() => assertOwnedTestDatabase(good, owned));
  for (const bad of [
    good.replace(owned.database, 'aka'),
    good.replace(owned.database, 'production_test'),
    good.replace(owned.database, 'aka_test_fedcba9876543210'),
    good.replace('127.0.0.1', 'db.example.com'),
    good.replace('127.0.0.1', 'localhost.evil'),
    good.replace('55432', '5432'),
    good.replace('aka_test_migrator', 'postgres'),
    `${good}?schema=other`,
    `${good}#other`,
    'private-canary',
  ]) {
    assert.throws(() => assertOwnedTestDatabase(bad, owned), /not owned/);
  }
});
test('rejects production names even when passed as ownership metadata', () => {
  assert.throws(() =>
    assertOwnedTestDatabase(good, { ...owned, database: 'production' }),
  );
});
test('storage cleanup requires the exact generated temporary path', () => {
  const storage = join(tmpdir(), 'aka-integration-abc123');
  assert.doesNotThrow(() => assertOwnedTestStorage(storage, storage));
  for (const bad of [
    '/',
    tmpdir(),
    '/data/documents',
    `${storage}/../documents`,
    `${storage}other`,
  ]) {
    assert.throws(() => assertOwnedTestStorage(bad, storage));
  }
});
