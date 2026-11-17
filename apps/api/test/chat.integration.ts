import 'reflect-metadata';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { askResponseSchema, documentResponseSchema } from '@aka/shared';
import { AppModule } from '../src/app.module';
import { API_CONFIG } from '../src/config/config.module';
import { parseEnvironment } from '../src/config/environment';
import type { Environment } from '../src/config/environment';
import { DatabaseService } from '../src/database/database.service';
import type { PrismaClient } from '../src/generated/prisma/client';
import { configureHttp } from '../src/http';
import { EmbeddingClient } from '../src/modules/ai/embedding-client';
import { GroundedAnswerClient } from '../src/modules/ai/grounded-answer-client';
import { GENERATION_MODEL } from '../src/modules/ai/generation-model';
import { IngestionRunner } from '../src/modules/ingestion/ingestion-runner';
import { FakeEmbeddingClient } from './fixtures/fake-embedding-client';
import { FakeGroundedAnswerClient } from './fixtures/fake-grounded-answer-client';
import { maintenance, recovery, injection } from './fixtures/chat-evidence';
import { syntheticPdf } from './fixtures/synthetic-pdf';

describe('S05 ask on actual PostgreSQL/pgvector and fake AI', () => {
  let app: NestExpressApplication;
  let db: PrismaClient;
  let config: Environment;
  let embedding: FakeEmbeddingClient;
  let generation: FakeGroundedAnswerClient;
  let runner: IngestionRunner;
  let root: string;
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
    root = await mkdtemp(join(process.env.STORAGE_ROOT!, 'chat-'));
    config = {
      ...parseEnvironment(process.env),
      OPENAI_API_KEY: 'fake-integration-only',
      OPENAI_CHAT_MODEL: GENERATION_MODEL,
      STORAGE_ROOT: root,
      INGESTION_POLL_MS: 60000,
    };
    embedding = new FakeEmbeddingClient();
    generation = new FakeGroundedAnswerClient();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .overrideProvider(EmbeddingClient)
      .useValue(embedding)
      .overrideProvider(GroundedAnswerClient)
      .useValue(generation)
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
  async function ingest(
    filename = 'operations.md',
    content: Buffer = Buffer.from(
      '# Maintenance\n' + maintenance + '\n# Recovery\n' + recovery,
    ),
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/documents')
      .attach('file', content, { filename })
      .expect(201);
    const document = documentResponseSchema.parse(response.body).data;
    await runner.tick();
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: document.id } }))
        .status,
    ).toBe('ready');
    embedding.calls.length = 0;
    return document;
  }
  const ask = (
    body: object = { question: 'When is the Orion maintenance window?' },
  ) => request(app.getHttpServer()).post('/api/chat/ask').send(body);
  it.each([
    [
      'operations.md',
      Buffer.from(
        '# Maintenance\n' + maintenance + '\n# Recovery\n' + recovery,
      ),
      'markdown',
    ],
    ['notes.txt', Buffer.from(maintenance + '\n' + recovery), 'text'],
    ['handbook.pdf', syntheticPdf([maintenance, recovery]), 'pdf'],
  ])(
    'maps %s citations to unchanged exact stored spans and physical source units',
    async (filename, content, kind) => {
      const document = await ingest(filename as string, content as Buffer);
      generation.handler = async (prompt) => {
        const sources = JSON.parse(prompt.input).untrustedEvidence as {
          sourceId: string;
          text: string;
        }[];
        return {
          status: 'completed',
          inputTokens: 500,
          outputTokens: 70,
          output: {
            status: 'answered',
            statements: sources.map((source) => ({
              text: source.text.includes('Mira')
                ? 'Mira Chen owns recovery.'
                : 'Maintenance is Sunday at 02:00 UTC.',
              sourceIds: [source.sourceId],
            })),
            limitation: null,
          },
        };
      };
      const response = askResponseSchema.parse(
        (
          await ask({
            question: 'Who owns recovery and when is maintenance?',
            documentIds: [document.id],
          }).expect(200)
        ).body,
      ).data;
      expect(response.status).toBe('answered');
      expect(generation.calls).toHaveLength(1);
      expect(embedding.calls).toHaveLength(1);
      const doc = await db.document.findUniqueOrThrow({
        where: { id: document.id },
      });
      const units = doc.sourceMap as unknown as { contentStart: number }[];
      for (const citation of response.citations) {
        const chunk = await db.documentChunk.findUniqueOrThrow({
          where: { id: citation.chunkId },
          select: {
            content: true,
            sourceLocation: true,
            processingRunId: true,
          },
        });
        const location = citation.source.location;
        expect(location.kind).toBe(kind);
        expect(citation.source.location).toEqual(chunk.sourceLocation);
        const start = units[location.unitIndex]!.contentStart;
        expect(chunk.content).toBe(
          doc.extractedContent!.slice(
            start + location.charStart,
            start + location.charEnd,
          ),
        );
        expect(citation.source.excerpt).toBe(chunk.content);
        expect(chunk.processingRunId).toBe(doc.processingRunId);
      }
      if (kind === 'pdf')
        expect(
          response.citations.map((citation) => citation.source.location),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ page: 1 }),
            expect.objectContaining({ page: 2 }),
          ]),
        );
    },
  );
  it.each(['delete', 'reprocess', 'rebuild'])(
    'returns 409 after concurrent %s changes a cited generation',
    async (action) => {
      const document = await ingest();
      const original = (
        await db.document.findUniqueOrThrow({ where: { id: document.id } })
      ).processingRunId;
      generation.handler = async () => {
        if (action === 'delete')
          await request(app.getHttpServer())
            .delete(`/api/documents/${document.id}`)
            .expect(204);
        else {
          await request(app.getHttpServer())
            .post(`/api/documents/${document.id}/reprocess`)
            .expect(202);
          if (action === 'rebuild') {
            await runner.tick();
            const current = await db.document.findUniqueOrThrow({
              where: { id: document.id },
            });
            expect(current.status).toBe('ready');
            expect(current.processingRunId).not.toBe(original);
          }
        }
        return {
          status: 'completed',
          inputTokens: 1,
          outputTokens: 1,
          output: {
            status: 'answered',
            statements: [{ text: 'Maintenance is Sunday.', sourceIds: ['S1'] }],
            limitation: null,
          },
        };
      };
      const response = await ask().expect(409);
      expect(response.body.error.code).toBe('DOCUMENT_CHANGED');
      expect(generation.calls).toHaveLength(1);
    },
  );
  it('rechecks only cited documents, allowing deletion of unused evidence', async () => {
    const retained = await ingest('retained.txt', Buffer.from(maintenance));
    const unused = await ingest('unused.txt', Buffer.from(injection));
    generation.handler = async (prompt) => {
      const sources = JSON.parse(prompt.input).untrustedEvidence as {
        sourceId: string;
        filename: string;
      }[];
      const used = sources.find(
        (source) => source.filename === 'retained.txt',
      )!;
      await request(app.getHttpServer())
        .delete(`/api/documents/${unused.id}`)
        .expect(204);
      return {
        status: 'completed',
        inputTokens: 1,
        outputTokens: 1,
        output: {
          status: 'answered',
          statements: [
            { text: 'Maintenance is Sunday.', sourceIds: [used.sourceId] },
          ],
          limitation: null,
        },
      };
    };
    const response = askResponseSchema.parse(
      (await ask().expect(200)).body,
    ).data;
    expect(response.citations).toHaveLength(1);
    expect(response.citations[0]!.source.documentId).toBe(retained.id);
  });
  it('skips AI for empty/non-ready filters, rejects unknown filters and profile mismatch', async () => {
    expect((await ask().expect(200)).body.data.reason).toBe(
      'NO_READY_DOCUMENTS',
    );
    expect(embedding.calls).toHaveLength(0);
    expect(generation.calls).toHaveLength(0);
    const document = await ingest();
    await request(app.getHttpServer())
      .post(`/api/documents/${document.id}/reprocess`)
      .expect(202);
    expect(
      (await ask({ question: 'x', documentIds: [document.id] }).expect(200))
        .body.data.reason,
    ).toBe('NO_READY_DOCUMENTS');
    expect(embedding.calls).toHaveLength(0);
    await ask({
      question: 'x',
      documentIds: ['11111111-1111-4111-8111-111111111111'],
    }).expect(404);
    await runner.tick();
    embedding.calls.length = 0;
    await db.document.update({
      where: { id: document.id },
      data: { embeddingProfileId: 'incompatible' },
    });
    expect((await ask().expect(503)).body.error.code).toBe(
      'EMBEDDING_PROFILE_MISMATCH',
    );
    expect(embedding.calls).toHaveLength(0);
    expect(generation.calls).toHaveLength(0);
  });
  it('maps final database failures safely instead of assuming evidence disappeared', async () => {
    await ingest();
    generation.handler = async () => {
      jest
        .spyOn(db.document, 'findMany')
        .mockRejectedValueOnce(new Error('private SQL canary'));
      return {
        status: 'completed',
        inputTokens: null,
        outputTokens: null,
        output: {
          status: 'answered',
          statements: [{ text: 'Maintenance is Sunday.', sourceIds: ['S1'] }],
          limitation: null,
        },
      };
    };
    const response = await ask().expect(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.text).not.toMatch(/SQL|canary/);
  });
});
