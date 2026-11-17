# REST API contracts

S04 implements health, upload/list/detail/delete, background ingestion, reprocess, and semantic search. Generated [OpenAPI 3.1](openapi.json) uses the browser-safe shared response schemas and includes the multipart request schema, response examples, statuses, reusable errors, and admission limits. Regenerate with `pnpm api:openapi`; `pnpm test` checks for drift. Ask remains planned for S05. No Swagger UI or public file route is installed.

## Conventions

Base path `/api`; JSON UTF-8 except multipart upload and empty 204. UUID IDs; ISO 8601 UTC timestamps. Character limits/offsets use UTF-16 code units, with truncation only at valid Unicode boundaries. Validate requests with shared Zod schemas at the API boundary, reject unknown JSON/query fields, trim queries/questions, and never rely on client validation. JSON request body maximum 16 KiB. UUID arrays contain 1–20 unique values when supplied; omission means all ready documents. Unknown filter IDs return 404; known non-ready documents contribute no evidence.

Successful JSON responses use `{ "data": <DTO>, "requestId": "<server-id>" }`. Collections place items and pagination inside data. Generate a server request ID, return it in `X-Request-Id`, and use it in diagnostics; do not trust arbitrary client IDs as log fields. 204 has no body. API examples below show data DTOs unless an envelope is shown explicitly. Return no vectors, storage paths, raw provider errors, or full extracted content.

Error envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Question must not be empty.",
    "details": [{"path": "question", "message": "Expected a nonempty string."}]
  },
  "requestId": "req-example"
}
```

`details` is optional and contains safe field errors, never submitted content. No stack traces or API credentials. 429 includes integer `Retry-After` seconds. Rate-limit/admission failures use the same envelope.

## Shared DTOs

`ProcessingError = {code: string, message: string, retryable: boolean}`. It is null unless a processing/deletion error exists. Retryable describes whether manual retry may help, not a promise to retry automatically.

`DocumentDTO` (exact public fields):

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "filename": "handbook.pdf",
  "mimeType": "application/pdf",
  "size": 12000,
  "status": "pending",
  "chunkCount": 0,
  "processingError": null,
  "createdAt": "2026-11-16T12:00:00.000Z",
  "updatedAt": "2026-11-16T12:00:00.000Z",
  "processedAt": null
}
```

`status` is `pending | processing | ready | failed | deleting`. Readiness means a complete searchable chunk set, not a quality guarantee. No fabricated percentage progress. `processedAt` is nonnull only for the current successful ready generation; reprocess/delete clears it.

`SourceDTO = {documentId: UUID, filename: string, location: SourceLocation, excerpt: string}`. Excerpt is the first at most 1000 UTF-16 characters of the stored chunk, cut at a valid Unicode boundary; location refers to the full chunk. The UI labels it as an excerpt.

`SourceLocation` is exactly the discriminated union in [data model](data-model.md): PDF uses physical page plus normalized unit-relative offsets; TXT uses section 1 and original line range; Markdown uses section ordinal, heading path, and original lines. All use `unitIndex`, `charStart`, `charEnd`. No TXT/Markdown page field. Excerpts/filenames are plain text, never trusted HTML.

`CitationDTO = {sourceId: string, chunkId: UUID, source: SourceDTO}`. IDs such as `S1` are unique only within one answer. Every citation corresponds to an admitted retrieved chunk. Sources may be absent after later deletion; the response includes its own excerpt for inspection, with no public download route in MVP.

## Document routes

### POST /api/documents — S02

Multipart form with exactly one `file`, no additional fields. Limit one file to 10 MiB. Allowed suffixes `.pdf`, `.txt`, `.md`, `.markdown` (case insensitive). Require compatible server-verified bytes: PDF header and later parser validation; strict UTF-8 nonbinary text for TXT/Markdown. Canonical MIME comes from validated format, not the browser claim. Allow an empty or generic `application/octet-stream` client type when suffix/bytes agree; reject a conflicting known type. A filename alone never proves format.

201 returns `DocumentDTO` with pending status and `Location: /api/documents/:id`. Return after local storage/metadata commit; do not wait for embeddings. From S03 the scanner consumes pending rows with configured AI; without credentials uploads wait and readiness reports 503. Upload success alone does not establish a ready generation. Empty/invalid text and obvious invalid file signatures fail immediately. PDF parser errors and extracted-content limits discovered later appear as failed status.

Errors: 400 malformed multipart/count/fields; 413 file too large; 415 unsupported or conflicting format; 422 empty/invalid UTF-8 content; 429 request rate; 409 `CAPACITY_EXCEEDED` for 100-document, 200-MiB-original, or five-pending/processing quota; 500 `STORAGE_ERROR`/`INTERNAL_ERROR`. Staging files must be cleaned on failure.

### GET /api/documents — S02

Query: `limit` integer default 20, range 1–100; `cursor` opaque validated cursor for descending `(createdAt,id)`; optional `status` enum. Return 200:

```json
{"items": [], "pagination": {"limit": 20, "nextCursor": null}}
```

Cursor encodes the last item's immutable creation time and UUID, bound to the current status filter; tampered/malformed/filter-mismatched cursors return 400. No total count required. Include deleting rows until cleanup completes. Fetch limit+1 to determine nextCursor.

S02 signs cursors with a process-local HMAC key. Cursors expire on API restart; restart listing without a cursor after a 400. Pagination is stable for an unchanged dataset; status changes may move rows between filtered pages.

### GET /api/documents/:id — S02

200 `DocumentDTO`; 400 invalid UUID; 404 `DOCUMENT_NOT_FOUND`. Used for status inspection/polling. No raw file serving or internal extracted-text endpoint.

### DELETE /api/documents/:id — S02

No body. 204 after file/chunk/metadata cleanup; repeated deletion of an absent valid UUID also returns 204. Valid during pending/processing: invalidate the run before cleanup. A retry on deleting resumes cleanup. 400 invalid UUID; 500 `DELETE_FAILED` when cleanup cannot finish; the deleting row/error remains inspectable. Do not report success while the original file remains. See [compensating lifecycle](data-model.md).

### POST /api/documents/:id/reprocess — S03

No body. Accept only ready/failed with an existing original. 202 returns pending `DocumentDTO` and Location header. It clears the indexed generation and schedules a fresh run. 400 invalid UUID/body; 404 unknown document; 409 `DOCUMENT_BUSY` for pending/processing/deleting, `CAPACITY_EXCEEDED` for admission limits, or `ORIGINAL_FILE_MISSING` when original cannot be read. Permission/storage faults return 500. New embeddings may incur cost; the frontend labels this action.

## Semantic search

### POST /api/search — S04

Request DTO:

```json
{"query": "What is the maintenance window?", "topK": 5, "documentIds": ["11111111-1111-4111-8111-111111111111"]}
```

`query` required, 1–2000 trimmed UTF-16 characters and ≤512 `cl100k_base` tokens; reject unpaired surrogates. `topK` optional integer 1–10, default configured `RETRIEVAL_TOP_K` (5); `documentIds` optional, with case-insensitive UUID uniqueness. Character/token/rate caps may be lowered. No client-supplied similarity threshold or provider model. Require JSON with no URL query fields. Validate filters and database/profile compatibility before checking the eligible corpus; an empty corpus skips both AI configuration and embedding. A missing key with eligible evidence returns 503.

200 SearchResponse: `{status: "results" | "insufficient_context", reason: null | "NO_READY_DOCUMENTS" | "NO_RELEVANT_CONTEXT", results: SearchHit[]}`. A hit is `{chunkId: UUID, chunkIndex: number, similarity: number, source: SourceDTO}`. Results are similarity-descending with deterministic UUID ties. Empty results always produce insufficient_context and a reason; nonempty results produce results/null. Similarity is cosine `1 - distance` in [-1,1], not probability. Sources are the persisted location plus server excerpt; no model generation.

Search allows `SEARCH_REQUESTS_PER_MINUTE` (default 10) per socket client in a fixed 60-second window. A full shared outbound semaphore immediately returns 429 `AI_CAPACITY_EXCEEDED`; the rate window returns 429 `RATE_LIMITED`. Both include `Retry-After`. `ASK_TIMEOUT_MS` (default 65000) bounds the whole search, including database checks, embedding and retries; client disconnect cancels provider work. Existing per-attempt timeouts and bounded retries apply.

400 validation; 404 unknown document filter; 429 rate limit/AI capacity; 502 `AI_UPSTREAM_ERROR`/`AI_OUTPUT_INVALID`; 503 `AI_NOT_CONFIGURED`, `EMBEDDING_PROFILE_MISMATCH`, or `SERVICE_UNAVAILABLE`; 504 `AI_TIMEOUT`. Search never treats an upstream failure as empty evidence.

## Question answering

### POST /api/chat/ask — S05

Request DTO: `{question: string, topK?: integer, documentIds?: UUID[]}` with the same query bounds/filter rules as search. No conversation history, tools, or streaming.

200 AskResponse:

```json
{
  "status": "answered",
  "answer": "The maintenance window is Sunday at 02:00 UTC. [S1]",
  "statements": [{"text": "The maintenance window is Sunday at 02:00 UTC.", "sourceIds": ["S1"]}],
  "citations": [{
    "sourceId": "S1",
    "chunkId": "22222222-2222-4222-8222-222222222222",
    "source": {
      "documentId": "11111111-1111-4111-8111-111111111111",
      "filename": "handbook.pdf",
      "location": {"kind": "pdf", "unitIndex": 0, "page": 1, "charStart": 0, "charEnd": 220},
      "excerpt": "Example fixture text describing the Sunday maintenance window..."
    }
  }],
  "reason": null,
  "limitation": null,
  "retrieval": {"requestedTopK": 5, "matchedChunks": 1, "contextChunks": 1},
  "usage": {"embeddingInputTokens": 8, "generationInputTokens": 320, "generationOutputTokens": 40}
}
```

Numbers and text above are illustrative fixtures, not measured results. All top-level keys are required. Usage counts are nonnegative integers or null when unavailable; `usage` itself is always present. `matchedChunks` counts threshold-passing retrieval results; `contextChunks` counts admitted evidence, possibly fewer.

| Status | Required behavior |
| --- | --- |
| `answered` | Nonempty statements; each has ≥1 valid sourceId; citations are exactly the distinct referenced evidence IDs; reason null; limitation null or a concise evidence limitation/conflict note |
| `insufficient_context` | Empty statements/citations; answer and limitation explain the gap; reason `NO_READY_DOCUMENTS`, `NO_RELEVANT_CONTEXT`, or `EVIDENCE_INSUFFICIENT`; no generation for the first two |
| `refused` | Empty statements/citations; safe answer/limitation; reason `PROVIDER_REFUSAL`; distinct from evidence insufficiency |

The server builds `answer` from validated statements and markers, appending any limitation separately. Return only used citations, in context-ID order (IDs need not be contiguous after unused sources are removed). No claims in limitation beyond describing the evidence gap/conflict. Every source location is server-owned. The UI displays text/statement citation links and safe source cards.

Search errors also apply. Additionally 409 `DOCUMENT_CHANGED` if cited document runs disappear/change before response, and 502 `AI_OUTPUT_INVALID` for malformed, truncated, uncited, or unknown-ID output. Do not convert provider timeouts to insufficient evidence. The frontend offers a user retry; do not silently regenerate invalid answers.

## Health

### GET /api/health — S00, extended S01/S03

Liveness: 200 `{status: "ok"}` when HTTP process is responsive. No external calls.

### GET /api/health/ready — S01

200 `{status: "ready", checks: {database: "ok", storage: "ok", embeddingProfile: "ok", aiConfiguration: "ok" | "disabled"}}`. S01/S02 may use disabled AI. From S03 full runtime requires configured AI. 503 uses the error envelope with `SERVICE_UNAVAILABLE` and safe detail identifying failed check names, not credentials/paths. Check database/extension, dimension/profile compatibility, storage writability, and locally validated config only. Never call paid models from health endpoints.

## Processing error vocabulary

Persist safe codes for `INVALID_DOCUMENT`, `UNSUPPORTED_PDF`, `NO_EXTRACTABLE_TEXT`, `SOURCE_LOCATION_UNAVAILABLE`, `EXTRACTION_LIMIT_EXCEEDED`, `CHUNK_LIMIT_EXCEEDED`, `AI_UPSTREAM_ERROR`, `AI_TIMEOUT`, `AI_OUTPUT_INVALID`, `PROCESSING_INTERRUPTED`, `ORIGINAL_FILE_MISSING`, `STORAGE_ERROR`, and `DELETE_FAILED`. Input/format/limit errors are not retryable without changing the file or configuration; interruption/transient provider/storage failures may be manually retried. No automatic document-level paid retry. HTTP codes describe request outcomes; processing errors describe later domain state.

OpenAPI generation in implementation must match these contracts and shared schemas, with request/response examples and reusable errors. Do not expose Swagger publicly or promise endpoints before their owning stages exist.
