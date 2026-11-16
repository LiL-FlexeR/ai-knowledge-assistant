import 'reflect-metadata';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { errorResponseSchema, readinessResponseSchema } from '@aka/shared';
import { API_CONFIG } from '../src/config/config.module';
import { parseEnvironment } from '../src/config/environment';
import { DatabaseService } from '../src/database/database.service';
import { HealthModule } from '../src/health/health.module';
import { StorageProbe } from '../src/health/storage-probe';
import { configureHttp } from '../src/http';

describe('readiness contracts and controlled dependency faults', () => {
  let app: NestExpressApplication;
  let root: string;
  const database = { inspect: jest.fn() };
  const storage = { check: jest.fn() };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'aka-readiness-'));
    const module = await Test.createTestingModule({ imports: [HealthModule] })
      .overrideProvider(API_CONFIG)
      .useValue(parseEnvironment({ NODE_ENV: 'test', STORAGE_ROOT: root }))
      .overrideProvider(DatabaseService)
      .useValue(database)
      .overrideProvider(StorageProbe)
      .useValue(storage)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureHttp(app);
    await app.init();
  });
  beforeEach(() => {
    database.inspect.mockResolvedValue({
      database: true,
      embeddingProfile: true,
    });
    storage.check.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true });
  });

  it('returns the shared ready contract with AI disabled and no provider call', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200);
    const body = readinessResponseSchema.parse(response.body);
    expect(body.data.checks.aiConfiguration).toBe('disabled');
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it.each(['database', 'storage', 'embeddingProfile'] as const)(
    'returns safe 503 for %s faults while liveness stays healthy',
    async (check) => {
      if (check === 'database')
        database.inspect.mockRejectedValue(
          new Error('postgresql://private:secret@host/db'),
        );
      if (check === 'storage')
        storage.check.mockRejectedValue(
          new Error('/private/secret/documents EACCES'),
        );
      if (check === 'embeddingProfile')
        database.inspect.mockResolvedValue({
          database: true,
          embeddingProfile: false,
        });
      const response = await request(app.getHttpServer())
        .get('/api/health/ready')
        .expect(503);
      const body = errorResponseSchema.parse(response.body);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.details).toEqual([
        { path: check, message: 'Check failed.' },
      ]);
      expect(body.requestId).toBe(response.headers['x-request-id']);
      expect(response.text).not.toMatch(
        /postgresql|private|secret|EACCES|stack/,
      );
      await request(app.getHttpServer()).get('/api/health').expect(200);
    },
  );

  it('checks actual storage I/O and removes only its probe', async () => {
    const module = await Test.createTestingModule({
      providers: [
        StorageProbe,
        {
          provide: API_CONFIG,
          useValue: parseEnvironment({ STORAGE_ROOT: root }),
        },
      ],
    }).compile();
    await writeFile(join(root, 'keep'), 'original');
    await expect(module.get(StorageProbe).check()).resolves.toBeUndefined();
    expect(await readdir(root)).toEqual(['keep']);
    await module.close();
  });

  it('fails actual storage I/O on a non-directory root', async () => {
    const file = join(root, 'fault');
    await writeFile(file, 'not a directory');
    const module = await Test.createTestingModule({
      providers: [
        StorageProbe,
        {
          provide: API_CONFIG,
          useValue: parseEnvironment({ STORAGE_ROOT: file }),
        },
      ],
    }).compile();
    await expect(module.get(StorageProbe).check()).rejects.toThrow();
    await module.close();
  });
});
