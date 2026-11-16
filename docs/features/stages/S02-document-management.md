# Stage S02 — Document Management

## Objective

Implement validated upload, private local storage, metadata browsing, and reliable deletion while leaving uploads pending for S03.

## Context

Read [FR-01/02](../../product/requirements.md), [US-01/03](../../product/user-stories.md), [API contracts](../../architecture/api-contracts.md), [data lifecycle](../../architecture/data-model.md), and [security](../../architecture/security.md). All fields already exist from S01.

## Dependencies

S00–S01 complete: Prisma/schema/migrations, storage configuration, health, shared schemas, and isolated integration harness. Stop if absent; do not implement infrastructure substitutes.

## Scope

Documents module, LocalDocumentStore, upload/list/detail/delete routes, quota/admission/path rules, safe errors, orphan and deleting reconciliation. No ingestion execution or reprocess endpoint yet.

## Technical Requirements

Stream exactly one file to an exclusive generated staging path with 10-MiB cap and two-stream concurrency bound. Apply [format rules](../../architecture/api-contracts.md) and canonical MIME; generate UUID paths, sanitize only display name, never serve originals publicly. Rename before a serialized quota/insert transaction and compensate on failure. Serialize document-count/original-byte/pending quota checks through one transaction-scoped advisory lock. The five-pending admission cap applies even though this stage intentionally has no processor; users can delete pending uploads.

Implement cursor pagination descending by creation time/UUID, optional status filter, and consistent DTOs without storage paths/content. Deletion must first invalidate run/hide evidence, clear chunks/text, then unlink, then remove metadata; missing rows/files are idempotent success. Use the S01 schema's run ID even though the runner arrives later. Deleting cleanup and safe aged orphan reconciliation are part of file lifecycle now, not deferred to polish.

## Implementation Tasks

- [ ] Add shared document/error/list schemas and thin controllers with OpenAPI examples.
- [ ] Implement storage validation/staging/rename/unlink/containment and upload compensation.
- [ ] Add serialized quota admission, metadata services, list/detail/pagination, and route rate limits.
- [ ] Implement deleting transition, retryable cleanup, startup deleting reconciliation and hourly aged-orphan cleanup restricted to generated paths.
- [ ] Document pending-only behavior and exercise REST workflow without frontend or AI.

## Expected Files and Modules

`apps/api/src/modules/documents/` controllers/services/storage helper; scoped persistence/cleanup helpers; shared document schemas; upload/API/storage test fixtures; affected OpenAPI/README documentation. No generic repository package.

## API Contracts

Implement POST/GET `/api/documents`, GET/DELETE `/api/documents/:id` exactly as [specified](../../architecture/api-contracts.md). POST returns 201/pending; DELETE returns empty 204 only when cleanup completes. All validation/status/error/cursor rules apply. Reprocess remains unavailable until S03.

## Database Changes

No planned schema change. Use existing entities/status/run fields. Any genuinely missing S01 constraint is a prerequisite defect to document/fix explicitly through a reviewed migration, not a manual database edit.

## Error Handling

Clean staging/files after rejected uploads, transaction failures, and client disconnects. Handle crash windows through aged orphan reconciliation. Storage failures use safe mapped errors. Failed deletion retains deleting metadata/error and may be retried. Do not expose filesystem paths or parser/provider details.

## Testing Requirements

Unit tests for format/UTF-8/name/path/limits and quota decisions. Real DB/temp-storage API tests for supported upload, duplicate filenames, empty/binary/conflicting/oversize files, missing UUID, list cursors/filter mismatch, quota races, missing original, partial deletion/DB failure, retry, cascade, and orphan containment/symlinks. Assert no retained rows/files on rejected uploads. Deterministic tests need no AI key.

## Acceptance Criteria

- [ ] Valid files persist with accurate pending metadata; unsupported/oversize/capacity failures match contracts and clean up.
- [ ] Stable-dataset pagination has no duplicate/missing items and exposes no private storage fields.
- [ ] Repeated delete and simulated cleanup faults obey lifecycle semantics and never report success with a retained original.
- [ ] Startup/hourly cleanup touches only owned generated paths; originals cannot be reached through the web server.

## Definition of Done

- [ ] Business/failure contracts pass tests and REST demo; README states processing is still planned.
- [ ] Record evidence and update only verified S02 roadmap items; stop before S03.

## Out of Scope

Text extraction, embeddings, runner/reprocessing API, semantic search, chat, frontend, public download/viewer.

## Verification Commands

With local database migrated and isolated storage/test setup:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
curl -i -F 'file=@/tmp/synthetic-notes.txt' http://localhost:3001/api/documents
curl -i 'http://localhost:3001/api/documents?limit=20'
```

Create a nonprivate supported `/tmp/synthetic-notes.txt` fixture before the illustrative curl command. Also record detail/delete/repeated-delete with a returned ID and controlled failure tests. Append actual results on implementation.

## Demo Scenario

Upload a small synthetic TXT, list and inspect its pending state, reject an unsupported/oversize input, then delete and repeat DELETE. Show metadata/file cleanup through integration evidence. Explain that ready processing begins in S03.
