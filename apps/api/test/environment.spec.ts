import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { parseEnvironment } from '../src/config/environment';

describe('API environment boundary', () => {
  it('accepts the shipped environment example without credentials', () => {
    const env = parseEnv(
      readFileSync(resolve(__dirname, '../../../.env.example'), 'utf8'),
    );
    const config = parseEnvironment(env);
    expect(config.API_PORT).toBe(3001);
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.OPENAI_API_KEY).toBeUndefined();
  });

  it('boots liveness without database/provider credentials', () => {
    const config = parseEnvironment({});
    expect(config.API_PORT).toBe(3001);
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.OPENAI_API_KEY).toBeUndefined();
    expect(isAbsolute(config.STORAGE_ROOT)).toBe(true);
  });

  it('accepts empty future placeholders and bounded numeric overrides', () => {
    const config = parseEnvironment({
      DATABASE_URL: '',
      OPENAI_API_KEY: '',
      STORAGE_ROOT: '',
      API_PORT: '4001',
      CHUNK_TOKENS: '300',
      CHUNK_OVERLAP_TOKENS: '0',
      RETRIEVAL_MIN_SIMILARITY: '-1',
      AI_MAX_RETRIES: '0',
    });
    expect(config.API_PORT).toBe(4001);
    expect(config.CHUNK_OVERLAP_TOKENS).toBe(0);
    expect(config.AI_MAX_RETRIES).toBe(0);
    expect(config.OPENAI_API_KEY).toBeUndefined();
  });

  it.each([
    ['API_PORT', '0'],
    ['API_PORT', '65536'],
    ['API_HOST', 'public.example.com'],
    ['PORT', '65536'],
    ['API_PORT', '3001.5'],
    ['API_PORT', ''],
    ['NODE_ENV', 'preview'],
    ['STORAGE_ROOT', './relative'],
    ['WEB_ORIGIN', 'https://example.com'],
    ['WEB_ORIGIN', 'http://localhost:3000/path'],
    ['DATABASE_URL', 'https://example.com'],
    ['INGESTION_CONCURRENCY', '2'],
    ['EMBEDDING_DIMENSIONS', '3072'],
    ['RETRIEVAL_TOP_K', '11'],
    ['RETRIEVAL_MIN_SIMILARITY', 'NaN'],
    ['RETRIEVAL_MIN_SIMILARITY', '1.1'],
    ['MAX_UPLOAD_BYTES', '10485761'],
    ['AI_MAX_RETRIES', '-1'],
    ['AI_REQUEST_TIMEOUT_MS', 'Infinity'],
    ['MAX_CHUNKS', '0'],
  ])('rejects malformed/out-of-bounds %s', (key, value) => {
    expect(() => parseEnvironment({ [key]: value })).toThrow(key);
  });

  it('rejects overlap at or above the configured chunk size', () => {
    expect(() =>
      parseEnvironment({ CHUNK_TOKENS: '100', CHUNK_OVERLAP_TOKENS: '100' }),
    ).toThrow('CHUNK_OVERLAP_TOKENS');
  });

  it('reports only field names, never submitted credentials or Zod diagnostics', () => {
    const secret = 'secret-canary-that-must-not-appear';
    try {
      parseEnvironment({
        DATABASE_URL: secret,
        OPENAI_API_KEY: secret,
        API_PORT: secret,
      });
      throw new Error('Expected invalid configuration');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('API_PORT');
      expect(message).not.toContain(secret);
      expect(message).not.toContain('OPENAI_API_KEY');
    }
  });

  it('rejects public environment aliases without echoing the name or value', () => {
    expect(() =>
      parseEnvironment({ NEXT_PUBLIC_OPENAI_API_KEY: 'secret-canary' }),
    ).toThrow('NEXT_PUBLIC_* (unsupported)');
  });
});
