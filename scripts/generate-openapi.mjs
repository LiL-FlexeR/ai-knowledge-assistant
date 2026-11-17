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
  ReprocessResponse: contracts.reprocessResponseSchema,
  SourceLocation: contracts.sourceLocationSchema,
  Source: contracts.sourceSchema,
  SearchRequest: contracts.searchRequestSchema,
  SearchResponse: contracts.searchResponseSchema,
  AskRequest: contracts.askRequestSchema,
  AskResponse: contracts.askResponseSchema,
  AnswerStatement: contracts.answerStatementSchema,
  Citation: contracts.citationSchema,
  AskUsage: contracts.askUsageSchema,
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
const askBase = {
  statements: [],
  citations: [],
  retrieval: { requestedTopK: 5, matchedChunks: 0, contextChunks: 0 },
  usage: {
    embeddingInputTokens: 0,
    generationInputTokens: null,
    generationOutputTokens: null,
  },
};
const askExamples = Object.fromEntries(
  [
    {
      ...askBase,
      status: 'answered',
      reason: null,
      limitation: null,
      statements: [
        { text: 'Maintenance is Sunday at 02:00 UTC.', sourceIds: ['S1'] },
      ],
      answer: 'Maintenance is Sunday at 02:00 UTC. [S1]',
      citations: [
        {
          sourceId: 'S1',
          chunkId: requestId,
          source: {
            documentId: exampleDocument.id,
            filename: 'operations.md',
            location: {
              kind: 'markdown',
              unitIndex: 0,
              sectionOrdinal: 1,
              headingPath: ['Maintenance'],
              lineStart: 1,
              lineEnd: 1,
              charStart: 0,
              charEnd: 35,
            },
            excerpt: 'Maintenance is Sunday at 02:00 UTC.',
          },
        },
      ],
      retrieval: { requestedTopK: 5, matchedChunks: 1, contextChunks: 1 },
      usage: {
        embeddingInputTokens: 8,
        generationInputTokens: 320,
        generationOutputTokens: 40,
      },
    },
    ...[
      'NO_READY_DOCUMENTS',
      'NO_RELEVANT_CONTEXT',
      'EVIDENCE_INSUFFICIENT',
      'PROVIDER_REFUSAL',
    ].map((reason) => ({
      ...askBase,
      status:
        reason === 'PROVIDER_REFUSAL' ? 'refused' : 'insufficient_context',
      reason,
      answer:
        reason === 'PROVIDER_REFUSAL'
          ? 'The AI provider declined this request.'
          : 'The available evidence cannot answer this question.',
      limitation:
        reason === 'PROVIDER_REFUSAL'
          ? 'The AI provider declined this request.'
          : 'The available evidence cannot answer this question.',
      ...(reason === 'EVIDENCE_INSUFFICIENT' || reason === 'PROVIDER_REFUSAL'
        ? {
            retrieval: { requestedTopK: 5, matchedChunks: 1, contextChunks: 1 },
            usage: {
              embeddingInputTokens: 8,
              generationInputTokens: 320,
              generationOutputTokens: 40,
            },
          }
        : {}),
    })),
  ].map((data) => [
    data.reason ?? data.status,
    { value: contracts.askResponseSchema.parse({ data, requestId }) },
  ]),
);
const output = {
  openapi: '3.1.0',
  info: {
    title: 'AI Knowledge Assistant local API',
    version: '0.5.0',
    description:
      'Implemented through S05. Source-aware ingestion, exact semantic search and structured question answering with server-created citations. Ingestion, reprocess, search and ask may incur OpenAI cost. Product UI and original downloads remain unavailable. Local single API process only.',
  },
  servers: [{ url: 'http://127.0.0.1:3001/api' }],
  paths: {
    '/chat/ask': {
      post: {
        summary: 'Answer a question using admitted document evidence',
        description:
          'JSON only, no query fields. Same trimmed question, token, topK and document filter rules as search. Each socket client has a separate 10 asks/minute limit (ASK_REQUESTS_PER_MINUTE, configurable downward). Full shared AI capacity returns immediate 429. One embedding and at most one generation before eligible transport retries. Complete spans only, deduplicated with >50% overlap suppression and a 4000 o200k_base evidence-token cap; full prompt/schema/metadata plus output reservation checked against model limits. Server validates 1–8 statements (1–500 characters each), admitted source IDs, and exactly the distinct used citations in context order. Server formats answer markers and locations. Empty/irrelevant evidence skips generation. Refusal is distinct from insufficiency. Invalid/truncated/uncited output is 502 without repair generation. Whole ASK_TIMEOUT_MS (65000 default) includes embedding, generation, retry/backoff and the final cited-run/profile check; disconnect cancels work. No tools, streaming or history. Citation identities do not prove factual support. Usage examples are illustrative, not measured.',
        requestBody: {
          required: true,
          content: json('AskRequest', {
            question: 'When is the Orion maintenance window?',
            topK: 5,
          }),
        },
        responses: {
          200: {
            ...success(
              'AskResponse',
              'Answered, insufficient_context or refused; all response keys are present.',
            ),
            content: {
              'application/json': {
                schema: ref('AskResponse'),
                examples: askExamples,
              },
            },
          },
          ...responses(400, 403, 404, 413),
          409: error(
            'DOCUMENT_CHANGED',
            'Cited documents changed or disappeared. Retry the question.',
          ),
          429: {
            ...errors[429],
            description:
              'RATE_LIMITED or AI_CAPACITY_EXCEEDED, with Retry-After.',
          },
          502: error(
            'AI_OUTPUT_INVALID',
            'AI_OUTPUT_INVALID for malformed, incomplete or invalid references; AI_UPSTREAM_ERROR for provider failure.',
          ),
          503: error(
            'AI_NOT_CONFIGURED',
            'AI_NOT_CONFIGURED, EMBEDDING_PROFILE_MISMATCH, AI_CONTEXT_LIMIT or SERVICE_UNAVAILABLE.',
          ),
          504: error(
            'AI_TIMEOUT',
            'Question answering exceeded its deadline or a provider attempt timed out.',
          ),
        },
      },
    },
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
            'Local dependencies and AI configuration are ready; no paid health calls.',
          ),
          ...responses(503),
        },
      },
    },
    '/search': {
      post: {
        summary: 'Search ready passages by exact cosine similarity',
        description:
          'JSON only; no query parameters. Trimmed query: 1–2000 UTF-16 characters and at most 512 cl100k_base tokens. topK defaults to configured 5, range 1–10. Optional documentIds: 1–20 unique existing UUIDs. Ready/profile/current-run and document filters apply before limiting, then the provisional configured similarity cutoff (default 0.30) applies. Scores rank passages, not factual confidence. No eligible documents skips embedding. Each socket client is limited to 10 searches/minute (configurable downward); full shared AI capacity returns immediate 429. Whole search uses ASK_TIMEOUT_MS (default 65000), including database checks and provider retries. Plain-text excerpts contain at most 1000 UTF-16 characters at Unicode boundaries; locations identify full chunks.',
        requestBody: {
          required: true,
          content: json('SearchRequest', {
            query: 'maintenance window',
            topK: 5,
          }),
        },
        responses: {
          200: {
            ...success(
              'SearchResponse',
              'Ranked passages or an explicit successful evidence limitation.',
            ),
            content: {
              'application/json': {
                schema: ref('SearchResponse'),
                examples: {
                  results: {
                    value: {
                      data: {
                        status: 'results',
                        reason: null,
                        results: [
                          {
                            chunkId: requestId,
                            chunkIndex: 0,
                            similarity: 0.75,
                            source: {
                              documentId: exampleDocument.id,
                              filename: 'policy.md',
                              location: {
                                kind: 'markdown',
                                unitIndex: 0,
                                sectionOrdinal: 1,
                                headingPath: ['Operations'],
                                lineStart: 1,
                                lineEnd: 2,
                                charStart: 0,
                                charEnd: 48,
                              },
                              excerpt:
                                '# Operations\nMaintenance is Sunday at 02:00 UTC.',
                            },
                          },
                        ],
                      },
                      requestId,
                    },
                  },
                  noReady: {
                    value: {
                      data: {
                        status: 'insufficient_context',
                        reason: 'NO_READY_DOCUMENTS',
                        results: [],
                      },
                      requestId,
                    },
                  },
                  noRelevant: {
                    value: {
                      data: {
                        status: 'insufficient_context',
                        reason: 'NO_RELEVANT_CONTEXT',
                        results: [],
                      },
                      requestId,
                    },
                  },
                },
              },
            },
          },
          ...responses(400, 403, 404, 413),
          429: {
            ...errors[429],
            description:
              'RATE_LIMITED or AI_CAPACITY_EXCEEDED. Retry-After is always present.',
          },
          502: error(
            'AI_UPSTREAM_ERROR',
            'AI_UPSTREAM_ERROR for provider failure; AI_OUTPUT_INVALID for an invalid query embedding.',
          ),
          503: error(
            'AI_NOT_CONFIGURED',
            'AI_NOT_CONFIGURED, EMBEDDING_PROFILE_MISMATCH, or SERVICE_UNAVAILABLE. Failures never become empty evidence.',
          ),
          504: error(
            'AI_TIMEOUT',
            'Search exceeded its deadline or a provider attempt timed out.',
          ),
        },
      },
    },
    '/documents': {
      post: {
        summary: 'Store one validated original and pending metadata',
        description:
          'Exactly one file and no fields. PDF header or strict nonbinary UTF-8 text must agree with .pdf/.txt/.md/.markdown suffix and MIME. Empty/generic MIME is allowed. Defaults: 10 MiB/file, two concurrent streams, 60-second upload deadline, 10 upload/reprocess requests/minute combined. Admission serializes 100-document/200-MiB/five-pending quotas. All may be configured downward. Upload returns pending; background processing sends canonical chunk text to OpenAI when configured.',
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
    '/documents/{id}/reprocess': {
      parameters: [id],
      post: {
        summary:
          'Clear a ready/failed generation and schedule processing again',
        description:
          'No body or query. Requires a readable original and pending capacity. Atomically clears old evidence and assigns a new run. Shares the upload request limit. Re-embedding may incur cost.',
        responses: {
          202: {
            ...success(
              'ReprocessResponse',
              'Pending metadata with old evidence invalidated.',
              { data: exampleDocument, requestId },
            ),
            headers: {
              Location: {
                schema: { type: 'string' },
                example: `/api/documents/${exampleDocument.id}`,
              },
            },
          },
          ...responses(400, 403, 404, 429, 500, 503),
          409: error(
            'DOCUMENT_BUSY',
            'DOCUMENT_BUSY for pending/processing/deleting; CAPACITY_EXCEEDED for pending capacity; ORIGINAL_FILE_MISSING if the original cannot be found.',
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
