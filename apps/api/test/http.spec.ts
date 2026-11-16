import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { errorResponseSchema, healthResponseSchema } from '@aka/shared';
import { AppModule } from '../src/app.module';
import { API_CONFIG } from '../src/config/config.module';
import { parseEnvironment } from '../src/config/environment';
import { configureHttp } from '../src/http';

@Controller('test-fault')
class FaultController {
  @Get()
  fail(): never {
    throw new Error('secret-canary /private/documents provider body');
  }
}
@Module({ imports: [AppModule], controllers: [FaultController] })
class HttpTestModule {}

describe('HTTP contracts', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [HttpTestModule] })
      .overrideProvider(API_CONFIG)
      .useValue(parseEnvironment({ NODE_ENV: 'test' }))
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns liveness in the shared envelope with a generated request ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set('X-Request-Id', 'attacker-controlled')
      .expect(200);
    const body = healthResponseSchema.parse(response.body);
    expect(body.data).toEqual({ status: 'ok' });
    expect(body.requestId).toBe(response.headers['x-request-id']);
    expect(body.requestId).not.toBe('attacker-controlled');
    const second = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(second.headers['x-request-id']).not.toBe(body.requestId);
  });

  it.each([
    '/api/documents',
    '/api/search',
    '/api/chat/ask',
    '/api/private-secret-canary',
  ])(
    'keeps unimplemented/unknown routes behind a safe 404 envelope: %s',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path).expect(404);
      const body = errorResponseSchema.parse(response.body);
      expect(body.error).toEqual({
        code: 'NOT_FOUND',
        message: 'Route not found.',
      });
      expect(body.requestId).toBe(response.headers['x-request-id']);
      expect(response.text).not.toContain(path);
    },
  );

  it('hides unexpected exception messages and stack traces', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/test-fault')
      .expect(500);
    const body = errorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.requestId).toBe(response.headers['x-request-id']);
    expect(response.text).not.toMatch(/secret-canary|private|stack|provider/);
  });

  it('maps malformed JSON without reflecting submitted contents', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/unknown')
      .set('Content-Type', 'application/json')
      .send('{"secret-canary":')
      .expect(400);
    expect(errorResponseSchema.parse(response.body).error.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(response.text).not.toContain('secret-canary');
  });

  it('enforces the common 16 KiB JSON limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/unknown')
      .send({ text: 'x'.repeat(16384) })
      .expect(413);
    expect(errorResponseSchema.parse(response.body).error.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
  });
});
