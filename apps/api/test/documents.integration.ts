import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  documentResponseSchema,
  documentListResponseSchema,
  errorResponseSchema,
} from '@aka/shared';
import type { DocumentList } from '@aka/shared';
import { AppModule } from '../src/app.module';
import { API_CONFIG } from '../src/config/config.module';
import { parseEnvironment } from '../src/config/environment';
import type { Environment } from '../src/config/environment';
import { DatabaseService } from '../src/database/database.service';
import { insertVectorChunk } from '../src/database/vector-sql';
import { configureHttp } from '../src/http';
import type { PrismaClient } from '../src/generated/prisma/client';
import { LocalDocumentStore } from '../src/modules/documents/local-document-store';
import { DocumentCleanupService } from '../src/modules/documents/document-cleanup.service';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('document API with real PostgreSQL and private temporary storage', () => {
  let app: NestExpressApplication;
  let db: PrismaClient;
  let root: string;
  let config: Environment;
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? '');
    if (
      !/^aka_test_[0-9a-f]{16}$/.test(process.env.AKA_TEST_DATABASE ?? '') ||
      target.pathname !== `/${process.env.AKA_TEST_DATABASE}` ||
      target.hostname !== '127.0.0.1' ||
      target.port !== process.env.AKA_TEST_PORT ||
      target.username !== 'aka_runtime' ||
      target.search ||
      target.hash ||
      process.env.NODE_ENV !== 'test' ||
      !process.env.STORAGE_ROOT?.startsWith(
        join(tmpdir(), 'aka-integration-'),
      ) ||
      (await lstat(process.env.STORAGE_ROOT)).isSymbolicLink()
    )
      throw new Error('Refusing unowned document integration target.');
  });
  async function start(overrides: Partial<Environment> = {}) {
    config = {
      ...parseEnvironment(process.env),
      STORAGE_ROOT: root,
      ...overrides,
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureHttp(app);
    await app.init();
    db = app.get(DatabaseService).client!;
  }
  beforeEach(async () => {
    root = await mkdtemp(join(process.env.STORAGE_ROOT!, 'documents-'));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (db) await db.document.deleteMany();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });
  function upload(
    content = 'text',
    filename = 'notes.txt',
    contentType = 'text/plain',
  ) {
    return request(app.getHttpServer())
      .post('/api/documents')
      .attach('file', Buffer.from(content), { filename, contentType });
  }
  async function storedPath(id: string) {
    const row = await db.document.findUniqueOrThrow({ where: { id } });
    return join(root, row.storagePath);
  }
  async function seed(
    status: 'failed' | 'pending' | 'processing' = 'failed',
    createdAt = new Date(),
  ) {
    const id = randomUUID();
    return db.document.create({
      data: {
        id,
        filename: 'seed.txt',
        mimeType: 'text/plain',
        size: 4,
        storagePath: `${id}/original.txt`,
        processingRunId: randomUUID(),
        status,
        createdAt,
      },
    });
  }

  it('persists all supported formats and duplicate names privately with pending DTOs', async () => {
    await start();
    const ids: string[] = [];
    for (const [filename, content, mime] of [
      ['notes.txt', 'snow 雪', 'text/plain'],
      ['notes.txt', 'duplicate', 'application/octet-stream'],
      ['notes.md', '# Notes', 'text/markdown'],
      ['notes.PDF', '%PDF-1.7\nsynthetic', 'application/pdf'],
      ['notes.markdown', '# More', 'text/markdown'],
    ]) {
      const response = await upload(content, filename, mime).expect(201);
      const dto = documentResponseSchema.parse(response.body).data;
      ids.push(dto.id);
      expect(dto).toMatchObject({
        filename,
        status: 'pending',
        size: Buffer.byteLength(content!),
        chunkCount: 0,
        processingError: null,
        processedAt: null,
      });
      expect(response.headers.location).toBe(`/api/documents/${dto.id}`);
      const path = await storedPath(dto.id);
      expect(await readFile(path, 'utf8')).toBe(content);
      expect((await lstat(path)).mode & 0o777).toBe(0o600);
      expect((await lstat(join(root, dto.id))).mode & 0o777).toBe(0o700);
      const detail = await request(app.getHttpServer())
        .get(`/api/documents/${dto.id}`)
        .expect(200);
      expect(documentResponseSchema.parse(detail.body).data).toEqual(dto);
      expect(response.text).not.toMatch(
        /storagePath|extractedContent|processingRunId|sourceMap|embedding/,
      );
      await request(app.getHttpServer())
        .get(`/api/documents/${dto.id}/original.txt`)
        .expect(404);
    }
    expect(new Set(ids).size).toBe(5);
    expect(await db.documentChunk.count()).toBe(0);
    expect((await readdir(root)).some((name) => name.endsWith('.upload'))).toBe(
      false,
    );
    await request(app.getHttpServer())
      .post(`/api/documents/${ids[0]}/reprocess`)
      .expect(404);
    expect(
      (await db.document.findMany()).every((row) => row.status === 'pending'),
    ).toBe(true);
  });

  it.each([
    ['x.exe', 'text/plain', Buffer.from('hello'), 415],
    ['x.pdf', 'application/pdf', Buffer.from('fake pdf'), 415],
    ['x.txt', 'application/pdf', Buffer.from('hello'), 415],
    ['x.txt', 'text/plain', Buffer.alloc(0), 422],
    ['x.txt', 'text/plain', Buffer.from([0xff, 0xfe]), 422],
    ['x.md', 'text/markdown', Buffer.from([0, 1, 2]), 422],
    ['x.txt', 'text/plain', Buffer.from(' '.repeat(5)), 422],
    ['x.txt', 'text/plain', Buffer.alloc(17, 'a'), 413],
  ])(
    'rejects invalid/oversize %s without rows or files (%s)',
    async (filename, contentType, bytes, status) => {
      await start({ MAX_UPLOAD_BYTES: 16 });
      const response = await request(app.getHttpServer())
        .post('/api/documents')
        .attach('file', bytes, { filename, contentType })
        .expect(status);
      errorResponseSchema.parse(response.body);
      expect(response.text).not.toContain(root);
      expect(await db.document.count()).toBe(0);
      expect(await readdir(root)).toEqual([]);
    },
  );

  it('accepts the exact byte boundary; rejects additional fields/files and malformed multipart', async () => {
    await start({ MAX_UPLOAD_BYTES: 4 });
    const dto = documentResponseSchema.parse(
      (await upload('1234').expect(201)).body,
    ).data;
    await request(app.getHttpServer())
      .delete(`/api/documents/${dto.id}`)
      .expect(204);
    await upload().field('extra', 'forbidden').expect(400);
    await upload().attach('other', Buffer.from('x'), 'x.txt').expect(400);
    await request(app.getHttpServer())
      .post('/api/documents')
      .attach('wrong', Buffer.from('x'), 'x.txt')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/documents')
      .set('Content-Type', 'multipart/form-data; boundary=broken')
      .send('--broken\r\n')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/documents')
      .send({ file: 'x' })
      .expect(400);
    expect(await db.document.count()).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });

  it('validates UUID, whitelisted queries, missing documents and bodyless DELETE', async () => {
    await start();
    const id = randomUUID();
    await request(app.getHttpServer())
      .get(`/api/documents/${id}`)
      .expect(404)
      .expect((r) => {
        expect(errorResponseSchema.parse(r.body).error.code).toBe(
          'DOCUMENT_NOT_FOUND',
        );
      });
    await request(app.getHttpServer())
      .delete(`/api/documents/${id}`)
      .expect(204)
      .expect('');
    for (const method of ['get', 'delete'] as const) {
      const client = request(app.getHttpServer());
      await client[method]('/api/documents/invalid').expect(400);
    }
    for (const query of [
      'limit=0',
      'limit=1.2',
      'limit=101',
      'limit=1&limit=2',
      'status=unknown',
      'extra=x',
      'cursor=bad',
    ])
      await request(app.getHttpServer())
        .get(`/api/documents?${query}`)
        .expect(400);
    await request(app.getHttpServer())
      .delete(`/api/documents/${id}`)
      .send({})
      .expect(400);
  });

  it('paginates tied timestamps deterministically and binds cursors to filters', async () => {
    await start();
    const time = new Date('2026-11-16T12:00:00.000Z');
    const rows = await Promise.all(
      Array.from({ length: 8 }, () => seed('failed', time)),
    );
    await seed('pending', time);
    const expected = rows
      .map((row) => row.id)
      .sort()
      .reverse();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await request(app.getHttpServer())
        .get('/api/documents')
        .query({ limit: '3', status: 'failed', ...(cursor ? { cursor } : {}) })
        .expect(200);
      const data: DocumentList = documentListResponseSchema.parse(
        response.body,
      ).data;
      seen.push(...data.items.map((row) => row.id));
      cursor = data.pagination.nextCursor;
      if (cursor) {
        await request(app.getHttpServer())
          .get('/api/documents')
          .query({ status: 'pending', cursor })
          .expect(400);
        await request(app.getHttpServer())
          .get('/api/documents')
          .query({ status: 'failed', cursor: 'x' + cursor.slice(1) })
          .expect(400);
      }
    } while (cursor);
    expect(seen).toEqual(expected);
  });

  it.each([
    { MAX_PENDING_DOCUMENTS: 1 },
    { MAX_DOCUMENTS: 1 },
    { MAX_STORED_BYTES: 4 },
  ])(
    'serializes racing quota admissions %j and compensates the rejected file',
    async (limits) => {
      await start(limits);
      const results = await Promise.all([upload(), upload()]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        errorResponseSchema.parse(results.find((r) => r.status === 409)!.body)
          .error.code,
      ).toBe('CAPACITY_EXCEEDED');
      expect(await db.document.count()).toBe(1);
      expect(await readdir(root)).toHaveLength(1);
    },
  );

  it('compensates a failed insert transaction and maps storage errors safely', async () => {
    await start();
    jest
      .spyOn(db, '$transaction')
      .mockRejectedValueOnce(new Error('secret database fault'));
    const response = await upload().expect(500);
    expect(errorResponseSchema.parse(response.body).error.code).toBe(
      'INTERNAL_ERROR',
    );
    expect(response.text).not.toContain('secret');
    expect(await db.document.count()).toBe(0);
    expect(await readdir(root)).toEqual([]);
    jest
      .spyOn(app.get(LocalDocumentStore), 'promote')
      .mockRejectedValueOnce(new Error(root));
    const storage = await upload().expect(500);
    expect(errorResponseSchema.parse(storage.body).error.code).toBe(
      'STORAGE_ERROR',
    );
    expect(storage.text).not.toContain(root);
    expect(await readdir(root)).toEqual([]);
    jest
      .spyOn(app.get(LocalDocumentStore), 'readStage')
      .mockRejectedValueOnce(new Error(root));
    const unreadable = await upload().expect(500);
    expect(errorResponseSchema.parse(unreadable.body).error.code).toBe(
      'STORAGE_ERROR',
    );
    expect(await readdir(root)).toEqual([]);
  });

  it('counts processing rows in pending admission and permits concurrent delete retries', async () => {
    await start({ MAX_PENDING_DOCUMENTS: 1 });
    const processing = await seed('processing');
    await upload().expect(409);
    expect(await readdir(root)).toEqual([]);
    await request(app.getHttpServer())
      .delete(`/api/documents/${processing.id}`)
      .expect(204);
    const dto = documentResponseSchema.parse(
      (await upload().expect(201)).body,
    ).data;
    await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .delete(`/api/documents/${dto.id}`)
          .expect(204),
      ),
    );
    expect(await db.document.count()).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });

  it('fences processing and clears indexed content before unlink; retains retryable cleanup failure', async () => {
    await start();
    const dto = documentResponseSchema.parse(
      (await upload().expect(201)).body,
    ).data;
    const path = await storedPath(dto.id);
    const row = await db.document.update({
      where: { id: dto.id },
      data: {
        status: 'processing',
        extractedContent: 'text',
        sourceMap: [],
        chunkCount: 1,
        processedAt: new Date(),
      },
    });
    await insertVectorChunk(db, {
      documentId: dto.id,
      processingRunId: row.processingRunId,
      content: 'text',
      chunkIndex: 0,
      tokenCount: 1,
      sourceLocation: {},
      embedding: [1, ...Array<number>(1535).fill(0)],
    });
    const store = app.get(LocalDocumentStore);
    const remove = store.removeOriginal.bind(store);
    jest.spyOn(store, 'removeOriginal').mockImplementationOnce(async () => {
      const deleting = await db.document.findUniqueOrThrow({
        where: { id: dto.id },
      });
      expect(deleting).toMatchObject({
        status: 'deleting',
        chunkCount: 0,
        extractedContent: null,
        sourceMap: null,
        processedAt: null,
      });
      expect(deleting.processingRunId).not.toBe(row.processingRunId);
      expect(await db.documentChunk.count()).toBe(0);
      throw new Error('controlled unlink fault');
    });
    await request(app.getHttpServer())
      .delete(`/api/documents/${dto.id}`)
      .expect(500);
    const detail = documentResponseSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/api/documents/${dto.id}`)
          .expect(200)
      ).body,
    ).data;
    expect(detail).toMatchObject({
      status: 'deleting',
      processingError: { code: 'DELETE_FAILED', retryable: true },
    });
    expect(await readFile(path, 'utf8')).toBe('text');
    expect(
      documentListResponseSchema.parse(
        (
          await request(app.getHttpServer())
            .get('/api/documents?status=deleting')
            .expect(200)
        ).body,
      ).data.items,
    ).toHaveLength(1);
    jest.spyOn(store, 'removeOriginal').mockImplementation(remove);
    await request(app.getHttpServer())
      .delete(`/api/documents/${dto.id}`)
      .expect(204)
      .expect('');
    await request(app.getHttpServer())
      .delete(`/api/documents/${dto.id}`)
      .expect(204)
      .expect('');
    expect(await db.document.count()).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });

  it('retries missing originals and database finalization failures; deleting rows reserve capacity', async () => {
    await start({ MAX_DOCUMENTS: 1 });
    const dto = documentResponseSchema.parse(
      (await upload().expect(201)).body,
    ).data;
    jest
      .spyOn(db.document, 'deleteMany')
      .mockRejectedValueOnce(new Error('finalization fault'));
    await request(app.getHttpServer())
      .delete(`/api/documents/${dto.id}`)
      .expect(500);
    expect(await readdir(root)).toEqual([]);
    await upload().expect(409);
    expect(await readdir(root)).toEqual([]);
    await request(app.getHttpServer())
      .delete(`/api/documents/${dto.id}`)
      .expect(204);
    const next = documentResponseSchema.parse(
      (await upload().expect(201)).body,
    ).data;
    await unlink(await storedPath(next.id));
    await request(app.getHttpServer())
      .delete(`/api/documents/${next.id}`)
      .expect(204);
    expect(await db.document.count()).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });

  it('rolls back a failed deleting transition without removing the original', async () => {
    await start();
    const dto = documentResponseSchema.parse(
      (await upload().expect(201)).body,
    ).data;
    jest
      .spyOn(db, '$transaction')
      .mockRejectedValueOnce(new Error('transaction failure'));
    await request(app.getHttpServer())
      .delete(`/api/documents/${dto.id}`)
      .expect(500);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: dto.id } })).status,
    ).toBe('pending');
    expect(await readFile(await storedPath(dto.id), 'utf8')).toBe('text');
    await request(app.getHttpServer())
      .delete(`/api/documents/${dto.id}`)
      .expect(204);
  });

  it('reconciles deleting rows and aged orphans on restart and on the hourly timer', async () => {
    await start();
    const dto = documentResponseSchema.parse(
      (await upload().expect(201)).body,
    ).data;
    await db.document.update({
      where: { id: dto.id },
      data: { status: 'deleting' },
    });
    const orphan = `${randomUUID()}/original.txt`;
    await mkdir(join(root, orphan.split('/')[0]!));
    await writeFile(join(root, orphan), 'orphan');
    const old = new Date(Date.now() - 7200000);
    await utimes(join(root, orphan), old, old);
    await app.close();
    await start();
    expect(await db.document.count()).toBe(0);
    await expect(lstat(join(root, orphan))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const stage = `${randomUUID()}.upload`;
    await writeFile(join(root, stage), 'orphan');
    await utimes(join(root, stage), old, old);
    const cleanup = app.get(DocumentCleanupService);
    await cleanup.onApplicationShutdown();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      await cleanup.onApplicationBootstrap();
      const sweep = jest.spyOn(cleanup, 'reconcile');
      await jest.advanceTimersByTimeAsync(3600000);
      await cleanup.reconcile();
      expect(sweep).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
    expect((await readdir(root)).includes(stage)).toBe(false);
  });

  it('enforces rate/Origin/Host admission with safe 429 and Retry-After', async () => {
    await start({
      UPLOAD_REQUESTS_PER_MINUTE: 1,
      DOCUMENT_REQUESTS_PER_MINUTE: 2,
    });
    await upload().set('Origin', 'http://evil.example').expect(403);
    await request(app.getHttpServer())
      .get('/api/documents')
      .set('Host', 'evil.example')
      .expect(403);
    await upload().set('Origin', config.WEB_ORIGIN).expect(201);
    const limited = await upload()
      .set('X-Forwarded-For', 'other-client')
      .expect(429);
    expect(errorResponseSchema.parse(limited.body).error.code).toBe(
      'RATE_LIMITED',
    );
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await request(app.getHttpServer()).get('/api/documents').expect(200);
    await request(app.getHttpServer()).get('/api/documents').expect(200);
    await request(app.getHttpServer()).get('/api/documents').expect(429);
  });

  it('bounds simultaneous streams and cleans partial files on disconnect', async () => {
    await start();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const clients = Array.from({ length: 2 }, () => {
      const client = httpRequest({
        host: '127.0.0.1',
        port: address.port,
        path: '/api/documents',
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=stream' },
      });
      client.on('error', () => undefined);
      client.write(
        '--stream\r\nContent-Disposition: form-data; name="file"; filename="partial.txt"\r\nContent-Type: text/plain\r\n\r\npartial',
      );
      return client;
    });
    try {
      for (let i = 0; i < 100 && (await readdir(root)).length < 2; i++)
        await delay(10);
      expect(await readdir(root)).toHaveLength(2);
      await upload().expect(429);
    } finally {
      clients.forEach((client) => client.destroy());
    }
    for (let i = 0; i < 100 && (await readdir(root)).length > 0; i++)
      await delay(10);
    expect(await readdir(root)).toEqual([]);
    expect(await db.document.count()).toBe(0);
    await upload().expect(201);
  });

  it('expires stalled multipart streams and cleans their staging files', async () => {
    await start({ UPLOAD_TIMEOUT_MS: 50 });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const status = await new Promise<number>((resolve, reject) => {
      const client = httpRequest(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/api/documents',
          method: 'POST',
          headers: { 'Content-Type': 'multipart/form-data; boundary=stalled' },
        },
        (response) => {
          response.resume();
          response.once('end', () => {
            resolve(response.statusCode!);
            client.destroy();
          });
        },
      );
      client.on('error', reject);
      client.write(
        '--stalled\r\nContent-Disposition: form-data; name="file"; filename="partial.txt"\r\nContent-Type: text/plain\r\n\r\npartial',
      );
    });
    expect(status).toBe(400);
    expect(await readdir(root)).toEqual([]);
    expect(await db.document.count()).toBe(0);
  });
});
