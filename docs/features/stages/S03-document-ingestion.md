# Stage S03 — Document Ingestion

## Objective

Process pending originals into complete source-aware chunk/vector generations with bounded failure-safe execution and manual reprocessing.

## Context

Read [RAG pipeline](../../architecture/rag-pipeline.md), [data model](../../architecture/data-model.md), [configuration](../../architecture/system-overview.md), [security](../../architecture/security.md), and [FR-03–05](../../product/requirements.md). Source units/offsets and fencing are fixed architectural invariants, not optional parser details.

## Dependencies

S00–S02 complete: private originals, metadata/status schema, compensated deletion, quotas, vector SQL proof and real integration harness. Stop on missing dependencies.

## Scope

Extractor adapters, normalized source map, token chunker, embedding boundary/OpenAI adapter, pending scanner, atomic publication/failure/recovery, and reprocess route. No search or answer generation.

## Technical Requirements

Verify and pin maintained PDF/tokenizer libraries compatible with Node/TS and selected embedding model. Require physical page extraction; reject unavailable provenance instead of inventing pages. TXT/Markdown retain original lines; heading detection excludes fenced code. Canonical normalization and exact chunk spans follow [pipeline](../../architecture/rag-pipeline.md). Terminate extraction workers on deadline/limits; configure container memory/CPU bounds and record native-allocation limitations.

Use one pending scanner/worker, atomic conditional claims, five admitted documents, and 180-second whole-run limit. Stage bounded text/chunks/vectors outside transactions, batch embeddings by both count and verified provider token cap, and map vectors by response indices. Validate profile/dimensions/nonzero finite values; use a two-call shared semaphore, bounded retries, and no nested SDK retries. Publish all chunks/text/profile plus ready in one transaction after run/status verification. Deletion/reprocessing must fence stale work. Startup marks interrupted processing failed; pending resumes; deleting cleanup remains idempotent.

## Implementation Tasks

- [x] Add page/section-aware extraction and original-line source maps with controlled invalid/scanned/encrypted/limit fixtures.
- [x] Implement normalization, token span chunking/overlap/forward progress, source validation and all document budgets.
- [x] Implement small EmbeddingClient interface, OpenAI adapter, deterministic fake, validation, deadline/retry/usage accounting.
- [x] Implement scanner/claims/publication/failure/startup/shutdown/cancellation paths and SQL insertion through transaction handle.
- [x] Add manual reprocess transaction/quota/original checks and shared DTO/OpenAPI; record parser/tokenizer/profile choices in architecture/README.

## Expected Files and Modules

API `modules/ingestion/` runner/extractors/normalizer/chunker/publisher, `modules/ai/` embedding boundary/adapter, documents reprocess service/controller extension, source fixtures and deterministic fakes. Avoid a separate embeddings package/provider framework.

## API Contracts

Existing upload remains 201/pending, now consumed by the runner; list/detail show actual transitions. Add POST `/api/documents/:id/reprocess` returning 202/pending, with documented 409/404/errors. Do not change public source/status/error shapes. Full runtime from this stage requires configured AI; deterministic tests inject fakes without paid credentials.

## Database Changes

No planned schema changes; populate S01 source/profile/run fields and vector chunks. Use short transactions and exact required vector insertion. If parser provenance needs a different JSON shape, update its contract, tests and documentation explicitly before publication; do not silently drop metadata.

## Error Handling

Map format/empty/source/limit/provider/storage/interruption failures to safe persistent errors. No partial chunks/text on failed runs. Conditional failure writes must not overwrite deleting/new-run states. Abort work on delete/shutdown/deadline and reject late publication. No silent document-level paid retry; user reprocess is explicit and costs may recur.

## Testing Requirements

Unit extraction/normalization/chunk tests include multi-page PDF, scanned/encrypted/malformed input, CRLF/BOM/NFC, Markdown fences/duplicate headings, Unicode spans, tiny units, long lines, chunk overlaps and caps. Provider tests cover response-index mapping, missing/wrong-dimensional/nonfinite/zero vectors, batching, retry eligibility and whole deadlines. Real database tests cover complete atomic publication/rollback, profile fields, no partial index on failure, reprocess clearing/regeneration, restart recovery, quota admission, and deletion while a fake provider is blocked. No paid APIs in required tests.

## Acceptance Criteria

- [x] Supported fixtures reach ready with exact canonical spans, correct physical pages/sections/lines and compatible vectors.
- [x] Invalid/over-budget/provider-failing inputs reach failed safely; original remains, partial chunks do not.
- [x] Restart/interruption, reprocess and delete-during-processing tests prove run fencing and no resurrected evidence.
- [x] Bounded extraction/provider work and API/readiness errors are documented and tested.

## Definition of Done

- [x] Required checks/demonstration pass; chosen libraries/profile and extraction limitations are recorded; paid live smoke, if omitted, is labeled not run.
- [x] Update only verified S03 roadmap items and stop before S04.

## Out of Scope

OCR, queues/Redis/BullMQ, multi-worker leases, search endpoints, generation, frontend, version history, provider alternatives.

## Verification Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Then upload the synthetic PDF/TXT/Markdown fixtures via the S02 REST workflow and inspect ready/failed transitions, reprocess, and deletion. Fake-provider integration checks are mandatory; a real OpenAI embedding smoke requires explicitly configured credentials and is optional/cost-bearing. Append actual commands/outcomes on implementation.

## Demo Scenario

Upload the two-page synthetic handbook and inspect ready metadata plus persisted source locations in test evidence. Demonstrate scanned-file failure, manual reprocess after a transient fake-provider fault, and deleting while processing without chunk resurrection.

## Verification evidence

Historical stage snapshot. Later-stage status statements below describe this stage's verification time; see the [current roadmap](../ROADMAP.md) for S00–S07 completion and limits.

Implemented and verified on **2026-11-17**. The requested file defines S03 as **Document Ingestion**; S02 already provides Document Management. S00–S02 prerequisites were inspected and their existing **34 real PostgreSQL/pgvector tests**, migrations/schema checks and curl lifecycle demo passed before dependent implementation. No schema migration was needed.

### Implemented functionality

- PDF.js extracts physical pages (including empty pages) through streamed text items. TXT and Markdown preserve original line maps; Markdown sections retain heading paths and distinct section ordinals, with ATX/Setext headings and fence handling. Canonical BOM/CRLF/NFC/trailing-horizontal-whitespace normalization and exact unit-relative spans are persisted with each complete generation.
- Token-aware Unicode-safe chunk selection prefers paragraph/sentence boundaries, recounts actual substrings, bounds overlap and guarantees progress. Page/character/pre-overlap token/chunk budgets fail before provider work. Extraction, normalization, token counting and chunking run in a terminable worker, with an empty environment and bounded bytes/settings, a 15-second deadline and 256-MiB heap budget. Tests also force deadline, cancellation and small-heap exhaustion.
- A focused `EmbeddingClient` and OpenAI SDK adapter batch by count and aggregate tokens, map response indices, validate model/dimensions/finite/nonzero float32 vectors, share a two-call semaphore, and record safe usage/attempt/latency diagnostics. SDK retries/logging are disabled. Explicit full-attempt and whole-operation cancellation/deadlines cover response processing and capacity waits; eligible network/429/5xx retries are bounded with backoff/Retry-After. Normal tests inject deterministic fakes.
- One scanner conditionally claims oldest pending rows. Complete text/source/profile/vector generations publish through the transaction handle under a row lock and run/status fence; forced midway insertion failure rolls back all prior inserts. Failures retain originals without partial evidence. Startup marks interrupted processing failed and resumes pending; deletion/shutdown abort active work, and stale results/failures cannot overwrite newer or deleting runs. A post-registration check closes deletion's claim-to-registration window.
- POST `/api/documents/:id/reprocess` validates body/query/UUID, accepts ready/failed with a readable original, serializes pending-capacity admission through S02's advisory lock, clears the old generation and assigns a new run, and returns 202/pending with Location. It preserves original metadata and shares upload throttling. Cancellation preserves a newly registered run if the scanner claims it immediately after reprocess commits.
- Missing AI configuration leaves uploads pending and readiness returns a safe 503 `aiConfiguration` failure; liveness and document management continue. Health never calls providers. Compose passes the server-only key to API, with 1-GiB/one-CPU resource limits. Database-only setup/migration still work without a key; full healthy runtime requires one.

### Dependency and profile verification

Pinned and locked **pdfjs-dist 6.5.438**, **js-tiktoken 1.0.21**, and **openai 7.57.0**. Registry stable tags/engines were inspected; PDF.js accepts Node >=22.13 or >=24 and the OpenAI SDK accepts >=22. Both were exercised with the repository's **Node 24.22.3 / pnpm 12.21.0**. Existing NestJS and Prisma versions were preserved.

The embedding profile remains `openai-small-1536-v1`, model `text-embedding-3-small`, explicit **1536** dimensions, canonical chunk text only, pipeline `v1`, bundled `cl100k_base` tokenizer ranks. Configuration rejects unverified model/profile/pipeline aliases. The [official embedding request contract](https://developers.openai.com/api/reference/resources/embeddings/methods/create) was checked for 8192 tokens/input, 2048 inputs/request and 300000 aggregate tokens; local caps are tighter (600 tokens/chunk, 32 inputs/batch). [PDF.js API documentation](https://github.com/mozilla/pdf.js/blob/master/src/display/api.js) and installed version types/source were checked for streamed page text and supported safety options; PDF.js 6 no longer exposes the old isEvalSupported flag. The [tokenizer implementation](https://github.com/dqbd/tiktoken/tree/main/js) supplies local cl100k_base ranks; special-token strings are encoded as source text.

### Commands and actual results

The default shell still selected older Node/pnpm and an unavailable Docker Desktop socket. Verification prepended the existing ignored `.local/s02-toolchain/bin` to PATH and used `DOCKER_CONTEXT=default` for the working daemon. HTTP tests and the production build ran with the necessary socket/process sandbox permission after restricted runs rejected loopback binds/spawned compilation. These environment corrections did not change project version pins or use application database/storage.

| Command | Final result |
| --- | --- |
| `pnpm lint` | Passed ESLint with zero warnings and Prettier |
| `pnpm typecheck` | Passed strict API/shared/web and browser-safe contract compilation |
| `pnpm test` | Passed **110 Jest tests in 8 suites**, **3 script target-guard tests**, and generated OpenAPI drift check |
| `DOCKER_CONTEXT=default pnpm test:integration` | Passed **50 real PostgreSQL/pgvector tests in 3 suites**, fresh/replayed migrations, introspection, pre/post schema diff, API build and both curl demos |
| `pnpm build` | Passed shared/API and Next.js production builds |
| `pnpm api:openapi` | Generated OpenAPI 3.1 with reprocess/source schemas and implemented S03 behavior |
| `docker compose config --format json` (captured, safe fields asserted only) | Validated API memory = 1073741824 bytes, CPU = 1, and absent key accepted for database-only configuration |
| `git diff --check` and affected Markdown links/anchors | Passed |
| Paid live embedding smoke / semantic evaluation | **Not run**; optional/cost-bearing, no API credentials used by verification |

The mandatory curl demo uses owned ephemeral loopback/database/storage targets and project-authored CC0 fixtures. Observed: TXT **201/pending → ready (1 chunk)**; two-page PDF **201/pending → ready (2 chunks)** with stored physical pages **1, 2**; Markdown **201/pending → ready (2 sections/chunks)**; image-only PDF → **failed/NO_EXTRACTABLE_TEXT**; transient fake-provider fault → failed → **202/reprocess → ready**; delete during blocked embedding → **204**, cancelled signal and **zero retained rows/chunks/files**. The original S02 upload/list/detail/invalid/oversize/delete demo also passes.

Unit coverage includes normalization/original lines, fences/duplicate and Setext headings, tiny units, Unicode/long-line spans and overlap, document/chunk caps, valid/malformed/encrypted-dictionary/image-only PDF inputs, page/character/deadline/heap limits, source corruption, response index/count/vector errors, count/token batches, retry eligibility, transport/whole-deadline/semaphore behavior and cancellation identity. Integration coverage includes ready source/profile/vector spans, safe failed generations, SQL rollback, reprocess clearing/regeneration and quota races, interrupted recovery, pending resume, missing-original/busy/transport errors, old-run rejection, shutdown/deadline, missing AI configuration and both deletion race windows.

### Changed files

- `apps/api/src/modules/ingestion/`: production preparation worker, source normalization/chunker/validation, bounded extraction service, focused persistence/publisher, scanner and module.
- `apps/api/src/modules/ai/`: embedding boundary, OpenAI adapter and shared capacity semaphore; `src/abortable.ts` and `src/processing-error.ts` provide small shared cancellation/error primitives.
- `apps/api/src/modules/documents/`: safe original reads, lifecycle cancellation registry, reprocess service/controller and module exports; `app.module.ts`, configuration and readiness wire S03 behavior.
- `packages/shared/src/index.ts`, `scripts/generate-openapi.mjs`, `docs/architecture/openapi.json`: browser-safe source/reprocess schemas and implemented contract generation.
- `apps/api/test/ingestion.spec.ts`, `embeddings.spec.ts`, `ingestion.integration.ts`, synthetic fixtures/fake, and affected readiness/document/database regression expectations.
- `scripts/ingestion-rest-demo.mjs`, integration harness, API manifest and lockfile; `.env.example` and Compose key/resource settings.
- README, AGENTS, affected product/architecture/ADR records, this stage and roadmap.

### Remaining limitations and roadmap status

No known outstanding S03 acceptance defect. PDF reading order, tables, glyph spacing and mixed image/text documents remain parser limitations. The image-only fixture proves absence of text-layer handling, not OCR quality; the synthetic encrypted-dictionary fixture proves safe password/unsupported handling, not every real encryption scheme. Worker heaps do not cap all native allocations; Compose limits constrain the container but do not establish a hostile-document sandbox. Database/storage outages can delay state writes or cleanup and may require restart/reprocess. Deletion is logical, not secure physical erasure.

Required checks used fake vectors: they establish integrity, cancellation and contracts, **not semantic quality or live account-specific model availability**. A paid live embedding smoke was not run. **S03 is complete; S04–S07 remain unchecked.** No search, answer generation, frontend product screens, queues, OCR or provider alternatives were added.
