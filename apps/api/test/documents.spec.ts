import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  symlink,
  utimes,
  readFile,
  rm,
  lstat,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnvironment } from '../src/config/environment';
import { ApiError } from '../src/api-error';
import {
  sanitizeFilename,
  validateFormat,
} from '../src/modules/documents/validation';
import {
  assertOriginalPath,
  LocalDocumentStore,
} from '../src/modules/documents/local-document-store';
import { DocumentCursors } from '../src/modules/documents/cursor';
import { assertCapacity } from '../src/modules/documents/documents.service';
import { documentListQuerySchema } from '@aka/shared';

describe('document input and quota rules', () => {
  it.each([
    ['notes.TXT', '', 'hello 雪', 'text/plain'],
    ['notes.md', 'application/octet-stream', '# title', 'text/markdown'],
    ['notes.markdown', 'text/markdown', '# title', 'text/markdown'],
    ['notes.pdf', 'application/pdf', '%PDF-1.7\nfixture', 'application/pdf'],
  ])(
    'validates bytes and canonical format for %s',
    (name, mime, content, expected) => {
      expect(validateFormat(name, mime, Buffer.from(content)).mimeType).toBe(
        expected,
      );
    },
  );
  it.each([
    ['x.exe', '', Buffer.from('text'), 415],
    ['x.txt', 'application/pdf', Buffer.from('text'), 415],
    ['x.pdf', '', Buffer.from('text'), 415],
    [
      'x.pdf',
      '',
      Buffer.from([0xa5, 0xd0, 0xc4, 0xc6, 0xad, 0xb1, 0xae, 0xb7, 10]),
      415,
    ],
    ['x.txt', '', Buffer.from('%PDF-1.7\ntext'), 415],
    ['x.txt', '', Buffer.from(' \n\t'), 422],
    ['x.txt', '', Buffer.from([0xc0, 0xaf]), 422],
    ['x.md', '', Buffer.from([0, 1, 2]), 422],
    ['x.txt', '', Buffer.alloc(0), 422],
  ])('rejects invalid input %s (%s)', (name, mime, bytes, status) => {
    try {
      validateFormat(name, mime, bytes);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).getStatus()).toBe(status);
    }
  });
  it('sanitizes display basenames and preserves Unicode boundaries', () => {
    expect(sanitizeFilename('C:\\private\\../\u202enotes\u0000.txt')).toBe(
      'notes.txt',
    );
    expect(sanitizeFilename('../')).toBe('document');
    expect(sanitizeFilename('a'.repeat(254) + '😀.txt')).toBe(
      'a'.repeat(251) + '.txt',
    );
  });
  it('accepts exact quota boundaries and rejects every exhausted reservation', () => {
    const config = parseEnvironment({});
    expect(() =>
      assertCapacity(99, config.MAX_STORED_BYTES - 4, 4, 4, config),
    ).not.toThrow();
    for (const values of [
      [100, 0, 0],
      [0, config.MAX_STORED_BYTES - 3, 0],
      [0, 0, 5],
    ]) {
      expect(() =>
        assertCapacity(values[0]!, values[1]!, values[2]!, 4, config),
      ).toThrow(ApiError);
    }
  });
  it('signs and filter-binds cursors; rejects altered and restarted tokens', () => {
    const cursors = new DocumentCursors();
    const date = new Date();
    const id = randomUUID();
    const cursor = cursors.encode(date, id, 'pending');
    expect(cursors.decode(cursor, 'pending')).toEqual({ createdAt: date, id });
    for (const token of ['bad', cursor.slice(0, -1), 'x' + cursor.slice(1)])
      expect(() => cursors.decode(token, 'pending')).toThrow();
    expect(() => cursors.decode(cursor, 'ready')).toThrow();
    expect(() => new DocumentCursors().decode(cursor, 'pending')).toThrow();
  });
  it.each([
    { limit: '' },
    { limit: '1.2' },
    { limit: '101' },
    { limit: ['1', '2'] },
    { extra: 'x' },
    { status: 'unknown' },
  ])('rejects invalid query %j', (query) => {
    expect(documentListQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('private local storage containment', () => {
  let root: string;
  let store: LocalDocumentStore;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aka-store-test-'));
    store = new LocalDocumentStore(parseEnvironment({ STORAGE_ROOT: root }));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it('rejects traversal, malformed IDs/extensions, root/directory/file symlinks', async () => {
    for (const path of [
      '../outside',
      '/tmp/file',
      `${randomUUID()}/other.txt`,
      `${randomUUID()}/original.exe`,
    ]) {
      expect(() => assertOriginalPath(path)).toThrow();
    }
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'original.txt'), 'safe');
    const id = randomUUID();
    await symlink(outside, join(root, id));
    await expect(store.removeOriginal(`${id}/original.txt`)).rejects.toThrow();
    expect(await readFile(join(outside, 'original.txt'), 'utf8')).toBe('safe');
    const otherId = randomUUID();
    await mkdir(join(root, otherId));
    await symlink(
      join(outside, 'original.txt'),
      join(root, otherId, 'original.txt'),
    );
    await expect(
      store.removeOriginal(`${otherId}/original.txt`),
    ).rejects.toThrow();
    await symlink(outside, join(root, 'alias'));
    const stage = `${randomUUID()}.upload`;
    await symlink(join(outside, 'original.txt'), join(root, stage));
    await expect(store.readStage(stage)).rejects.toThrow();
    await expect(
      store.promote(stage, `${randomUUID()}/original.txt`),
    ).rejects.toThrow();
    const linked = new LocalDocumentStore(
      parseEnvironment({ STORAGE_ROOT: join(root, 'alias', 'new') }),
    );
    await expect(linked.ensureRoot()).rejects.toThrow();
    expect(await readdir(outside)).toEqual(['original.txt']);
  });
  it('only removes aged, generated, unreferenced files, never follows symlinks', async () => {
    const old = new Date(Date.now() - 7200000);
    const stage = `${randomUUID()}.upload`;
    await writeFile(join(root, stage), 'old');
    await utimes(join(root, stage), old, old);
    const recent = `${randomUUID()}.upload`;
    await writeFile(join(root, recent), 'new');
    const paths = [randomUUID(), randomUUID()].map(
      (id) => `${id}/original.txt`,
    );
    for (const path of paths) {
      await mkdir(join(root, path.split('/')[0]!));
      await writeFile(join(root, path), 'keep or remove');
      await utimes(join(root, path), old, old);
    }
    await writeFile(join(root, 'unknown'), 'keep');
    await utimes(join(root, 'unknown'), old, old);
    const link = `${randomUUID()}.upload`;
    await symlink(join(root, 'unknown'), join(root, link));
    await store.cleanupOrphans(new Set([paths[0]!]));
    expect(await readdir(root)).not.toContain(stage);
    expect(await readFile(join(root, paths[0]!), 'utf8')).toBe(
      'keep or remove',
    );
    await expect(lstat(join(root, paths[1]!))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await lstat(join(root, link))).isSymbolicLink()).toBe(true);
    expect(await readdir(root)).toEqual(
      expect.arrayContaining([recent, 'unknown', link]),
    );
  });
});
