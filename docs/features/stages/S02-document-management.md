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

- [x] Add shared document/error/list schemas and thin controllers with OpenAPI examples.
- [x] Implement storage validation/staging/rename/unlink/containment and upload compensation.
- [x] Add serialized quota admission, metadata services, list/detail/pagination, and route rate limits.
- [x] Implement deleting transition, retryable cleanup, startup deleting reconciliation and hourly aged-orphan cleanup restricted to generated paths.
- [x] Document pending-only behavior and exercise REST workflow without frontend or AI.

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

- [x] Valid files persist with accurate pending metadata; unsupported/oversize/capacity failures match contracts and clean up.
- [x] Stable-dataset pagination has no duplicate/missing items and exposes no private storage fields.
- [x] Repeated delete and simulated cleanup faults obey lifecycle semantics and never report success with a retained original.
- [x] Startup/hourly cleanup touches only owned generated paths; originals cannot be reached through the web server.

## Definition of Done

- [x] Business/failure contracts pass tests and REST demo; README states processing is still planned.
- [x] Record evidence and update only verified S02 roadmap items; stop before S03.

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

## Verification evidence

Historical stage snapshot. Later-stage status statements below describe this stage's verification time; see the [current roadmap](../ROADMAP.md) for S00–S07 completion and limits.

Implemented and verified on 2026-11-17. S00–S01 prerequisites were inspected and the existing isolated PostgreSQL/pgvector suite passed (10 tests) before document implementation. No schema migration or change to vector dimensions/profile was needed.

### Implemented behavior

- POST streams exactly one file to exclusive private staging, validates suffix/MIME/bytes and strict nonbinary UTF-8, sanitizes the display basename, and promotes to a generated original path. Two streams and a 60-second receipt/validation deadline bound admission. Exact byte-limit inputs are accepted. Unsupported, malformed, empty/binary, oversize, quota, storage and database faults use safe envelopes and compensate files.
- A short transaction takes PostgreSQL transaction advisory lock `71002`, then checks all document/original-byte and pending+processing quotas before inserting pending metadata and a fresh run ID. Deleting rows retain document/byte reservations. No transaction spans streaming or filesystem work.
- List/detail expose only shared public DTOs. Pagination uses descending creation time/UUID with limit+1; HMAC-signed cursors are status-filter-bound and expire at API restart. Unknown/tampered/filter-mismatched inputs fail safely.
- DELETE row-locks, invalidates the run and clears chunks/text/profile fields before unlinking the original, then removes metadata. Missing originals/rows and concurrent/repeated deletes are safe. Storage/finalization failures return `DELETE_FAILED`, retaining an inspectable deleting error where possible. Startup and hourly reconciliation retry deletion and remove only aged, unreferenced generated paths, skipping symlinks/unknown entries.
- Route guards enforce configured local Host/mutation Origin rules and socket-client request limits with integer `Retry-After`. Defaults can be lowered. Originals are outside static roots, with new file/directory modes 0600/0700 and no public file endpoint.
- Browser-safe Zod schemas drive public responses and generated [OpenAPI](../../architecture/openapi.json); `pnpm api:openapi` regenerates it and `pnpm test` checks drift. No Swagger UI is added.

### Commands and actual outcomes

The host initially selected Node 24.16.0/pnpm 11.25.0 and a missing Docker Desktop socket. Verification used the pinned Node **24.22.3** and pnpm **12.21.0**, cached in ignored `.local/s02-toolchain`, with that `bin` directory prepended to `PATH`. `DOCKER_CONTEXT=default` selected the working local daemon. These environment corrections did not alter project version pins or use the normal application database/storage.

| Command | Final result |
| --- | --- |
| `pnpm lint` | Passed ESLint and Prettier with zero warnings |
| `pnpm typecheck` | Passed API/shared/web strict compilation and browser-safe contract imports |
| `pnpm test` | Passed 74 Jest tests in 6 suites, 3 script target-guard tests, and generated OpenAPI drift check |
| `DOCKER_CONTEXT=default pnpm test:integration` | Passed 34 real PostgreSQL/pgvector tests in 2 suites, migration replay/idempotence, introspection, pre/post schema diff, API build and curl REST demo |
| `pnpm build` | Passed shared/API compilation and Next.js production static build |
| `pnpm api:openapi` | Regenerated OpenAPI 3.1 for implemented health and document routes |
| `git diff --check` | Passed |
| Relative Markdown links/anchors in changed documents | Passed, 114 references checked |

Supertest sockets and the final production build ran outside the filesystem/network sandbox after sandbox-local socket and spawned TypeScript checks failed. The final full build passed without changing application code to bypass its checks. No required check remains unavailable; no AI key, provider request, or live evaluation was used.

The integration harness runs `scripts/document-rest-demo.mjs` against an ephemeral loopback port and its owned database/storage. It creates synthetic TXT/unsupported/oversize fixtures and runs actual `curl -i` commands. Final statuses: **201** upload/pending, **200** list, **200** detail, **415** unsupported, **413** oversize, **204** delete, **204** repeated delete. It asserts no retained metadata or originals, then removes only its fixtures/project. The demo handles curl's informational `100 Continue` response before reading the final upload status.

Controlled tests cover duplicate names and all suffixes, strict UTF-8/binary/header/MIME validation, exact/oversize boundaries, malformed/multiple multipart inputs, missing/invalid UUIDs, query whitelist and tied-timestamp pagination, filter mismatch/tampering, racing count/bytes/pending quotas, processing/deleting reservations, insert rollback, storage faults, run invalidation/chunk cleanup, missing originals, unlink/finalization failure and retry, concurrent deletion, startup/hourly cleanup, orphan age/reference rules, path traversal and symlinks, Host/Origin/rate limits, simultaneous streams, disconnect cleanup and stalled-stream deadlines.

### Dependencies and changed files

Pinned `busboy` **1.6.0** and `@types/busboy` **1.5.5** with the lockfile. The npm registry stable tags and [Busboy's primary documentation](https://github.com/mscdex/busboy#api) were checked for streaming events/limits and Node compatibility (Node >=10.16; exercised here on 24.22.3). Existing NestJS/Prisma/Zod majors and all database/schema files are preserved. The locking implementation follows [PostgreSQL transaction advisory-lock semantics](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS).

- `apps/api/src/modules/documents/`: controller, application service, local store, multipart receiver, cursor/validation helpers, request guard, reconciliation service and module.
- `apps/api/src/api-error.ts`, `src/http.ts`, `src/app.module.ts`, `src/config/environment.ts`: safe domain error mapping, module registration and downward-configurable admission/deadline settings.
- `packages/shared/src/index.ts`, `scripts/generate-openapi.mjs`, `docs/architecture/openapi.json`: public schemas and generated implemented contracts.
- `apps/api/test/documents.spec.ts`, `documents.integration.ts`, `http.spec.ts`, `scripts/document-rest-demo.mjs`, `scripts/test-integration.mjs`: deterministic/error/lifecycle checks and isolated REST verification.
- Root/API manifests, `pnpm-lock.yaml`, `.env.example`, `AGENTS.md`, `README.md`, affected product/architecture documents, ADR-003 implementation status, this stage and the roadmap.

### Remaining limits and roadmap status

No known outstanding S02 acceptance issue. Filesystem/database compensation is not atomic across a crash; aged reconciliation may delay orphan removal, and continuing storage/database faults can delay deleting cleanup. Cursors and rate windows reset on restart. The unauthenticated application remains local and single-process; deletion is logical, not guaranteed physical erasure.

**S02 is complete. S03–S07 remain unchecked and unimplemented.** Uploads remain pending indefinitely in this stage, up to five admitted pending/processing rows. Delete uploads to free capacity. Extraction, embeddings, ingestion execution/recovery, reprocess, retrieval, chat and frontend product screens were not implemented or evaluated.
