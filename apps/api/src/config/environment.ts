import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    schema.optional(),
  );
const integer = (fallback: number, max = fallback, min = 1) =>
  z.preprocess(
    (value) =>
      value === undefined
        ? fallback
        : typeof value === 'string' && value.trim() === ''
          ? NaN
          : value,
    z.coerce.number().int().min(min).max(max),
  );
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const localOrigin = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.origin === value
  );
});

// Future-stage settings are validated when supplied, but do not enable features.
export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    API_PORT: integer(3001, 65535),
    API_HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
    PORT: integer(3000, 65535),
    WEB_ORIGIN: localOrigin.default('http://localhost:3000'),
    API_INTERNAL_URL: z
      .url({ protocol: /^http$/ })
      .default('http://127.0.0.1:3001'),
    STORAGE_ROOT: z.preprocess(
      (value) =>
        value === '' || value === undefined
          ? resolve(__dirname, '../../../../.local/documents')
          : value,
      z.string().refine(isAbsolute),
    ),
    DATABASE_URL: optional(postgresUrl),
    MIGRATION_DATABASE_URL: optional(postgresUrl),
    TEST_DATABASE_URL: optional(postgresUrl),
    SHADOW_DATABASE_URL: optional(postgresUrl),
    OPENAI_API_KEY: optional(z.string().trim().min(1)),
    OPENAI_CHAT_MODEL: optional(z.string().trim().min(1)),
    OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    EMBEDDING_DIMENSIONS: integer(1536, 1536, 1536),
    EMBEDDING_PROFILE_ID: z.string().min(1).default('openai-small-1536-v1'),
    PIPELINE_VERSION: z.string().min(1).default('v1'),
    MAX_UPLOAD_BYTES: integer(10485760),
    MAX_PDF_PAGES: integer(100),
    MAX_EXTRACTED_CHARS: integer(500000),
    MAX_DOCUMENT_TOKENS: integer(100000),
    MAX_CHUNKS: integer(256),
    MAX_DOCUMENTS: integer(100),
    MAX_STORED_BYTES: integer(209715200),
    MAX_PENDING_DOCUMENTS: integer(5),
    INGESTION_CONCURRENCY: integer(1),
    INGESTION_POLL_MS: integer(1000, 60000),
    CHUNK_TOKENS: integer(600),
    CHUNK_OVERLAP_TOKENS: integer(100, 599, 0),
    EMBEDDING_BATCH_SIZE: integer(32),
    RETRIEVAL_TOP_K: integer(5, 10),
    RETRIEVAL_MIN_SIMILARITY: z.preprocess(
      (value) =>
        value === undefined
          ? 0.3
          : typeof value === 'string' && value.trim() === ''
            ? NaN
            : value,
      z.coerce.number().min(-1).max(1),
    ),
    CONTEXT_MAX_TOKENS: integer(4000),
    ANSWER_MAX_OUTPUT_TOKENS: integer(800),
    QUESTION_MAX_CHARS: integer(2000),
    QUESTION_MAX_TOKENS: integer(512),
    AI_REQUEST_TIMEOUT_MS: integer(20000),
    AI_MAX_RETRIES: integer(2, 2, 0),
    INGESTION_TIMEOUT_MS: integer(180000),
    ASK_TIMEOUT_MS: integer(65000),
    EXTRACTION_TIMEOUT_MS: integer(15000),
    EXTRACTION_MAX_MEMORY_MB: integer(256),
    AI_MAX_CONCURRENT_REQUESTS: integer(2),
  })
  .superRefine((config, ctx) => {
    if (config.CHUNK_OVERLAP_TOKENS >= config.CHUNK_TOKENS) {
      ctx.addIssue({
        code: 'custom',
        path: ['CHUNK_OVERLAP_TOKENS'],
        message: 'Must be smaller than CHUNK_TOKENS.',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export class ConfigurationError extends Error {
  constructor(fields: string[]) {
    super(
      `Invalid environment configuration: ${[...new Set(fields)].join(', ')}. Check .env.example and supported bounds.`,
    );
    this.name = 'ConfigurationError';
  }
}

export function parseEnvironment(env: NodeJS.ProcessEnv): Environment {
  // S00 defines no public environment variables; reject accidental secret aliases.
  if (Object.keys(env).some((key) => key.startsWith('NEXT_PUBLIC_'))) {
    throw new ConfigurationError(['NEXT_PUBLIC_* (unsupported)']);
  }
  const result = environmentSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) =>
        String(issue.path[0] ?? 'environment'),
      ),
    );
  }
  return result.data;
}
