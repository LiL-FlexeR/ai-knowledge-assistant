import 'reflect-metadata';
import { lstat, mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { documentResponseSchema, sourceLocationSchema } from '@aka/shared';
import { AppModule } from '../src/app.module';
import { API_CONFIG } from '../src/config/config.module';
import { parseEnvironment } from '../src/config/environment';
import type { Environment } from '../src/config/environment';
import { DatabaseService } from '../src/database/database.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import * as vectorSql from '../src/database/vector-sql';
import { configureHttp } from '../src/http';
import { EmbeddingClient } from '../src/modules/ai/embedding-client';
import type { EmbeddingResult } from '../src/modules/ai/embedding-client';
import { IngestionRunner } from '../src/modules/ingestion/ingestion-runner';
import { IngestionPersistence } from '../src/modules/ingestion/ingestion-persistence';
import { ProcessingFailure } from '../src/processing-error';
import { FakeEmbeddingClient } from './fixtures/fake-embedding-client';
import { syntheticPdf, imageOnlyPdf } from './fixtures/synthetic-pdf';

describe('S03 REST ingestion with real pgvector and fake AI', () => {
  let app: NestExpressApplication;
  let db: PrismaClient;
  let root: string;
  let config: Environment;
  let fake: FakeEmbeddingClient;
  let runner: IngestionRunner;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      !/^aka_test_[0-9a-f]{16}$/.test(process.env.AKA_TEST_DATABASE ?? '') ||
      url.pathname !== `/${process.env.AKA_TEST_DATABASE}` ||
      url.hostname !== '127.0.0.1' ||
      url.port !== process.env.AKA_TEST_PORT ||
      url.username !== 'aka_runtime' ||
      url.search ||
      url.hash ||
      process.env.NODE_ENV !== 'test' ||
      !process.env.STORAGE_ROOT?.startsWith(
        join(tmpdir(), 'aka-integration-'),
      ) ||
      (await lstat(process.env.STORAGE_ROOT)).isSymbolicLink()
    )
      throw new Error('Refusing unowned ingestion target.');
  });
  async function start(overrides: Partial<Environment> = {}) {
    config = {
      ...parseEnvironment(process.env),
      OPENAI_API_KEY: 'fake-integration-only',
      INGESTION_POLL_MS: 60000,
      STORAGE_ROOT: root,
      ...overrides,
    };
    fake = new FakeEmbeddingClient();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .overrideProvider(EmbeddingClient)
      .useValue(fake)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureHttp(app);
    await app.init();
    db = app.get(DatabaseService).client!;
    runner = app.get(IngestionRunner);
  }
  beforeEach(async () => {
    root = await mkdtemp(join(process.env.STORAGE_ROOT!, 'ingestion-'));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await runner?.beforeApplicationShutdown();
    await db?.document.deleteMany();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });
  async function upload(
    content: string | Buffer = 'Synthetic Sunday maintenance at 02:00 UTC.',
    filename = 'notes.txt',
    mime = 'text/plain',
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/documents')
      .attach('file', Buffer.from(content), { filename, contentType: mime })
      .expect(201);
    return documentResponseSchema.parse(response.body).data;
  }
  async function detail(id: string) {
    return documentResponseSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/api/documents/${id}`)
          .expect(200)
      ).body,
    ).data;
  }
  async function chunks(id: string) {
    return db.$queryRaw<
      {
        id: string;
        content: string;
        chunkIndex: number;
        location: unknown;
        run: string;
        dimensions: number;
      }[]
    >`SELECT id, content, chunk_index AS "chunkIndex", source_location AS location, processing_run_id AS run, vector_dims(embedding) AS dimensions FROM document_chunks WHERE document_id = ${id}::uuid ORDER BY chunk_index`;
  }
  it.each([
    [
      'notes.txt',
      'text/plain',
      Buffer.from('\uFEFFCafe\u0301\r\nSunday\t \r\n'),
      'text',
    ],
    [
      'handbook.pdf',
      'application/pdf',
      syntheticPdf(['Sunday maintenance', 'Policy owner: team']),
      'pdf',
    ],
    [
      'notes.md',
      'text/markdown',
      Buffer.from('# First\na\n# First\nb\n'),
      'markdown',
    ],
  ])(
    'uploads %s and publishes a complete source/profile/vector generation',
    async (filename, mime, bytes, kind) => {
      await start();
      const uploaded = await upload(bytes, filename, mime);
      expect(uploaded.status).toBe('pending');
      fake.handler = async (inputs) => {
        const row = await db.document.findUniqueOrThrow({
          where: { id: uploaded.id },
        });
        expect(row.status).toBe('processing');
        expect(row.extractedContent).toBeNull();
        expect(await chunks(row.id)).toEqual([]);
        return {
          vectors: inputs.map(() => [1, ...Array<number>(1535).fill(0)]),
          inputTokens: 7,
        };
      };
      await runner.tick();
      expect(await detail(uploaded.id)).toMatchObject({
        status: 'ready',
        processingError: null,
      });
      const row = await db.document.findUniqueOrThrow({
        where: { id: uploaded.id },
      });
      expect(row).toMatchObject({
        embeddingProfileId: config.EMBEDDING_PROFILE_ID,
        embeddingModel: config.OPENAI_EMBEDDING_MODEL,
        embeddingDimensions: 1536,
        pipelineVersion: 'v1',
      });
      const units = row.sourceMap as unknown as {
        contentStart: number;
        contentEnd: number;
      }[];
      const published = await chunks(row.id);
      expect(published).toHaveLength(row.chunkCount);
      for (const [index, chunk] of published.entries()) {
        const location = sourceLocationSchema.parse(chunk.location);
        expect(location.kind).toBe(kind);
        expect(chunk.chunkIndex).toBe(index);
        expect(chunk.run).toBe(row.processingRunId);
        expect(chunk.dimensions).toBe(1536);
        const unit = units[location.unitIndex]!;
        expect(chunk.content).toBe(
          row.extractedContent!.slice(
            unit.contentStart + location.charStart,
            unit.contentStart + location.charEnd,
          ),
        );
      }
      if (kind === 'pdf')
        expect(
          published.map((chunk) => sourceLocationSchema.parse(chunk.location)),
        ).toMatchObject([{ page: 1 }, { page: 2 }]);
      await expect(readFile(join(root, row.storagePath))).resolves.toEqual(
        bytes,
      );
    },
  );
  it.each([
    ['scanned.pdf', imageOnlyPdf(), 'NO_EXTRACTABLE_TEXT'],
    ['malformed.pdf', Buffer.from('%PDF-1.7\nbroken'), 'UNSUPPORTED_PDF'],
    ['encrypted.pdf', syntheticPdf(['secret'], true), 'UNSUPPORTED_PDF'],
  ])(
    'safely persists %s failure while retaining the original',
    async (name, bytes, code) => {
      await start();
      const uploaded = await upload(bytes, name, 'application/pdf');
      await runner.tick();
      expect(await detail(uploaded.id)).toMatchObject({
        status: 'failed',
        chunkCount: 0,
        processingError: { code, retryable: false },
      });
      const row = await db.document.findUniqueOrThrow({
        where: { id: uploaded.id },
      });
      expect(row.extractedContent).toBeNull();
      expect(row.sourceMap).toBeNull();
      expect(await chunks(row.id)).toEqual([]);
      expect(await readFile(join(root, row.storagePath))).toEqual(bytes);
      expect(fake.calls).toHaveLength(0);
    },
  );
  it('fails over-budget documents before paid work and rejects invalid provider vectors', async () => {
    await start({ MAX_DOCUMENT_TOKENS: 1 });
    const over = await upload('many separate words in this file');
    await runner.tick();
    expect((await detail(over.id)).processingError?.code).toBe(
      'EXTRACTION_LIMIT_EXCEEDED',
    );
    expect(fake.calls).toHaveLength(0);
    config.MAX_DOCUMENT_TOKENS = 100000;
    const invalid = await upload();
    fake.handler = async () => ({ vectors: [[0]], inputTokens: null });
    await runner.tick();
    expect((await detail(invalid.id)).processingError?.code).toBe(
      'AI_OUTPUT_INVALID',
    );
    expect(await chunks(invalid.id)).toEqual([]);
  });
  it('rolls back earlier SQL inserts if publication fails midway', async () => {
    await start();
    const uploaded = await upload(
      syntheticPdf(['one', 'two']),
      'two.pdf',
      'application/pdf',
    );
    const insert = vectorSql.insertVectorChunk;
    jest
      .spyOn(vectorSql, 'insertVectorChunk')
      .mockImplementationOnce(insert)
      .mockRejectedValueOnce(new Error('controlled insert failure'));
    await runner.tick();
    expect((await detail(uploaded.id)).status).toBe('failed');
    expect(await chunks(uploaded.id)).toEqual([]);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: uploaded.id } }))
        .extractedContent,
    ).toBeNull();
  });
  it('reprocesses a transient failed run, clears a ready generation, and preserves metadata', async () => {
    await start();
    const uploaded = await upload();
    fake.handler = async () => {
      throw new ProcessingFailure(
        'AI_UPSTREAM_ERROR',
        'Embedding provider request failed.',
        true,
      );
    };
    await runner.tick();
    expect((await detail(uploaded.id)).processingError?.retryable).toBe(true);
    fake.handler = undefined;
    const before = await db.document.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    const response = await request(app.getHttpServer())
      .post(`/api/documents/${uploaded.id}/reprocess`)
      .expect(202);
    expect(documentResponseSchema.parse(response.body).data).toMatchObject({
      status: 'pending',
      processingError: null,
      createdAt: uploaded.createdAt,
    });
    expect(response.headers.location).toBe(`/api/documents/${uploaded.id}`);
    await runner.tick();
    const first = await chunks(uploaded.id);
    expect(first.length).toBeGreaterThan(0);
    await request(app.getHttpServer())
      .post(`/api/documents/${uploaded.id}/reprocess`)
      .expect(202);
    expect(await chunks(uploaded.id)).toEqual([]);
    const reset = await db.document.findUniqueOrThrow({
      where: { id: uploaded.id },
    });
    expect(reset).toMatchObject({
      chunkCount: 0,
      extractedContent: null,
      sourceMap: null,
      embeddingProfileId: null,
      embeddingModel: null,
      embeddingDimensions: null,
      pipelineVersion: null,
      processedAt: null,
      processingStartedAt: null,
    });
    expect(reset.processingRunId).not.toBe(before.processingRunId);
    expect(reset.storagePath).toBe(before.storagePath);
    await runner.tick();
    expect((await chunks(uploaded.id))[0]!.id).not.toBe(first[0]!.id);
    expect((await detail(uploaded.id)).status).toBe('ready');
  });
  it('fences and aborts provider work during deletion without resurrecting chunks', async () => {
    await start();
    const uploaded = await upload();
    let entered!: () => void;
    const called = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: (value: EmbeddingResult) => void;
    fake.handler = () =>
      new Promise((resolve) => {
        finish = resolve;
        entered();
      });
    const running = runner.tick();
    await called;
    await request(app.getHttpServer())
      .delete(`/api/documents/${uploaded.id}`)
      .expect(204);
    expect(fake.calls[0]!.signal.aborted).toBe(true);
    await running;
    finish({ vectors: [[1, ...Array<number>(1535).fill(0)]], inputTokens: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(
      await db.document.findUnique({ where: { id: uploaded.id } }),
    ).toBeNull();
    expect(await chunks(uploaded.id)).toEqual([]);
    expect(await db.document.count()).toBe(0);
  });
  it('skips paid work when deletion wins the claim-to-registration race', async () => {
    await start();
    const uploaded = await upload();
    const persistence = app.get(IngestionPersistence);
    const claim = persistence.claim.bind(persistence);
    jest.spyOn(persistence, 'claim').mockImplementationOnce(async () => {
      const document = await claim();
      await request(app.getHttpServer())
        .delete(`/api/documents/${uploaded.id}`)
        .expect(204);
      return document;
    });
    await runner.tick();
    expect(fake.calls).toHaveLength(0);
    expect(await chunks(uploaded.id)).toEqual([]);
    expect(await db.document.count()).toBe(0);
  });

  it('recovers interrupted processing as failed and resumes pending without paid retry', async () => {
    await start();
    const interrupted = await upload();
    const pending = await upload('pending recovery');
    await db.document.update({
      where: { id: interrupted.id },
      data: { status: 'processing' },
    });
    await app.close();
    await start();
    expect((await detail(interrupted.id)).processingError?.code).toBe(
      'PROCESSING_INTERRUPTED',
    );
    expect(fake.calls).toHaveLength(0);
    await runner.tick();
    expect((await detail(pending.id)).status).toBe('ready');
    expect(fake.calls).toHaveLength(1);
  });
  it('rejects a late old-run publication and failure after run invalidation', async () => {
    await start();
    const uploaded = await upload();
    const persistence = app.get(IngestionPersistence);
    const claimed = (await persistence.claim())!;
    await db.document.update({
      where: { id: uploaded.id },
      data: { processingRunId: randomUUID(), status: 'pending' },
    });
    const { prepareSources } =
      await import('../src/modules/ingestion/source-processing.js');
    const prepared = prepareSources(['text'], 'text/plain', config);
    expect(
      await persistence.publish(
        claimed,
        prepared,
        [[1, ...Array<number>(1535).fill(0)]],
        new AbortController().signal,
      ),
    ).toBe(false);
    await persistence.fail(
      claimed,
      new ProcessingFailure('AI_TIMEOUT', 'Timed out.', true),
    );
    expect((await detail(uploaded.id)).status).toBe('pending');
    expect(await chunks(uploaded.id)).toEqual([]);
  });
  it('serializes reprocess admission, rejects busy/missing originals, and validates transport', async () => {
    await start();
    const a = await upload();
    const b = await upload('two');
    await db.document.updateMany({ data: { status: 'failed' } });
    config.MAX_PENDING_DOCUMENTS = 1;
    const results = await Promise.all(
      [a, b].map((row) =>
        request(app.getHttpServer()).post(`/api/documents/${row.id}/reprocess`),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
    const accepted = [a, b][results.findIndex((r) => r.status === 202)]!;
    await request(app.getHttpServer())
      .post(`/api/documents/${accepted.id}/reprocess`)
      .expect(409);
    const other = [a, b].find((row) => row.id !== accepted.id)!;
    const row = await db.document.findUniqueOrThrow({
      where: { id: other.id },
    });
    await unlink(join(root, row.storagePath));
    const missing = await request(app.getHttpServer())
      .post(`/api/documents/${other.id}/reprocess`)
      .expect(409);
    expect(missing.body.error.code).toBe('ORIGINAL_FILE_MISSING');
    await request(app.getHttpServer())
      .post(`/api/documents/${randomUUID()}/reprocess`)
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/documents/bad/reprocess')
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/documents/${a.id}/reprocess`)
      .send({})
      .expect(400);
  });
  it('keeps pending uploads durable and readiness unavailable when AI is not configured', async () => {
    await start();
    delete config.OPENAI_API_KEY;
    const uploaded = await upload();
    await runner.tick();
    expect((await detail(uploaded.id)).status).toBe('pending');
    expect(fake.calls).toHaveLength(0);
    await request(app.getHttpServer()).get('/api/health').expect(200);
    const response = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(503);
    expect(response.body.error.details).toContainEqual({
      path: 'aiConfiguration',
      message: 'Check failed.',
    });
  });

  it('enforces whole-run deadline, cancels shutdown and leaves no partial evidence', async () => {
    await start({ INGESTION_TIMEOUT_MS: 800 });
    const uploaded = await upload();
    fake.handler = () => new Promise(() => undefined);
    await runner.tick();
    expect((await detail(uploaded.id)).processingError?.code).toBe(
      'AI_TIMEOUT',
    );
    expect(await chunks(uploaded.id)).toEqual([]);
    expect(fake.calls[0]?.signal.aborted).toBe(true);
    config.INGESTION_TIMEOUT_MS = 180000;
    const next = await upload('shutdown');
    let entered!: () => void;
    const called = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fake.handler = () => {
      entered();
      return new Promise(() => undefined);
    };
    const running = runner.tick();
    await called;
    await runner.beforeApplicationShutdown();
    await running;
    expect((await detail(next.id)).processingError?.code).toBe(
      'PROCESSING_INTERRUPTED',
    );
  });
});
