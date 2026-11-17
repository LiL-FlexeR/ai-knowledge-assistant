import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  errorResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
} from '@aka/shared';
import type { SourceLocation } from '@aka/shared';
import { API_CONFIG } from '../src/config/config.module';
import { parseEnvironment } from '../src/config/environment';
import type { Environment } from '../src/config/environment';
import { configureHttp } from '../src/http';
import { EmbeddingClient } from '../src/modules/ai/embedding-client';
import { RetrievalModule } from '../src/modules/retrieval/retrieval.module';
import { RetrievalService } from '../src/modules/retrieval/retrieval.service';
import { excerpt, mapSource } from '../src/modules/retrieval/source-mapper';
import { VectorReader } from '../src/modules/retrieval/vector-reader';
import { ProcessingFailure } from '../src/processing-error';
import { FakeEmbeddingClient } from './fixtures/fake-embedding-client';

describe('S04 search contracts with fake infrastructure', () => {
  let app: NestExpressApplication;
  let config: Environment;
  let fake: FakeEmbeddingClient;
  let reader: { hasEligibleDocuments: jest.Mock; nearest: jest.Mock };
  beforeEach(async () => {
    config = { ...parseEnvironment({}), OPENAI_API_KEY: 'fake-only' };
    fake = new FakeEmbeddingClient();
    reader = {
      hasEligibleDocuments: jest.fn().mockResolvedValue(true),
      nearest: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      imports: [RetrievalModule],
    })
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .overrideProvider(EmbeddingClient)
      .useValue(fake)
      .overrideProvider(VectorReader)
      .useValue(reader)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureHttp(app);
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });
  const search = (app: NestExpressApplication, body: object | string) =>
    request(app.getHttpServer()).post('/api/search').send(body);

  it.each([
    {},
    { query: '' },
    { query: '   ' },
    { query: 4 },
    { query: 'a'.repeat(2001) },
    { query: 'a '.repeat(513) },
    { query: 'x', topK: 0 },
    { query: 'x', topK: 11 },
    { query: 'x', topK: 1.5 },
    { query: 'x', topK: '5' },
    { query: 'x', documentIds: [] },
    { query: 'x', documentIds: ['bad'] },
    { query: 'x', documentIds: Array.from({ length: 21 }, () => randomUUID()) },
    { query: 'x', threshold: 0 },
    { query: '\ud800' },
  ])(
    'rejects invalid query/filter/bounds before embedding: %j',
    async (body) => {
      const response = await search(app, body).expect(400);
      expect(errorResponseSchema.parse(response.body).error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(reader.hasEligibleDocuments).not.toHaveBeenCalled();
      expect(fake.calls).toHaveLength(0);
    },
  );
  it('rejects duplicate UUIDs independent of letter case', () => {
    const id = 'abcdefab-1234-4123-8123-abcdefabcdef';
    expect(
      searchRequestSchema.safeParse({
        query: 'x',
        documentIds: [id, id.toUpperCase()],
      }).success,
    ).toBe(false);
  });
  it.each([
    'a'.repeat(2000),
    'a '.repeat(512),
    '<|endoftext|>',
    '  maintenance window  ',
  ])('accepts boundaries/special token text and trims query', async (query) => {
    await search(app, { query }).expect(200);
    expect(fake.calls[0]!.inputs[0]!.content).toBe(query.trim());
    expect(fake.calls[0]!.inputs[0]!.tokenCount).toBeLessThanOrEqual(512);
    expect(reader.nearest).toHaveBeenCalledWith(
      expect.any(Array),
      5,
      undefined,
    );
  });
  it('honors lowered character/token caps and configured topK', async () => {
    config.QUESTION_MAX_CHARS = 10;
    await search(app, { query: 'a'.repeat(11) }).expect(400);
    config.QUESTION_MAX_TOKENS = 1;
    await search(app, { query: 'one two' }).expect(400);
    config.RETRIEVAL_TOP_K = 2;
    await search(app, { query: 'one' }).expect(200);
    expect(reader.nearest).toHaveBeenCalledWith(
      expect.any(Array),
      2,
      undefined,
    );
  });
  it('short circuits eligible-empty corpus before checking missing AI or embedding', async () => {
    delete config.OPENAI_API_KEY;
    reader.hasEligibleDocuments.mockResolvedValue(false);
    const response = await search(app, { query: 'x' }).expect(200);
    expect(searchResponseSchema.parse(response.body).data).toEqual({
      status: 'insufficient_context',
      reason: 'NO_READY_DOCUMENTS',
      results: [],
    });
    expect(fake.calls).toHaveLength(0);
    expect(reader.nearest).not.toHaveBeenCalled();
  });
  it('returns NO_RELEVANT_CONTEXT and keeps the request ID', async () => {
    const response = await search(app, { query: 'x' }).expect(200);
    const parsed = searchResponseSchema.parse(response.body);
    expect(parsed.data).toEqual({
      status: 'insufficient_context',
      reason: 'NO_RELEVANT_CONTEXT',
      results: [],
    });
    expect(parsed.requestId).toBe(response.headers['x-request-id']);
  });
  it('uses inclusive cutoff after nearest selection and maps only public source fields', async () => {
    config.RETRIEVAL_MIN_SIMILARITY = 0.5;
    const row = {
      chunkId: randomUUID(),
      processingRunId: randomUUID(),
      documentId: randomUUID(),
      chunkIndex: 0,
      filename: 'notes.txt',
      content: 'abc',
      distance: 0.5,
      location: {
        kind: 'text',
        unitIndex: 0,
        sectionOrdinal: 1,
        lineStart: 1,
        lineEnd: 1,
        charStart: 0,
        charEnd: 3,
      },
    };
    reader.nearest.mockResolvedValue([
      row,
      {
        ...row,
        chunkId: randomUUID(),
        processingRunId: randomUUID(),
        distance: 0.51,
      },
    ]);
    const documentIds = [randomUUID()];
    const response = await search(app, {
      query: 'x',
      topK: 2,
      documentIds,
    }).expect(200);
    const data = searchResponseSchema.parse(response.body).data;
    expect(data.status).toBe('results');
    expect(data.results).toEqual([
      mapSource(row as Parameters<typeof mapSource>[0]),
    ]);
    expect(reader.nearest).toHaveBeenCalledWith(
      expect.any(Array),
      2,
      documentIds,
    );
  });
  it.each([
    ['AI_UPSTREAM_ERROR', 502],
    ['AI_OUTPUT_INVALID', 502],
    ['AI_TIMEOUT', 504],
    ['AI_CAPACITY_EXCEEDED', 429],
  ])('maps %s without reflecting provider text', async (code, status) => {
    fake.handler = async () => {
      throw new ProcessingFailure(code, 'private-key SQL vector canary');
    };
    const response = await search(app, { query: 'private query' }).expect(
      status,
    );
    expect(errorResponseSchema.parse(response.body).error.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toMatch(
      /canary|private query|stack/,
    );
    if (status === 429)
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });
  it('maps unexpected provider failures and missing config safely', async () => {
    fake.handler = async () => {
      throw new Error('private provider response');
    };
    expect(
      (await search(app, { query: 'x' }).expect(502)).body.error.code,
    ).toBe('AI_UPSTREAM_ERROR');
    delete config.OPENAI_API_KEY;
    expect(
      (await search(app, { query: 'x' }).expect(503)).body.error.code,
    ).toBe('AI_NOT_CONFIGURED');
    expect(fake.calls).toHaveLength(1);
  });
  it.each(
    [
      [],
      [[0]],
      [Array<number>(1536).fill(0)],
      [Array<number>(1536).fill(NaN)],
      [Array<number>(1536).fill(Infinity)],
      [Array<number>(1536).fill(1e40)],
      [Array<number>(1536).fill(1e-50)],
      [Array<number>(1536).fill(1), Array<number>(1536).fill(1)],
    ].map((vectors) => ({ vectors })),
  )('rejects malformed query vectors before SQL', async ({ vectors }) => {
    fake.handler = async () => ({ vectors, inputTokens: 1 });
    expect(
      (await search(app, { query: 'x' }).expect(502)).body.error.code,
    ).toBe('AI_OUTPUT_INVALID');
    expect(reader.nearest).not.toHaveBeenCalled();
  });
  it('enforces the whole-operation deadline even if embedding ignores cancellation', async () => {
    config.ASK_TIMEOUT_MS = 20;
    fake.handler = async () => new Promise(() => undefined);
    expect(
      (await search(app, { query: 'x' }).expect(504)).body.error.code,
    ).toBe('AI_TIMEOUT');
    expect(fake.calls[0]!.signal.aborted).toBe(true);
    expect(reader.nearest).not.toHaveBeenCalled();
  });
  it('cancels a disconnected search without reading vectors', async () => {
    const controller = new AbortController();
    fake.handler = async () => {
      controller.abort();
      return new Promise(() => undefined);
    };
    await expect(
      app.get(RetrievalService).search({ query: 'x' }, controller.signal),
    ).rejects.toBeDefined();
    expect(fake.calls[0]!.signal.aborted).toBe(true);
    expect(reader.nearest).not.toHaveBeenCalled();
  });
  it('enforces socket rate windows independent of forwarded IP, with Retry-After', async () => {
    config.SEARCH_REQUESTS_PER_MINUTE = 1;
    await search(app, { query: 'x' }).expect(200);
    const response = await search(app, { query: 'x' })
      .set('X-Forwarded-For', 'different')
      .expect(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(fake.calls).toHaveLength(1);
  });
  it('checks Host/Origin, JSON-only transport, unknown query fields and the JSON body cap', async () => {
    await search(app, { query: 'x' })
      .set('Host', 'attacker.example')
      .expect(403);
    await search(app, { query: 'x' })
      .set('X-Forwarded-Host', 'localhost')
      .expect(403);
    await search(app, { query: 'x' })
      .set('Origin', 'http://attacker.example')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/search?topK=1')
      .send({ query: 'x' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/search')
      .type('text')
      .send('x')
      .expect(400);
    await search(app, { query: 'x'.repeat(17000) }).expect(413);
    expect(fake.calls).toHaveLength(0);
  });
});

describe('source DTO mapping', () => {
  it.each<SourceLocation>([
    { kind: 'pdf', unitIndex: 2, page: 3, charStart: 4, charEnd: 7 },
    {
      kind: 'text',
      unitIndex: 0,
      sectionOrdinal: 1,
      lineStart: 2,
      lineEnd: 3,
      charStart: 4,
      charEnd: 7,
    },
    {
      kind: 'markdown',
      unitIndex: 1,
      sectionOrdinal: 2,
      headingPath: ['Policy', 'Hours'],
      lineStart: 3,
      lineEnd: 4,
      charStart: 4,
      charEnd: 7,
    },
  ])(
    'preserves the persisted $kind location without invented fields',
    (location) => {
      const hit = mapSource({
        chunkId: randomUUID(),
        processingRunId: randomUUID(),
        documentId: randomUUID(),
        chunkIndex: 1,
        filename: '<plain>.txt',
        content: 'abc',
        distance: 0.25,
        location,
      });
      expect(hit.source.location).toEqual(location);
      expect(hit.source.excerpt).toBe('abc');
      expect(hit.similarity).toBe(0.75);
    },
  );
  it('cuts excerpts at 1000 UTF-16 units without splitting a surrogate pair and preserves the full location', () => {
    expect(excerpt('a'.repeat(999) + '😀rest')).toBe('a'.repeat(999));
    expect(excerpt('a'.repeat(998) + '😀rest')).toBe('a'.repeat(998) + '😀');
    expect(excerpt('a'.repeat(1001))).toHaveLength(1000);
    const content = 'a'.repeat(999) + '😀rest';
    const location: SourceLocation = {
      kind: 'pdf',
      unitIndex: 0,
      page: 1,
      charStart: 0,
      charEnd: content.length,
    };
    const row = {
      chunkId: randomUUID(),
      processingRunId: randomUUID(),
      documentId: randomUUID(),
      chunkIndex: 0,
      filename: 'x.pdf',
      content,
      distance: 0,
      location,
    };
    expect(mapSource(row).source.location).toEqual(location);
    expect(() =>
      mapSource({ ...row, location: { ...location, charEnd: 1 } }),
    ).toThrow();
    expect(() =>
      mapSource({ ...row, location: { ...location, page: 0 } }),
    ).toThrow();
  });
});
