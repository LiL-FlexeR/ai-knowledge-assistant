# Data model and lifecycle

## Entities

Two entities are sufficient. No users, conversations, jobs, or provider registry in MVP. Use UUID identifiers, UTC `timestamptz`, snake_case SQL tables (`documents`, `document_chunks`), and camelCase application DTOs.

| Document field | Type / invariant |
| --- | --- |
| `id` | UUID primary key, server-generated |
| `filename` | Sanitized display basename, 1–255 characters; never a path |
| `mimeType` | Canonical `application/pdf`, `text/plain`, or `text/markdown` |
| `size` | Positive integer bytes, within upload limit |
| `status` | Enum `pending`, `processing`, `ready`, `failed`, `deleting` |
| `storagePath` | Unique relative generated path `<id>/original.<validated-extension>` |
| `extractedContent` | Nullable text, normalized canonical content; internal only |
| `sourceMap` | Nullable JSONB array of source units and their canonical content spans |
| `chunkCount` | Nonnegative integer, default 0 |
| `embeddingProfileId`, `embeddingModel`, `embeddingDimensions` | Nullable until successful publication; populated together on ready |
| `pipelineVersion` | Nullable until publication; identifies extraction/normalization/chunking rules |
| `processingRunId` | UUID fence assigned at upload/reprocess; remains stable through a run |
| `processingStartedAt`, `processedAt` | Nullable timestamps |
| `processingError` | Nullable JSONB `{code, message, retryable}`; safe, bounded user message |
| `createdAt`, `updatedAt` | Required timestamps |

| DocumentChunk field | Type / invariant |
| --- | --- |
| `id` | UUID primary key, regenerated on reprocessing |
| `documentId` | UUID foreign key → Document, `ON DELETE CASCADE` |
| `processingRunId` | Same successful run as parent |
| `content` | Nonempty canonical text of a single source-unit span |
| `chunkIndex` | Integer, zero-based contiguous order within document |
| `tokenCount` | Positive integer, within configured chunk budget |
| `sourceLocation` | JSONB discriminated union defined below |
| `embedding` | Required pgvector `vector(1536)` in initial schema |
| `createdAt` | Required timestamp |

One Document has zero to many chunks. Enforce unique `(document_id, chunk_index)`, FK cascade, nonnegative numeric fields, and status enum in SQL. Application validation checks JSON source shapes and ready invariants; do not claim a simple CHECK constraint can enforce cross-row counts. Index documents on `(created_at DESC, id DESC)` for pagination and `(status, created_at, id)` for processing; unique chunk ordering also indexes document lookups. No vector index initially.

## Canonical source representation

`sourceMap` stores ordered units `{unitIndex, contentStart, contentEnd, location}` over `extractedContent`, with integer UTF-16 offsets, start inclusive/end exclusive. Separators inserted between units are outside unit spans. PDF units are individual extracted pages; text is one document unit; Markdown units are heading-delimited sections (including an optional preamble). Each unit retains a line-to-character map for TXT/Markdown so line references survive normalization. Units, chunk spans, and source excerpts are validated before publication.

Chunk `charStart`/`charEnd` are relative to the normalized source unit, not original file bytes. `content` must equal that unit substring. Citation locations identify the original page or original text lines, with normalized offsets for reproducibility:

```text
PDF:      {kind: "pdf", unitIndex, page, charStart, charEnd}
TXT:      {kind: "text", unitIndex: 0, sectionOrdinal: 1,
           lineStart, lineEnd, charStart, charEnd}
Markdown: {kind: "markdown", unitIndex, sectionOrdinal, headingPath: string[],
           lineStart, lineEnd, charStart, charEnd}
```

Page, sectionOrdinal, and inclusive original line numbers start at 1. Unit indices start at 0. PDF page means physical file page, not a printed page label. Chunks never cross pages or sections. Do not manufacture PDF page numbers when a parser cannot preserve them: reject that extraction with `SOURCE_LOCATION_UNAVAILABLE` until a page-aware parser works. TXT has the whole document as section 1; Markdown heading paths may be empty for a preamble. Identical headings remain distinct through sectionOrdinal.

## State transitions and publication

```text
upload → pending → processing → ready
                         └──→ failed
ready / failed → reprocess → pending
any non-deleted state → deleting → row absent
```

1. Stream upload into a generated staging file with byte cap; validate content, sanitize display name, and rename into generated original path on the same volume. In a short transaction serialize quota checks (one transaction-scoped PostgreSQL advisory lock) and insert pending metadata. If insertion fails, remove the file; reconciliation handles a crash between filesystem and database operations. Do not hold the transaction while streaming.
2. The single API runner scans oldest pending rows every second. Claim with a conditional pending→processing update and capture `processingRunId`; no provider work occurs in a transaction. Bound admission to five pending/processing documents, not an unbounded in-memory list. Pending database rows are the recoverable work ledger, with no queue service.
3. Extract/chunk/embed into bounded memory (limits in [system overview](system-overview.md)). In a short transaction lock the document row, verify processing state and run ID, insert the entire validated chunk set through parameterized SQL, write extracted content/source map/profile fields, and mark ready together. If fencing fails, discard results. Never hold a database transaction across an AI call.
4. On failure, conditionally mark only the matching run failed; leave no chunks/extracted content from this run. Store a safe processing error. Originals remain for inspection/retry. A transaction failure is rolled back before the failed-state write.
5. On startup, mark interrupted processing rows failed with `PROCESSING_INTERRUPTED` (no silent paid retry), resume pending rows, and reconcile deleting rows. The single-instance restriction makes this recovery safe; multi-replica leases are future work.

## Reprocessing

`POST /api/documents/:id/reprocess` accepts ready/failed only. After original-file existence checks, a short row-locked transaction serializes pending-capacity admission, deletes old chunks, sets chunkCount to zero, clears extracted/source/profile/pipeline/processing timestamp fields and errors, sets a new run UUID, and marks pending. Reprocessing consumes one pending/processing slot but does not reserve another document or another copy of its original bytes. It preserves original metadata and creation time. Processing/pending/deleting requests return 409. This deliberately makes a document unavailable during reprocessing; there is no version history or fallback generation. Each retry may incur embedding cost.

## Deletion and compensation

`DELETE` first row-locks and marks deleting, invalidates the run UUID, deletes chunks, sets chunkCount to zero, and clears extracted content, source map, profile/pipeline fields, processing timestamps and prior errors in a transaction. Then unlink the validated original path and empty generated document directory; treat an already missing file as success. Finally remove the document row in another short transaction. Return 204 only after completion. If storage/database finalization fails, keep deleting metadata where possible, record `DELETE_FAILED`, return 500, and let a subsequent DELETE or startup reconciliation retry. The row remains visible with its error but is unsearchable. Reprocessing cannot resurrect it; late ingestion publication fails its fence. Cascade deletion is a final safeguard.

Filesystem and database changes cannot share a transaction. Startup and periodic cleanup (hourly) inspect only API-generated staging/document paths; remove unreferenced files older than one hour, with path containment checks. Never traverse arbitrary directories or follow symlinks. Retained deleting rows count against storage/document quotas until completion. Failed uploads and extraction errors clean staging promptly. This is logical deletion, not guaranteed physical erasure on SSDs or backups.

S02 implements upload/list/detail/delete and this compensating lifecycle without a schema change. Staging names are `<UUIDv4>.upload` directly under the private root; originals retain `<UUIDv4>/original.<validated-extension>`. New directories/files use modes 0700/0600, stage creation is exclusive with no-follow semantics, and storage operations reject symlink ancestors/files. Cleanup skips unknown paths and symlinks and removes only empty generated directories. Uploads stay pending until S03 supplies the runner; no extracted content or chunks are created by S02 uploads.

## Prisma and pgvector integration

The stable architectural choice is **Prisma-managed relational persistence plus custom SQL migrations and parameterized vector SQL**, contained in API infrastructure. Do not depend on automatic native vector CRUD. S01 pins Prisma 7.10.1 with `PrismaPg` and verifies tagged `$executeRaw`/`$queryRaw` and transaction handles against real pgvector. Use the [version-7 raw-query reference](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries); version-8 APIs differ. [ADR-003](decisions/ADR-003-data-storage.md#s01-implementation-and-compatibility) records compatibility and privilege decisions. S01's insert/distance adapter is internal infrastructure only; publication and ready/profile-filtered retrieval remain S03/S04 work.

- Migration creates `vector` extension before the chunks table and declares `embedding vector(1536) NOT NULL`.
- In schema-based Prisma versions, represent the column as `Unsupported("vector(1536)")`; introspect/verify the exact supported representation. Where a newer schema system requires a type declaration, supply the minimum supported mapping while retaining the SQL boundary.
- Prisma 7 introspection prints the base `Unsupported("vector")` without its dimension and omits CHECK constraints. Use `db pull --print` without overwriting the committed fixed-dimension mapping; verify the actual type with SQL catalogs/readiness and preserve custom migration SQL. Prisma's relational schema diff alone cannot verify these constraints.
- Create/read ordinary metadata with Prisma. Insert chunks and perform vector search through a focused SQL adapter using the pinned client's parameter binding and transaction handle. Required unsupported columns mean generated chunk create APIs may be unavailable; raw insertion supplies every required field.
- Validate all vector elements as finite numbers, length exactly 1536, and nonzero norm. Serialize a validated vector to a bound text parameter cast to `vector(1536)`. Bind query, UUID filters, and limits; never interpolate user strings into SQL or use unsafe raw APIs.
- Select scalar metadata/content/location/distance only; do not return the unsupported vector column to Prisma's result decoder. Validate raw-row shapes before creating public DTOs.
- Use a real database integration probe for insertion, rollback, vector ordering, deletion cascade, and schema regeneration. No `SELECT *` on vector tables.

Illustrative query contract (not a migration or application implementation):

```sql
SELECT c.id, c.document_id, c.content, c.source_location,
       1 - (c.embedding <=> $1::vector(1536)) AS similarity
FROM document_chunks c
JOIN documents d ON d.id = c.document_id
WHERE d.status = 'ready' AND d.embedding_profile_id = $2
  AND c.processing_run_id = d.processing_run_id
ORDER BY c.embedding <=> $1::vector(1536), c.id
LIMIT $3;
```

Optional document filters are additional bound UUID predicates. Post-filter by the configured similarity cutoff. The [pgvector documentation](https://github.com/pgvector/pgvector) defines `<=>` as cosine distance; similarity is `1 - distance`. Exact search is the initial baseline. Consider HNSW with cosine operator class only after dataset-size measurements justify it, with recall evaluation against exact search.

## Migration and compatibility procedure

Commit all schema changes as reviewable migrations; test from an empty database and a prior schema. Use an isolated migration/shadow database where the selected Prisma release needs one. Migration privileges may create extensions; runtime credentials should not need schema-changing privileges.

Embedding profile includes provider, model, dimensions, and embedding-input policy. Same dimensions do not make different models compatible. Both ingestion and query use the active profile. Startup/readiness checks the actual vector type dimension and stored ready profiles against configuration; a mismatch disables retrieval/AI operations with 503 rather than mixing spaces.

For a profile change: stop API ingestion/query traffic, back up if needed, invalidate all ready rows to pending with new run IDs and cleared indexed fields, delete all old chunks, apply a dimension-changing migration if required, update the profile/configuration together, and restart to rebuild from originals. Perform invalidation as a reviewed maintenance operation, not hidden startup deletion. Changing pipeline rules similarly requires explicit reprocessing; do not relabel old chunks. Document this procedure and expected downtime in the implementing change.
