# Implementation roadmap

**Status: S00–S03 complete; S04–S07 remain unimplemented.** Checks and limitations are recorded in [S00 evidence](stages/S00-project-setup.md#verification-evidence), [S01 evidence](stages/S01-database-and-infrastructure.md#verification-evidence), [S02 evidence](stages/S02-document-management.md#verification-evidence), and [S03 evidence](stages/S03-document-ingestion.md#verification-evidence). This is the primary execution plan for future sessions. Execute exactly the requested stage, verify its dependencies in the repository, and stop before the next stage. If prerequisites are missing, report the dependency instead of creating undocumented substitutes.

Read [AGENTS.md](../../AGENTS.md), [product requirements](../product/requirements.md), and relevant [architecture](../architecture/README.md). Detailed stage documents own execution detail; public behavior remains governed by [API contracts](../architecture/api-contracts.md). Verify current stable tooling during implementation; commands below are planned until their owning stage introduces them.

Completion evidence belongs in the final verification section of each stage document: commands/results, unavailable checks, remaining issues, and changed files. Mark an item complete only when its deliverable and required verification exist. A stage is complete only when its Definition of Done holds; no automatic advancement.

## S00 — Project Setup

**Goal:** Establish a reproducible, strict TypeScript pnpm workspace with app shells and quality commands.

**Dependencies:** Documentation foundation; no earlier implementation stage.

**Specification:** [S00-project-setup.md](stages/S00-project-setup.md).

**Implementation tasks**

- [x] Verify and pin compatible Node LTS, pnpm, NestJS, Next.js, TypeScript, and test/tooling versions; commit lockfile.
- [x] Create API/web/shared workspaces, server-safe configuration loading, shared contract foundation, and API liveness.
- [x] Add environment placeholders, ignore rules, lint/typecheck/test/build/dev commands, and accurate setup notes.

**Expected deliverables**

- [x] Workspace manifests, app shells, strict configuration, `.env.example`, and setup documentation.

**Acceptance criteria**

- [x] Fresh install/build/checks work; liveness returns its contract; malformed environment fails safely without leaking secrets.

**Required tests**

- [x] API liveness and meaningful configuration/error-contract tests; strict type/lint/build checks.

**Definition of Done**

- [x] All S00 criteria/checks have recorded evidence, version decisions are documented, and README accurately labels later capabilities planned.

## S01 — Database and Infrastructure

**Goal:** Supply local Compose services, migrations, real vector storage primitives, and readiness.

**Dependencies:** S00 complete.

**Specification:** [S01-database-and-infrastructure.md](stages/S01-database-and-infrastructure.md).

**Implementation tasks**

- [x] Pin PostgreSQL/pgvector image and compatible Prisma integration; create both entity schemas/custom vector migration.
- [x] Configure loopback-only Compose, database and original-file volumes, explicit migrations, and safe readiness.
- [x] Add isolated pgvector integration environment and database lifecycle scripts.

**Expected deliverables**

- [x] Compose/runtime files, Prisma schema/migrations, database/config/health modules, and test database harness.

**Acceptance criteria**

- [x] Empty-database migrations create the vector extension/type/constraints; real SQL can insert/query/rollback vectors; readiness fails safely on dependency faults.

**Required tests**

- [x] Migration, FK/uniqueness/cascade, parameterized raw SQL dimension/order, readiness, and isolated test-target guard checks.

**Definition of Done**

- [x] Compose and host paths/URLs are documented and verified; required checks pass with no AI calls or public exposure.

## S02 — Document Management

**Goal:** Persist validated private originals and metadata with list/detail/delete APIs.

**Dependencies:** S00–S01 complete.

**Specification:** [S02-document-management.md](stages/S02-document-management.md).

**Implementation tasks**

- [x] Implement bounded multipart validation, generated file paths, serialized quota admission, and 201/pending response.
- [x] Implement cursor list/detail, idempotent compensated deletion, safe errors, and orphan/deleting cleanup.
- [x] Publish shared DTO/OpenAPI contracts and route admission limits; document that pending does not process yet.

**Expected deliverables**

- [x] Documents module, local file store, public schemas, and document API tests.

**Acceptance criteria**

- [x] Supported files persist; invalid/oversize/quota failures do not leak state; pagination is stable; deletion retries complete and files are private.

**Required tests**

- [x] Validation/path/quota unit tests; real database/storage upload/list/detail/delete and compensation/concurrent-admission API tests.

**Definition of Done**

- [x] Document-management contracts and failure paths pass; ingestion remains explicitly unimplemented and roadmap evidence is recorded.

## S03 — Document Ingestion

**Goal:** Build complete searchable generations from private originals with bounded single-process processing.

**Dependencies:** S00–S02 complete.

**Specification:** [S03-document-ingestion.md](stages/S03-document-ingestion.md).

**Implementation tasks**

- [x] Implement source-aware extractors, normalization/line mapping, deterministic token chunks, and extraction limits.
- [x] Add the OpenAI embedding boundary/fake, bounded batches/timeouts/retries, vector validation, and atomic publication.
- [x] Implement pending claims, run fencing, restart recovery, cancellation, and explicit reprocess API.

**Expected deliverables**

- [x] Ingestion module, AI embedding adapter, source fixtures, shared reprocess/status schemas, and integration coverage.

**Acceptance criteria**

- [x] PDF/TXT/Markdown become ready with correct locations; failures/interruption/deletion leave no partial or resurrected index; retry produces one new generation.

**Required tests**

- [x] Extract/normalize/chunk/embedding/retry unit tests; actual pgvector publication/rollback/reprocess/restart/delete-race integration with mocked AI.

**Definition of Done**

- [x] Bounds and lifecycle invariants are verified; selected parser/tokenizer/provider compatibility is recorded; no retrieval/generation feature is silently added.

## S04 — Semantic Retrieval

**Goal:** Expose ready/profile-filtered cosine search with trustworthy source metadata.

**Dependencies:** S00–S03 complete.

**Specification:** [S04-semantic-retrieval.md](stages/S04-semantic-retrieval.md).

**Implementation tasks**

- [ ] Implement validated query embeddings and parameterized exact vector queries with document/profile/run filters.
- [ ] Add topK/cutoff behavior, deterministic ordering, source/excerpt DTO mapping, and POST `/api/search`.
- [ ] Short-circuit empty corpus and distinguish insufficient context from provider/configuration errors.

**Expected deliverables**

- [ ] Retrieval module, shared search schemas/OpenAPI, and real vector retrieval tests.

**Acceptance criteria**

- [ ] Known vectors rank correctly; filters and result bounds hold; all hit locations resolve; empty evidence and upstream faults have distinct contracts.

**Required tests**

- [ ] Input/source mapper tests; real pgvector order/cutoff/filter tests; API validation/provider-error contract tests with fake embeddings.

**Definition of Done**

- [ ] Search invariants/checks pass and provisional threshold is documented without treating similarity as factual confidence.

## S05 — AI Question Answering

**Goal:** Return grounded structured answers with server-created citations and explicit limitations.

**Dependencies:** S00–S04 complete.

**Specification:** [S05-ai-question-answering.md](stages/S05-ai-question-answering.md).

**Implementation tasks**

- [ ] Select/record a compatible generation model; implement context budget/deduplication and untrusted-evidence prompt.
- [ ] Implement grounded generation interface, statement/source validation, safe refusal/insufficient/error outcomes, usage and deadlines.
- [ ] Add POST `/api/chat/ask`, deterministic public answer formatting, and cited-run consistency recheck.

**Expected deliverables**

- [ ] Chat module, AI generation adapter, prompt/schema version, ask DTO/OpenAPI, and grounding failure tests.

**Acceptance criteria**

- [ ] Every answered statement has valid admitted references; invalid/truncated citations fail; no-context skips generation; changed/deleted evidence returns 409.

**Required tests**

- [ ] Context/prompt/status/citation/deadline unit tests; API tests for answers, gaps, conflicts, ambiguity, refusals, injection fixtures and deletion/reprocess races using fake AI.

**Definition of Done**

- [ ] Ask contracts pass, chosen model/cost/context checks are documented, and limitations distinguish identity validation from factual support.

## S06 — Frontend

**Goal:** Deliver the two-screen local workflow with accessible feedback and inspectable sources.

**Dependencies:** S00–S05 complete.

**Specification:** [S06-frontend.md](stages/S06-frontend.md).

**Implementation tasks**

- [ ] Implement typed API client/proxy, Documents upload/pagination/status/error/delete/reprocess flows, and bounded polling.
- [ ] Implement Ask AI form, loading/results/citations/insufficient/refusal/error/retry states.
- [ ] Add accessible shadcn/ui layouts, safe plain-text rendering, provider/local-only disclosures, and responsive/browser checks.

**Expected deliverables**

- [ ] Next.js pages, shared-schema integration, TanStack Query/form hooks, and deterministic browser tests.

**Acceptance criteria**

- [ ] Keyboard-accessible upload→ready→ask→inspect-source→delete works; errors/empty states are understandable; no server secrets enter bundles.

**Required tests**

- [ ] API/form/source rendering checks, mock-provider browser workflow, Origin/proxy/multipart/error behavior, and desktop/narrow visual inspection.

**Definition of Done**

- [ ] Two screens and all outcome states are verified, browser checks pass, and README/demo match the actual UI.

## S07 — Testing and Polish

**Goal:** Consolidate regression evidence, synthetic AI evaluation, reproducible demo, and accurate documentation.

**Dependencies:** S00–S06 complete.

**Specification:** [S07-testing-and-polish.md](stages/S07-testing-and-polish.md).

**Implementation tasks**

- [ ] Materialize gold synthetic corpus/cases, offline harness, explicit capped live evaluation, and result-report schema.
- [ ] Close critical lifecycle/API/browser coverage gaps and verify a fresh documented Compose setup.
- [ ] Run demo scenarios, review security/architecture/RAG quality, and synchronize setup/contracts/roadmap with evidence.

**Expected deliverables**

- [ ] Redistributable fixtures, evaluation scripts/report, regression evidence, and verified portfolio README/demo.

**Acceptance criteria**

- [ ] Required deterministic suites pass; evaluation reports real counts/settings and live status honestly; no unresolved critical lifecycle/citation/security defects.

**Required tests**

- [ ] Build/lint/typecheck/unit/integration/browser/offline evaluation, fresh migration/setup, and explicit live evaluation when available; record omissions.

**Definition of Done**

- [ ] All MVP success criteria have linked evidence or explicitly disclosed limitations; no future infrastructure or unmeasured quality claims are introduced.

## Post-MVP

The [optional backlog](../product/mvp-scope.md) is outside these stages. Authentication and deployment hardening must precede public hosting. Future work starts only through an explicit scoped request and updated decisions, not as an automatic S08.
