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

- [ ] Add page/section-aware extraction and original-line source maps with controlled invalid/scanned/encrypted/limit fixtures.
- [ ] Implement normalization, token span chunking/overlap/forward progress, source validation and all document budgets.
- [ ] Implement small EmbeddingClient interface, OpenAI adapter, deterministic fake, validation, deadline/retry/usage accounting.
- [ ] Implement scanner/claims/publication/failure/startup/shutdown/cancellation paths and SQL insertion through transaction handle.
- [ ] Add manual reprocess transaction/quota/original checks and shared DTO/OpenAPI; record parser/tokenizer/profile choices in architecture/README.

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

- [ ] Supported fixtures reach ready with exact canonical spans, correct physical pages/sections/lines and compatible vectors.
- [ ] Invalid/over-budget/provider-failing inputs reach failed safely; original remains, partial chunks do not.
- [ ] Restart/interruption, reprocess and delete-during-processing tests prove run fencing and no resurrected evidence.
- [ ] Bounded extraction/provider work and API/readiness errors are documented and tested.

## Definition of Done

- [ ] Required checks/demonstration pass; chosen libraries/profile and extraction limitations are recorded; paid live smoke, if omitted, is labeled not run.
- [ ] Update only verified S03 roadmap items and stop before S04.

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
