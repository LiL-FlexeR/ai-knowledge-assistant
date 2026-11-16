import { tmpdir } from 'node:os';
import { dirname, basename } from 'node:path';

// Strict ownership, not a permissive substring check such as /test/.
export function assertOwnedTestDatabase(value, { database, port }) {
  try {
    const url = new URL(value);
    if (
      !/^aka_test_[0-9a-f]{16}$/.test(database) ||
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      url.port !== String(port) ||
      url.pathname !== `/${database}` ||
      !['aka_test_migrator', 'aka_runtime'].includes(url.username) ||
      !url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    throw new Error(
      'Refusing a database target not owned by this integration run.',
    );
  }
}

export function assertOwnedTestStorage(value, ownedPath) {
  if (
    value !== ownedPath ||
    dirname(value) !== tmpdir() ||
    !/^aka-integration-[a-zA-Z0-9]+$/.test(basename(value))
  ) {
    throw new Error(
      'Refusing storage cleanup outside the owned integration directory.',
    );
  }
}
