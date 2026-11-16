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

- [ ] Add shared search request/response/source-location schemas and OpenAPI examples.
- [ ] Implement ready/profile/config/optional-filter checks and validated query embeddings through the existing AI boundary.
- [ ] Implement exact SQL retrieval, cutoff/order/bounds, and source/excerpt mapping.
- [ ] Expose thin search controller with rate/capacity/deadline controls and distinct empty-evidence/upstream outcomes.
- [ ] Add deterministic real-vector/API coverage and document the provisional threshold.

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

- [ ] Known vectors return expected ordered bounded results and stored sources; all filters apply before limiting.
- [ ] No-ready corpus skips embedding; no accepted hits returns the appropriate successful limitation.
- [ ] Upstream/configuration faults remain distinguishable errors and raw vector fields never enter DTOs.
- [ ] Search uses a single compatible profile and passes real database/API tests.

## Definition of Done

- [ ] Required evidence is recorded and documentation describes threshold limitations without an accuracy claim.
- [ ] Update only verified S04 roadmap items; stop before S05.

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
