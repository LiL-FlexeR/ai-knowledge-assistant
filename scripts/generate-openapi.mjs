import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
const { z } = require('zod');
const contracts = require('../../packages/shared/dist/index.js');
const names = {
  Document: contracts.documentSchema,
  DocumentResponse: contracts.documentResponseSchema,
  DocumentListResponse: contracts.documentListResponseSchema,
  ErrorResponse: contracts.errorResponseSchema,
  HealthResponse: contracts.healthResponseSchema,
  ReadinessResponse: contracts.readinessResponseSchema,
};
const schemas = Object.fromEntries(
  Object.entries(names).map(([name, schema]) => {
    const json = z.toJSONSchema(schema);
    delete json.$schema;
    return [name, json];
  }),
);
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const exampleDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  filename: 'notes.txt',
  mimeType: 'text/plain',
  size: 4,
  status: 'pending',
  chunkCount: 0,
  processingError: null,
  createdAt: '2026-11-17T12:00:00.000Z',
  updatedAt: '2026-11-17T12:00:00.000Z',
  processedAt: null,
};
const requestId = '22222222-2222-4222-8222-222222222222';
const json = (schema, example) => ({
  'application/json': { schema: ref(schema), ...(example ? { example } : {}) },
});
const success = (schema, description, example) => ({
  description,
  content: json(schema, example),
  headers: { 'X-Request-Id': { schema: { type: 'string', format: 'uuid' } } },
});
const error = (code, description) => ({
  description,
  content: json('ErrorResponse', {
    error: { code, message: description },
    requestId,
  }),
});
const errors = {
  400: error('VALIDATION_ERROR', 'Invalid request.'),
  403: error('FORBIDDEN', 'Request is not allowed.'),
  404: error('DOCUMENT_NOT_FOUND', 'Document not found.'),
  409: error(
    'CAPACITY_EXCEEDED',
    'Document capacity is full. Delete a document before uploading.',
  ),
  413: error('PAYLOAD_TOO_LARGE', 'Document exceeds the upload size limit.'),
  415: error(
    'UNSUPPORTED_MEDIA_TYPE',
    'Unsupported or conflicting document format.',
  ),
  422: error(
    'INVALID_DOCUMENT',
    'Document must contain nonempty, nonbinary UTF-8 text.',
  ),
  429: {
    ...error('RATE_LIMITED', 'Too many requests. Try again shortly.'),
    headers: {
      'Retry-After': {
        schema: { type: 'integer', minimum: 1 },
        description: 'Seconds before retry.',
      },
    },
  },
  500: error('INTERNAL_ERROR', 'An unexpected error occurred.'),
  503: error('SERVICE_UNAVAILABLE', 'Service dependencies are not ready.'),
};
const responses = (...statuses) =>
  Object.fromEntries(
    statuses.map((status) => [
      status,
      { $ref: `#/components/responses/Error${status}` },
    ]),
  );
const id = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const output = {
  openapi: '3.1.0',
  info: {
    title: 'AI Knowledge Assistant local API',
    version: '0.2.0',
    description:
      'Implemented through S02. Uploads remain pending; no ingestion, reprocess, search, chat, or original download endpoints. Local single API process only.',
  },
  servers: [{ url: 'http://127.0.0.1:3001/api' }],
  paths: {
    '/health': {
      get: {
        responses: { 200: success('HealthResponse', 'Process is responsive.') },
      },
    },
    '/health/ready': {
      get: {
        responses: {
          200: success(
            'ReadinessResponse',
            'Local dependencies are ready; AI may be disabled.',
          ),
          ...responses(503),
        },
      },
    },
    '/documents': {
      post: {
        summary: 'Store one validated original and pending metadata',
        description:
          'Exactly one file and no fields. PDF header or strict nonbinary UTF-8 text must agree with .pdf/.txt/.md/.markdown suffix and MIME. Empty/generic MIME is allowed. Defaults: 10 MiB/file, two concurrent streams, 60-second upload deadline, 10 requests/minute. Admission serializes 100-document/200-MiB/five-pending quotas. All may be configured downward. No AI calls.',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                additionalProperties: false,
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: {
          201: {
            ...success(
              'DocumentResponse',
              'Original and pending metadata committed.',
              { data: exampleDocument, requestId },
            ),
            headers: {
              Location: {
                schema: { type: 'string' },
                example: `/api/documents/${exampleDocument.id}`,
              },
              'X-Request-Id': { schema: { type: 'string', format: 'uuid' } },
            },
          },
          ...responses(400, 403, 409, 413, 415, 422, 429, 503),
          500: error(
            'STORAGE_ERROR',
            'Document storage is unavailable. Database failures use INTERNAL_ERROR.',
          ),
        },
      },
      get: {
        summary: 'List documents by descending creation time and UUID',
        description:
          'Includes deleting documents. Defaults to 120 list/detail/delete requests per minute combined, configurable downward. Cursor is signed, bound to the status filter, and expires when the API restarts.',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: 'cursor',
            in: 'query',
            schema: { type: 'string', minLength: 1, maxLength: 1024 },
          },
          {
            name: 'status',
            in: 'query',
            schema: z.toJSONSchema(contracts.documentStatusSchema),
          },
        ],
        responses: {
          200: success('DocumentListResponse', 'One page of public metadata.', {
            data: {
              items: [exampleDocument],
              pagination: { limit: 20, nextCursor: null },
            },
            requestId,
          }),
          ...responses(400, 403, 429, 500, 503),
        },
      },
    },
    '/documents/{id}': {
      parameters: [id],
      get: {
        summary: 'Inspect public metadata',
        responses: {
          200: success('DocumentResponse', 'Document metadata.', {
            data: exampleDocument,
            requestId,
          }),
          ...responses(400, 403, 404, 429, 500, 503),
        },
      },
      delete: {
        summary: 'Invalidate evidence and finish original/metadata cleanup',
        description:
          'No body. Missing rows/files are idempotent success. Failures leave deleting metadata inspectable where possible; retry DELETE to resume.',
        responses: {
          204: { description: 'Cleanup complete. No body.' },
          ...responses(400, 403, 429, 503),
          500: error(
            'DELETE_FAILED',
            'Document cleanup failed. Retry deletion.',
          ),
        },
      },
    },
  },
  components: {
    schemas,
    responses: Object.fromEntries(
      Object.entries(errors).map(([status, response]) => [
        `Error${status}`,
        response,
      ]),
    ),
  },
};
const path = new URL('../docs/architecture/openapi.json', import.meta.url);
const serialized = JSON.stringify(output, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== serialized)
    throw new Error('OpenAPI is stale. Run pnpm api:openapi.');
  console.log('OpenAPI matches shared schemas.');
} else {
  writeFileSync(path, serialized);
}
