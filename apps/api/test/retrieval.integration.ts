import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { documentResponseSchema, searchResponseSchema } from '@aka/shared';
import { AppModule } from '../src/app.module';
import { API_CONFIG } from '../src/config/config.module';
import { parseEnvironment } from '../src/config/environment';
import type { Environment } from '../src/config/environment';
import { DatabaseService } from '../src/database/database.service';
import { insertVectorChunk } from '../src/database/vector-sql';
import type { PrismaClient } from '../src/generated/prisma/client';
import { configureHttp } from '../src/http';
import { EmbeddingClient } from '../src/modules/ai/embedding-client';
import { IngestionRunner } from '../src/modules/ingestion/ingestion-runner';
import { VectorReader } from '../src/modules/retrieval/vector-reader';
import { FakeEmbeddingClient } from './fixtures/fake-embedding-client';
import { syntheticPdf } from './fixtures/synthetic-pdf';

const vector = (x: number, y = 0) => [x, y, ...Array<number>(1534).fill(0)];
describe('S04 exact retrieval on real PostgreSQL/pgvector with fake AI', () => {
  let app: NestExpressApplication;
  let db: PrismaClient;
  let config: Environment;
  let fake: FakeEmbeddingClient;
  let root: string;
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
      throw new Error('Refusing unowned retrieval target.');
  });
  beforeEach(async () => {
    root = await mkdtemp(join(process.env.STORAGE_ROOT!, 'retrieval-'));
    config = {
      ...parseEnvironment(process.env),
      OPENAI_API_KEY: 'fake-integration-only',
      INGESTION_POLL_MS: 60000,
      STORAGE_ROOT: root,
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
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await runner?.beforeApplicationShutdown();
    await db?.document.deleteMany();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });
  const search = (body: object | string = { query: 'maintenance window' }) =>
    request(app.getHttpServer()).post('/api/search').send(body);
  // Relational fixtures deliberately include ineligible/stale rows to prove SQL filters.
  async function fixture(
    embedding: number[],
    status:
      'ready' | 'pending' | 'processing' | 'failed' | 'deleting' = 'ready',
  ) {
    const id = randomUUID();
    const row = await db.document.create({
      data: {
        id,
        filename: 'synthetic.txt',
        mimeType: 'text/plain',
        size: 3,
        storagePath: `${id}/original.txt`,
        status,
        processingRunId: randomUUID(),
        chunkCount: 1,
        extractedContent: 'abc',
        sourceMap: [
          {
            unitIndex: 0,
            contentStart: 0,
            contentEnd: 3,
            location: {
              kind: 'text',
              unitIndex: 0,
              sectionOrdinal: 1,
              lineStart: 1,
              lineEnd: 1,
              charStart: 0,
              charEnd: 3,
            },
            lines: [{ line: 1, charStart: 0, charEnd: 3 }],
          },
        ],
        embeddingProfileId: config.EMBEDDING_PROFILE_ID,
        embeddingModel: config.OPENAI_EMBEDDING_MODEL,
        embeddingDimensions: 1536,
        pipelineVersion: config.PIPELINE_VERSION,
      },
    });
    const chunkId = await insertVectorChunk(db, {
      documentId: id,
      processingRunId: row.processingRunId,
      content: 'abc',
      chunkIndex: 0,
      tokenCount: 1,
      sourceLocation: {
        kind: 'text',
        unitIndex: 0,
        sectionOrdinal: 1,
        lineStart: 1,
        lineEnd: 1,
        charStart: 0,
        charEnd: 3,
      },
      embedding,
    });
    return { id, chunkId };
  }
  it('ranks known vectors, sorts UUID ties, applies inclusive cutoff after topK, and binds document subsets before limiting', async () => {
    const a = await fixture(vector(1));
    const b = await fixture(vector(1));
    const c = await fixture(vector(0.6, 0.8));
    const orthogonal = await fixture(vector(0, 1));
    await fixture(vector(-1));
    const response = await search().expect(200);
    const data = searchResponseSchema.parse(response.body).data;
    expect(data.status).toBe('results');
    expect(data.results.map((hit) => hit.chunkId)).toEqual([
      ...[a.chunkId, b.chunkId].sort(),
      c.chunkId,
    ]);
    expect(data.results.map((hit) => hit.similarity)).toEqual([
      1,
      1,
      expect.closeTo(0.6, 5),
    ]);
    expect(data.results[0]!.source).toMatchObject({
      filename: 'synthetic.txt',
      excerpt: 'abc',
      location: { kind: 'text', sectionOrdinal: 1 },
    });
    expect(JSON.stringify(data)).not.toMatch(
      /embedding|processingRun|storagePath|distance/,
    );
    const first = searchResponseSchema.parse(
      (await search({ query: 'x', topK: 1 }).expect(200)).body,
    ).data;
    expect(first.results.map((hit) => hit.chunkId)).toEqual([
      [a.chunkId, b.chunkId].sort()[0],
    ]);
    const subset = searchResponseSchema.parse(
      (await search({ query: 'x', topK: 1, documentIds: [c.id] }).expect(200))
        .body,
    ).data;
    expect(subset.results.map((hit) => hit.chunkId)).toEqual([c.chunkId]);
    const unrelated = searchResponseSchema.parse(
      (await search({ query: 'x', documentIds: [orthogonal.id] }).expect(200))
        .body,
    ).data;
    expect(unrelated).toEqual({
      status: 'insufficient_context',
      reason: 'NO_RELEVANT_CONTEXT',
      results: [],
    });
    config.RETRIEVAL_MIN_SIMILARITY = 0;
    expect(
      searchResponseSchema.parse(
        (await search({ query: 'x', documentIds: [orthogonal.id] }).expect(200))
          .body,
      ).data.results[0]!.similarity,
    ).toBe(0);
    config.RETRIEVAL_MIN_SIMILARITY = -1;
    expect(
      searchResponseSchema.parse((await search().expect(200)).body).data
        .results,
    ).toHaveLength(5);
  });
  it('bounds topK at ten and filters states and stale runs before limiting', async () => {
    for (const status of [
      'pending',
      'processing',
      'failed',
      'deleting',
    ] as const)
      await fixture(vector(1), status);
    const stale = await fixture(vector(1));
    await db.document.update({
      where: { id: stale.id },
      data: { processingRunId: randomUUID() },
    });
    const valid = await Promise.all(
      Array.from({ length: 12 }, () => fixture(vector(0.6, 0.8))),
    );
    const data = searchResponseSchema.parse(
      (await search({ query: 'x', topK: 10 }).expect(200)).body,
    ).data;
    expect(data.results).toHaveLength(10);
    expect(data.results.map((hit) => hit.chunkId)).toEqual(
      valid
        .map((row) => row.chunkId)
        .sort()
        .slice(0, 10),
    );
  });
  it('skips embeddings on empty or known non-ready subsets; unknown filters return 404 first', async () => {
    delete config.OPENAI_API_KEY;
    expect((await search().expect(200)).body.data.reason).toBe(
      'NO_READY_DOCUMENTS',
    );
    const pending = await fixture(vector(1), 'pending');
    await fixture(vector(1));
    expect(
      (await search({ query: 'x', documentIds: [pending.id] }).expect(200)).body
        .data.reason,
    ).toBe('NO_READY_DOCUMENTS');
    expect(
      (
        await search({
          query: 'x',
          documentIds: [pending.id, randomUUID()],
        }).expect(404)
      ).body.error.code,
    ).toBe('DOCUMENT_NOT_FOUND');
    expect(fake.calls).toHaveLength(0);
  });
  it.each([
    'embeddingProfileId',
    'embeddingModel',
    'embeddingDimensions',
    'pipelineVersion',
  ] as const)(
    'rejects incompatible ready %s before embedding and excludes it in SQL',
    async (field) => {
      const bad = await fixture(vector(1));
      const good = await fixture(vector(0.6, 0.8));
      await db.document.update({
        where: { id: bad.id },
        data: {
          [field]: field === 'embeddingDimensions' ? 100 : 'incompatible',
        },
      });
      const response = await search({
        query: 'x',
        documentIds: [good.id],
      }).expect(503);
      expect(response.body.error.code).toBe('EMBEDDING_PROFILE_MISMATCH');
      expect(fake.calls).toHaveLength(0);
      const rows = await app.get(VectorReader).nearest(vector(1), 1);
      expect(rows.map((row) => row.chunkId)).toEqual([good.chunkId]);
    },
  );
  it.each([
    [
      'notes.txt',
      'text/plain',
      Buffer.from('Cafe\u0301\r\nMaintenance Sunday 02:00 UTC.\r\n'),
      'text',
    ],
    [
      'policy.md',
      'text/markdown',
      Buffer.from('# Operations\nMaintenance Sunday.\n## Window\n02:00 UTC.\n'),
      'markdown',
    ],
    [
      'handbook.pdf',
      'application/pdf',
      syntheticPdf(['Maintenance Sunday.', 'Window 02:00 UTC.']),
      'pdf',
    ],
  ])(
    'retrieves %s with locations resolving to canonical stored spans',
    async (filename, mime, content, kind) => {
      const upload = await request(app.getHttpServer())
        .post('/api/documents')
        .attach('file', content, { filename, contentType: mime })
        .expect(201);
      const document = documentResponseSchema.parse(upload.body).data;
      await runner.tick();
      fake.calls.length = 0;
      const response = await search({
        query: 'maintenance window',
        documentIds: [document.id],
      }).expect(200);
      const data = searchResponseSchema.parse(response.body).data;
      expect(data.results.length).toBeGreaterThan(0);
      expect(fake.calls).toHaveLength(1);
      const row = await db.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      const units = row.sourceMap as unknown as { contentStart: number }[];
      for (const hit of data.results) {
        expect(hit.source.location.kind).toBe(kind);
        const stored = await db.documentChunk.findUniqueOrThrow({
          where: { id: hit.chunkId },
          select: { content: true, sourceLocation: true },
        });
        const location = hit.source.location;
        const start = units[location.unitIndex]!.contentStart;
        expect(stored.content).toBe(
          row.extractedContent!.slice(
            start + location.charStart,
            start + location.charEnd,
          ),
        );
        expect(hit.source.location).toEqual(stored.sourceLocation);
        expect(hit.source.excerpt).toBe(stored.content);
      }
      if (kind === 'pdf')
        expect(data.results.map((hit) => hit.source.location)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ page: 1 }),
            expect.objectContaining({ page: 2 }),
          ]),
        );
      await request(app.getHttpServer())
        .post(`/api/documents/${document.id}/reprocess`)
        .expect(202);
      fake.calls.length = 0;
      expect(
        (await search({ query: 'x', documentIds: [document.id] }).expect(200))
          .body.data.reason,
      ).toBe('NO_READY_DOCUMENTS');
      expect(fake.calls).toHaveLength(0);
    },
  );
  it('rechecks current state/run in SQL after deletion or reprocessing wins during embedding', async () => {
    const doc = await fixture(vector(1));
    fake.handler = async () => {
      await db.document.update({
        where: { id: doc.id },
        data: { status: 'pending', processingRunId: randomUUID() },
      });
      return { vectors: [vector(1)], inputTokens: 1 };
    };
    expect((await search().expect(200)).body.data.reason).toBe(
      'NO_RELEVANT_CONTEXT',
    );
    await db.document.update({
      where: { id: doc.id },
      data: { status: 'ready' },
    });
    fake.handler = async () => {
      await db.document.delete({ where: { id: doc.id } });
      return { vectors: [vector(1)], inputTokens: 1 };
    };
    expect((await search().expect(200)).body.data.reason).toBe(
      'NO_RELEVANT_CONTEXT',
    );
  });
  it('validates raw source shapes and database faults without returning partial results or internals', async () => {
    const doc = await fixture(vector(1));
    await db.$executeRaw`UPDATE document_chunks SET source_location = '{"kind":"pdf","page":0}'::jsonb WHERE id = ${doc.chunkId}::uuid`;
    const invalid = await search().expect(503);
    expect(invalid.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(invalid.body)).not.toMatch(
      /SELECT|source_location|embedding|Zod/,
    );
    jest
      .spyOn(app.get(DatabaseService), 'inspect')
      .mockRejectedValueOnce(new Error('private SQL canary'));
    const fault = await search().expect(503);
    expect(fault.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(fault.body)).not.toMatch(/canary|SQL/);
  });
});
