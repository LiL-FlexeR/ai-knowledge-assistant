import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { lstat, readdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { errorResponseSchema, readinessResponseSchema } from '@aka/shared';
import { IngestionRunner } from '../src/modules/ingestion/ingestion-runner';
import { AppModule } from '../src/app.module';
import { API_CONFIG } from '../src/config/config.module';
import { parseEnvironment } from '../src/config/environment';
import { createDatabaseClient } from '../src/database/client';
import { DatabaseService } from '../src/database/database.service';
import {
  insertVectorChunk,
  readVectorDistances,
} from '../src/database/vector-sql';
import { configureHttp } from '../src/http';
import type { Prisma, PrismaClient } from '../src/generated/prisma/client';

const basis = (first: number, second = 0): number[] => [
  first,
  second,
  ...Array<number>(1534).fill(0),
];
const location = {
  kind: 'text',
  unitIndex: 0,
  sectionOrdinal: 1,
  lineStart: 1,
  lineEnd: 1,
  charStart: 0,
  charEnd: 4,
};

describe('real PostgreSQL/pgvector infrastructure', () => {
  let admin: PrismaClient;
  let runtime: PrismaClient;
  let app: NestExpressApplication;
  const config = parseEnvironment({
    ...process.env,
    OPENAI_API_KEY: 'fake-readiness-only',
    OPENAI_CHAT_MODEL: 'gpt-5.4-mini-2026-03-17',
  });
  const ownedIds: string[] = [];

  beforeAll(async () => {
    // Revalidate ownership inside the test process before any writes/cleanup.
    const url = new URL(process.env.TEST_DATABASE_URL ?? '');
    if (
      !/^aka_test_[0-9a-f]{16}$/.test(process.env.AKA_TEST_DATABASE ?? '') ||
      url.pathname !== `/${process.env.AKA_TEST_DATABASE}` ||
      url.hostname !== '127.0.0.1' ||
      url.port !== process.env.AKA_TEST_PORT ||
      url.username !== 'aka_test_migrator' ||
      config.NODE_ENV !== 'test' ||
      !config.DATABASE_URL
    ) {
      throw new Error('Refusing unowned integration database.');
    }
    const runtimeUrl = new URL(config.DATABASE_URL);
    if (
      runtimeUrl.hostname !== url.hostname ||
      runtimeUrl.port !== url.port ||
      runtimeUrl.pathname !== url.pathname ||
      runtimeUrl.username !== 'aka_runtime' ||
      runtimeUrl.search ||
      runtimeUrl.hash ||
      url.search ||
      url.hash ||
      !config.STORAGE_ROOT.startsWith(join(tmpdir(), 'aka-integration-')) ||
      (await lstat(config.STORAGE_ROOT)).isSymbolicLink()
    ) {
      throw new Error('Refusing unowned integration runtime/storage.');
    }
    admin = createDatabaseClient(url.toString());
    runtime = createDatabaseClient(config.DATABASE_URL);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IngestionRunner)
      .useValue({})
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureHttp(app);
    await app.init();
  });
  afterEach(async () => {
    if (runtime)
      await runtime.document.deleteMany({ where: { id: { in: ownedIds } } });
    ownedIds.length = 0;
  });
  afterAll(async () => {
    await app?.close();
    await runtime?.$disconnect();
    await admin?.$disconnect();
  });

  async function document(
    overrides: Partial<Prisma.DocumentUncheckedCreateInput> = {},
  ) {
    const id = randomUUID();
    ownedIds.push(id);
    return runtime.document.create({
      data: {
        id,
        filename: 'fixture.txt',
        mimeType: 'text/plain',
        size: 4,
        storagePath: `${id}/original.txt`,
        processingRunId: randomUUID(),
        ...overrides,
      },
    });
  }
  async function chunk(
    parent: Awaited<ReturnType<typeof document>>,
    chunkIndex = 0,
    embedding = basis(1),
    content = 'text',
  ) {
    return insertVectorChunk(runtime, {
      documentId: parent.id,
      processingRunId: parent.processingRunId,
      chunkIndex,
      tokenCount: 1,
      sourceLocation: location,
      content,
      embedding,
    });
  }

  it('replayed migrations created extension, NOT NULL vector(1536), enum and scalar metadata', async () => {
    const [extension] = await runtime.$queryRaw<
      { version: string }[]
    >`SELECT extversion AS version FROM pg_extension WHERE extname = 'vector'`;
    expect(extension?.version).toBe('0.8.7');
    const [column] = await runtime.$queryRaw<
      { type: string; required: boolean }[]
    >`
      SELECT format_type(atttypid, atttypmod) AS type, attnotnull AS required
      FROM pg_attribute WHERE attrelid = 'document_chunks'::regclass AND attname = 'embedding'
    `;
    expect(column).toEqual({ type: 'vector(1536)', required: true });
    const parent = await document();
    expect(parent.status).toBe('pending');
    expect(parent.chunkCount).toBe(0);
    expect(parent.createdAt).toBeInstanceOf(Date);
  });

  it('binds hostile-looking content/JSON and returns cosine order using scalar-only projections', async () => {
    const parent = await document();
    const hostile = "quote '; DROP TABLE documents; -- 雪";
    const same = await insertVectorChunk(runtime, {
      documentId: parent.id,
      processingRunId: parent.processingRunId,
      chunkIndex: 0,
      tokenCount: 1,
      content: hostile,
      embedding: basis(1),
      sourceLocation: { ...location, note: hostile },
    });
    const diagonal = await chunk(parent, 1, basis(1, 1));
    const orthogonal = await chunk(parent, 2, basis(0, 1));
    const opposite = await chunk(parent, 3, basis(-1));
    const rows = await readVectorDistances(runtime, parent.id, basis(1));
    expect(rows.map((row) => row.id)).toEqual([
      same,
      diagonal,
      orthogonal,
      opposite,
    ]);
    expect(rows[0]?.content).toBe(hostile);
    expect(rows[0]?.distance).toBeCloseTo(0);
    expect(rows[1]?.distance).toBeCloseTo(1 - 1 / Math.sqrt(2));
    expect(rows[2]?.distance).toBeCloseTo(1);
    expect(rows[3]?.distance).toBeCloseTo(2);
    expect(await runtime.document.count()).toBe(1);
    const [stored] = await runtime.$queryRaw<{ location: unknown }[]>`
      SELECT source_location AS location FROM document_chunks WHERE id = ${same}::uuid
    `;
    expect(stored?.location).toEqual({ ...location, note: hostile });
    await expect(
      readVectorDistances(runtime, hostile, basis(1)),
    ).rejects.toThrow();
    expect(await runtime.document.count()).toBe(1);
  });

  it('enforces vector dimensions at the SQL boundary independently of adapter validation', async () => {
    const parent = await document();
    await expect(runtime.$executeRaw`
      INSERT INTO document_chunks (document_id, processing_run_id, content, chunk_index, token_count, source_location, embedding)
      VALUES (${parent.id}::uuid, ${parent.processingRunId}::uuid, 'x', 0, 1, '{}'::jsonb, ${'[1,0]'}::vector)
    `).rejects.toThrow();
    expect(await runtime.documentChunk.count()).toBe(0);
  });

  it('enforces FK, unique order/storage, nonnegative/positive fields, enum and cascade', async () => {
    const parent = await document();
    await chunk(parent);
    await expect(chunk(parent)).rejects.toThrow();
    await expect(
      insertVectorChunk(runtime, {
        documentId: randomUUID(),
        processingRunId: randomUUID(),
        content: 'x',
        chunkIndex: 0,
        tokenCount: 1,
        sourceLocation: {},
        embedding: basis(1),
      }),
    ).rejects.toThrow();
    await expect(
      document({ storagePath: parent.storagePath }),
    ).rejects.toThrow();
    await expect(document({ size: 0 })).rejects.toThrow();
    await expect(document({ chunkCount: -1 })).rejects.toThrow();
    await expect(document({ embeddingDimensions: -1 })).rejects.toThrow();
    await expect(chunk(parent, -1)).rejects.toThrow();
    await expect(
      runtime.$executeRaw`UPDATE documents SET status = ${'not-a-status'}::document_status WHERE id = ${parent.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      runtime.$executeRaw`UPDATE document_chunks SET token_count = 0 WHERE document_id = ${parent.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      runtime.$executeRaw`UPDATE document_chunks SET content = '' WHERE document_id = ${parent.id}::uuid`,
    ).rejects.toThrow();
    await runtime.document.delete({ where: { id: parent.id } });
    expect(await runtime.documentChunk.count()).toBe(0);
  });

  it('rolls back metadata and vector insertion together through a Prisma transaction handle', async () => {
    const parent = await document();
    await expect(
      runtime.$transaction(async (tx) => {
        await tx.document.update({
          where: { id: parent.id },
          data: { status: 'processing' },
        });
        await insertVectorChunk(tx, {
          documentId: parent.id,
          processingRunId: parent.processingRunId,
          content: 'x',
          chunkIndex: 0,
          tokenCount: 1,
          sourceLocation: location,
          embedding: basis(1),
        });
        throw new Error('controlled rollback');
      }),
    ).rejects.toThrow('controlled rollback');
    expect(
      (await runtime.document.findUniqueOrThrow({ where: { id: parent.id } }))
        .status,
    ).toBe('pending');
    expect(await runtime.documentChunk.count()).toBe(0);
  });

  it('runtime can use data but cannot change schema or read the migration ledger', async () => {
    await expect(
      runtime.$executeRaw`CREATE TABLE forbidden (id integer)`,
    ).rejects.toThrow();
    await expect(
      runtime.$executeRaw`ALTER TABLE documents ADD COLUMN forbidden integer`,
    ).rejects.toThrow();
    await expect(
      runtime.$queryRaw`SELECT migration_name FROM _prisma_migrations`,
    ).rejects.toThrow();
    const [role] = await runtime.$queryRaw<
      { superuser: boolean; createdb: boolean; createrole: boolean }[]
    >`
      SELECT rolsuper AS superuser, rolcreatedb AS createdb, rolcreaterole AS createrole FROM pg_roles WHERE rolname = current_user
    `;
    expect(role).toEqual({
      superuser: false,
      createdb: false,
      createrole: false,
    });
  });

  it('real readiness checks storage, schema and compatible profiles without AI', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200);
    expect(
      readinessResponseSchema.parse(response.body).data.checks.aiConfiguration,
    ).toBe('ok');
    expect(await readdir(config.STORAGE_ROOT)).toEqual([]);
    const parent = await document({
      status: 'ready',
      embeddingProfileId: 'wrong-profile',
    });
    const bad = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(503);
    expect(
      errorResponseSchema
        .parse(bad.body)
        .error.details?.map((item) => item.path),
    ).toEqual(['embeddingProfile']);
    await runtime.document.update({
      where: { id: parent.id },
      data: {
        embeddingProfileId: config.EMBEDDING_PROFILE_ID,
        embeddingModel: config.OPENAI_EMBEDDING_MODEL,
        embeddingDimensions: config.EMBEDDING_DIMENSIONS,
        pipelineVersion: config.PIPELINE_VERSION,
      },
    });
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);
  });

  it('detects an actual vector-dimension mismatch and recovers after restoration', async () => {
    try {
      await admin.$executeRaw`ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(3)`;
      expect(await app.get(DatabaseService).inspect()).toEqual({
        database: true,
        embeddingProfile: false,
      });
    } finally {
      await admin.$executeRaw`ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1536)`;
    }
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);
  });

  it('reports an actual missing extension safely and recovers after restoration', async () => {
    // Controlled schema fault only in the empty, owned test database. CASCADE
    // drops the vector column; restore it before the post-suite drift check.
    try {
      await admin.$executeRaw`DROP EXTENSION vector CASCADE`;
      const response = await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(503);
      expect(
        errorResponseSchema
          .parse(response.body)
          .error.details?.map((item) => item.path),
      ).toContain('database');
      expect(response.text).not.toMatch(/postgresql|password|stack/);
    } finally {
      await admin.$executeRaw`CREATE EXTENSION vector WITH SCHEMA public`;
      await admin.$executeRaw`ALTER TABLE document_chunks ADD COLUMN embedding vector(1536) NOT NULL`;
    }
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);
  });

  it('reports a real unwritable storage target without exposing its path', async () => {
    const file = join(config.STORAGE_ROOT, 'storage-fault');
    await writeFile(file, 'file');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IngestionRunner)
      .useValue({})
      .overrideProvider(API_CONFIG)
      .useValue({ ...config, STORAGE_ROOT: file })
      .compile();
    const faultApp = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureHttp(faultApp);
    await faultApp.init();
    try {
      const response = await request(faultApp.getHttpServer())
        .get('/api/health/ready')
        .expect(503);
      expect(
        errorResponseSchema
          .parse(response.body)
          .error.details?.map((item) => item.path),
      ).toContain('storage');
      expect(response.text).not.toContain(file);
    } finally {
      await faultApp.close();
      await unlink(file);
    }
  });
});
