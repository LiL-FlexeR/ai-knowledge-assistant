# Stage S07 — Testing and Polish

## Objective

Consolidate MVP verification, build a meaningful synthetic evaluation harness, and deliver an honest reproducible portfolio demo.

## Context

Read [testing/evaluation strategy](../../architecture/testing-strategy.md), [success criteria](../../product/success-criteria.md), [demo scenarios](../../product/demo-scenarios.md), [security](../../architecture/security.md), and the [roadmap](../ROADMAP.md). Earlier stages must already include their required tests; this stage closes measured gaps rather than postponing correctness.

## Dependencies

S00–S06 complete with required deliverables and passing checks. Identify missing dependencies before evaluation; do not mark the MVP complete around absent functionality. Credentials/network for live evaluation are optional and must be reported if unavailable.

## Scope

Synthetic fixture corpus/gold spans/cases, deterministic offline harness, explicit capped live evaluation, regression gaps, fresh setup/demo verification, architecture/RAG/security/documentation consistency review, and final evidence reporting. No new product features or retrieval algorithms.

## Technical Requirements

Materialize the original fictional corpus and E01–E12 in [testing strategy](../../architecture/testing-strategy.md), including generated two-page PDF provenance. Keep expected locations as logical spans independent of chunk UUIDs/boundaries. Separate retrieval metrics, citation identity, citation support, groundedness, abstention and special-case judgments. Report numerators/denominators and N/A rather than fabricated perfect empty scores. Preserve per-case outcomes and known failures; no aggregate accuracy marketing claim.

Offline evaluation uses fakes and verifies mechanics only. Live evaluation is an explicit separate command with model/config/corpus/prompt versions, case/request cap, output limits, verified current pricing for estimated cost ceiling, actual usage, and optional human judgments. It must not run in default test/build/CI commands. A capped paid run requires deliberate invocation/configuration; do not bypass missing credentials or silently expand cases/retries. Record an unrun live evaluation as not run, not passed.

## Implementation Tasks

- [ ] Add redistributable fixture documents, logical gold spans, all twelve cases and harness/config/report formats.
- [ ] Add `eval:offline` and opt-in `eval:live`; implement usage/cost/case/deadline caps and reproducibility metadata.
- [ ] Audit lifecycle/vector/API/browser coverage and fix demonstrated critical gaps within existing MVP scope.
- [ ] Run fresh-install/empty-database/Compose setup and all documented demo scenarios; record actual observations.
- [ ] Review module boundaries, safe file/SQL/provider handling, grounding/injection limitations and public exposure defaults.
- [ ] Synchronize README/product/architecture/contracts/stages and completion evidence; disclose remaining limitations and live-evaluation status.

## Expected Files and Modules

Small API evaluation area such as `apps/api/evaluation/` for synthetic documents/cases/harness; appropriately ignored or committed synthetic-only result reports; integration/browser test additions; final README/demo/architecture updates. Do not create a new package/service for evaluation without a demonstrated need.

## API Contracts

No new endpoints. Verify implemented OpenAPI/shared schemas match every documented DTO/status/error and public example. Fix discrepancies at their source with regression evidence rather than silently rewriting scope.

## Database Changes

None planned. Evaluation uses an isolated database/storage root and explicit corpus reset guarded like integration tests. A demonstrated integrity defect may require a reviewed migration and updated affected specifications; do not alter user data manually.

## Error Handling

Evaluation fails visibly on fixture/setup/schema/cap errors and records provider/network omissions separately from incorrect answers. Preserve partial synthetic run results with a termination reason. No secret/content logging from real user data. Fresh setup verification must preserve existing user volumes; use a separate named test/demo project.

## Testing Requirements

Full lint/type/build/unit/integration/browser/offline evaluation. Fresh frozen-lockfile install, migrations from empty and prior schema, Compose health, restart/reprocess/deletion compensation, source consistency and safe rendering regressions. Live evaluation, if explicitly configured, reviews each curated case and reports actual retrieval/citation/support/abstention/conflict/injection outcomes. Manually inspect the two-screen demo and local privacy/exposure notices.

## Acceptance Criteria

- [ ] Required deterministic suites pass and fresh documented setup works on the recorded environment.
- [ ] E01–E12 have gold evidence/outcomes and offline mechanics checks; live status/settings/results are recorded honestly.
- [ ] Every curated live answer that was run has source-support review; remaining quality failures are listed, not hidden by averages.
- [ ] No known unresolved invalid-citation, secret-disclosure, or critical lifecycle defect remains; documentation matches implementation and local-only limits.

## Definition of Done

- [ ] Link verification evidence to MVP success criteria and record exact commands/results/unavailable checks/remaining limitations.
- [ ] Mark S07 and other roadmap items complete only when their own criteria hold; do not convert an unavailable live run into a quality pass.
- [ ] Stop at MVP; optional backlog work requires a new request.

## Out of Scope

Authentication/public deployment, cloud, advanced retrieval/indexing, queues, OCR, provider framework, new dashboards/features, invented evaluation scores.

## Verification Commands

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm eval:offline
pnpm build
docker compose up --build
```

Optional explicit paid command after configuring its caps/pricing/credentials:

```bash
pnpm eval:live
```

Record actual invocations, configuration, observed outcomes and any blocked checks. The list itself is not completion evidence.

## Demo Scenario

Run the [six documented scenarios](../../product/demo-scenarios.md) with the synthetic corpus. Present actual evaluation records, known limitations, and passing deterministic checks. Demonstrate source inspection and deletion, and state clearly that unauthenticated public exposure remains outside the MVP.
