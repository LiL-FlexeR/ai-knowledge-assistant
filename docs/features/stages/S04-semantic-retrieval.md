# Stage S04 — Semantic Retrieval

## Objective

Expose bounded exact semantic search with profile-compatible embeddings and trustworthy source metadata.

## Context

Read [retrieval design](../../architecture/rag-pipeline.md), [vector SQL/data model](../../architecture/data-model.md), [search contract](../../architecture/api-contracts.md), [ADR-002](../../architecture/decisions/ADR-002-rag-design.md), and [FR-06](../../product/requirements.md). Similarity is a ranking signal, not factual confidence.

## Dependencies

S00–S03 complete: documents become ready with source locations, working EmbeddingClient/fake, vector publication and profile checks, real pgvector integration tests. Stop if the index/source invariants are missing.

## Scope

RetrievalService, query validation/embedding, focused vector SQL reader, source/excerpt mapper, POST `/api/search`, empty-evidence behavior, and retrieval-specific errors/tests.

## Technical Requirements

Use the same model/dimensions/input policy for query and document embeddings. Validate question/query token and character limits before a paid call. Check whether eligible ready documents exist first; none yields NO_READY_DOCUMENTS without embedding. Validate optional filter IDs exist, and apply filters before vector limiting.

Use parameterized `<=>` cosine-distance SQL joining ready documents/current profile/current run, stable chunk-ID tie ordering, and topK 1–10 (default 5). Apply the configured provisional similarity cutoff after selecting nearest candidates; fewer results are allowed. Bind all query values and UUID arrays, return scalar columns only, validate raw row shapes, and construct source DTOs from persisted metadata. Do not introduce an approximate index or a keyword fallback.

## Implementation Tasks

- [x] Add shared search request/response/source-location schemas and OpenAPI examples.
- [x] Implement ready/profile/config/optional-filter checks and validated query embeddings through the existing AI boundary.
- [x] Implement exact SQL retrieval, cutoff/order/bounds, and source/excerpt mapping.
- [x] Expose thin search controller with rate/capacity/deadline controls and distinct empty-evidence/upstream outcomes.
- [x] Add deterministic real-vector/API coverage and document the provisional threshold.

## Expected Files and Modules

API `modules/retrieval/` service/controller/vector reader/source mapper; shared search/source DTOs; SQL/database integration fixtures and provider error tests. Reuse database/AI/config infrastructure; do not introduce generic search repositories.

## API Contracts

Implement POST `/api/search` exactly as [specified](../../architecture/api-contracts.md). Query/topK/documentIds are the only request fields. Return results with real chunk IDs/similarities/source locations or insufficient_context with an explicit reason. No answer generation or source-ID invention.

## Database Changes

None planned. Exact search uses existing fixed vector column/relational indexes. If measured query plans later justify HNSW, that is a separate documented change with recall testing.

## Error Handling

No-ready/no-relevant evidence is 200, not an upstream error. Missing filter IDs return 404; malformed filters/query return 400. Provider errors/timeouts, invalid vectors, config/profile mismatch, and AI saturation use documented error envelopes. Do not expose embeddings/SQL/provider internals or downgrade failures to empty results.

## Testing Requirements

Unit query validation/token boundaries, source union mapping, excerpt Unicode limits, cutoff and safe errors. Actual PostgreSQL/pgvector tests use padded known vectors for ranking/ties/cutoff, active-profile/run/ready filters, document subsets, topK and empty corpus. API tests fake embeddings and verify contracts including profile mismatch, unknown IDs, provider failure/timeout and rate limits. Source locations must resolve to stored canonical text spans. No paid AI in deterministic tests.

## Acceptance Criteria

- [x] Known vectors return expected ordered bounded results and stored sources; all filters apply before limiting.
- [x] No-ready corpus skips embedding; no accepted hits returns the appropriate successful limitation.
- [x] Upstream/configuration faults remain distinguishable errors and raw vector fields never enter DTOs.
- [x] Search uses a single compatible profile and passes real database/API tests.

## Definition of Done

- [x] Required evidence is recorded and documentation describes threshold limitations without an accuracy claim.
- [x] Update only verified S04 roadmap items; stop before S05.

## Out of Scope

Chat generation, reranking, hybrid search, query rewriting, HNSW, agents, frontend search screen.

## Verification Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
curl -i -H 'Content-Type: application/json' -d '{"query":"maintenance window","topK":5}' http://localhost:3001/api/search
```

The illustrative curl requires a running configured API and indexed synthetic corpus; required tests use fakes. Record commands, environment, results, and any omitted live call.

## Demo Scenario

Search the synthetic corpus for the maintenance window, inspect the Markdown source span and score, filter to the PDF, then query an empty/unrelated corpus. Explain that the API returns passages rather than a generated answer in this stage.

## Verification evidence

Implemented and verified on 2026-11-17. S00–S03 prerequisites were checked before retrieval verification: the original real-database suite passed all 50 tests and both document/ingestion curl demos. No source/index prerequisite was missing.

### Delivered behavior and files

- `apps/api/src/modules/retrieval/`: thin JSON search controller, local request/rate guard, exported `RetrievalService`, focused exact vector reader and source mapper. Strict query/UTF-16/token/topK/UUID validation precedes paid work. Filter existence, database/vector/profile compatibility and eligible corpus checks precede embedding. Query text alone uses the existing model/dimensions/tokenizer and validates a single finite, nonzero float32-compatible vector.
- Vector SQL binds vector, UUID arrays, profile/model/dimensions/pipeline and limit; ready/current-run/document filters apply before exact distance ordering, UUID ties and topK. Cutoff applies to selected candidates. Strict scalar-row/source validation and Unicode-safe excerpts keep vectors/internal state out of public DTOs. No schema/migration/index changes or dependencies were added.
- `packages/shared/src/index.ts`, `scripts/generate-openapi.mjs`, `docs/architecture/openapi.json`: browser-safe search/source request/response schemas and implemented OpenAPI examples/errors. Ask remains absent.
- `apps/api/src/modules/ai/{embedding-client,openai-embedding-client,ai-capacity}.ts`: optional interactive capacity policy; full outbound capacity immediately rejects search with 429/Retry-After while ingestion keeps bounded waits. Existing adapter retries/timeouts/model validation remain in use.
- `apps/api/src/{app.module,local-request}.ts`, `modules/documents/document-admission.guard.ts`, `config/environment.ts`, `.env.example`: route wiring, shared existing local Host/Origin checks, downward-configurable 10/minute search window. The existing 65000-ms `ASK_TIMEOUT_MS` bounds search checks/embedding/SQL; disconnect cancellation reaches provider work. Database statements retain their three-second bound.
- `apps/api/test/retrieval.spec.ts`, `retrieval.integration.ts`, `embeddings.spec.ts`: query and source limits, successful empty outcomes, safe configuration/provider/output/capacity/timeout errors, HTTP envelopes/local admission, actual vector ordering/ties/cutoff/topK and filters, canonical PDF/TXT/Markdown span resolution, stale runs, source corruption, database faults and evidence invalidation during embedding.
- `scripts/ingestion-rest-demo.mjs`: actual curl POST search on an ephemeral loopback API, stored Markdown source/score inspection, PDF filtering, unrelated-vector cutoff and empty-corpus short circuit. The existing harness invokes it and removes its owned database/storage.
- Affected README/AGENTS, product requirement/story/success/demo records, architecture contracts/config/RAG/security/testing, ADR-002 implementation evidence and roadmap were synchronized. The accepted architecture did not change.

### Commands and results

Checks used Node **24.22.3**, pnpm **12.21.0**, existing pinned dependencies and the existing PostgreSQL **18.7** / pgvector **0.8.7** integration image. The shell initially exposed Node 24.16.0/pnpm 11.25.0; verified pinned versions were installed under `/tmp/aka-s04-tools` without changing repository manifests or lockfile. Commands below used that directory's `node_modules/.bin` on PATH. Docker used `DOCKER_CONTEXT=default` because the selected desktop socket was absent.

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed ESLint and Prettier. |
| `pnpm typecheck` | Passed shared/API/web strict checks and browser-safe shared import check. |
| `pnpm test` | Passed 3 harness guard tests and 156 API tests in 9 suites; generated OpenAPI matched shared schemas. No paid calls. |
| `pnpm test:integration` | Passed 62 tests in 4 suites using actual PostgreSQL/pgvector and fake embeddings; empty migrations, repeat deploy, introspection, before/after schema diff, REST demos and owned cleanup all passed. |
| `pnpm build` | Passed shared/API builds and Next.js production compilation/static generation. |
| S04 illustrative curl | Equivalent actual `curl -H 'Content-Type: application/json' -d '{"query":"maintenance window","topK":5}'` passed through the integration demo's ephemeral loopback port and fake configured AI, along with PDF-filtered and unrelated/empty searches. |

Sandboxed HTTP/child-process tests initially failed with EPERM; rerunning with the required execution permission passed. The sandboxed Next.js build could not launch its TypeScript configuration subprocess; the permitted build passed. These were environment restrictions, not skipped checks. The real integration harness used only generated test targets and removed its own container/network/storage.

### Review and limitations

Architecture/RAG review traced input → existing AI adapter → exact profile/run-filtered SQL → persisted source DTOs and source spans. No unresolved architectural, source-identity or retrieval-contract defect was found in the reviewed scope. Deterministic vectors establish mechanics, not paraphrase relevance or factual support. The default **0.30** cutoff remains a provisional noise filter requiring S07 calibration; similarity is not factual confidence. No live provider call, paid semantic evaluation or claim of account-specific model availability was made.

**S04 is complete. S05–S07 remain unchecked and unimplemented.** No generation, chat route, context assembly, frontend screen, reranking, hybrid fallback, query rewriting or approximate vector index was added.
