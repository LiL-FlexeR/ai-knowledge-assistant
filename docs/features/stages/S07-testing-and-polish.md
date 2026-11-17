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

- [x] Add redistributable fixture documents, logical gold spans, all twelve cases and harness/config/report formats.
- [x] Add `eval:offline` and opt-in `eval:live`; implement usage/cost/case/deadline caps and reproducibility metadata.
- [x] Audit lifecycle/vector/API/browser coverage and fix demonstrated critical gaps within existing MVP scope.
- [x] Run fresh-install/empty-database/Compose setup and all documented demo scenarios; record actual observations.
- [x] Review module boundaries, safe file/SQL/provider handling, grounding/injection limitations and public exposure defaults.
- [x] Synchronize README/product/architecture/contracts/stages and completion evidence; disclose remaining limitations and live-evaluation status.

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

- [x] Required deterministic suites pass and fresh documented setup works on the recorded environment.
- [x] E01–E12 have gold evidence/outcomes and offline mechanics checks; live status/settings/results are recorded honestly.
- [x] Every curated live answer that was run has source-support review; remaining quality failures are listed, not hidden by averages.
- [x] No known unresolved invalid-citation, secret-disclosure, or critical lifecycle defect remains; documentation matches implementation and local-only limits.

## Definition of Done

- [x] Link verification evidence to MVP success criteria and record exact commands/results/unavailable checks/remaining limitations.
- [x] Mark S07 and other roadmap items complete only when their own criteria hold; do not convert an unavailable live run into a quality pass.
- [x] Stop at MVP; optional backlog work requires a new request.

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

## Verification evidence

Verified on 2026-11-17, Linux 7.0.0-43-generic, Node 24.22.3, pnpm 12.21.0,
Docker Engine 29.5.3 / Compose 5.1.4, Chromium at 1440×1000 and 390×844.
The host defaults (Node 24.16.0 / pnpm 11.25.0) did not meet the pinned engines;
commands used `PATH=/tmp/aka-s07-toolchain/node_modules/.bin:$PATH` after installing
the already-selected exact versions there. No dependency/version/migration or
public endpoint change was needed; the lockfile remains unchanged.

| Command/check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass on the pinned toolchain; also 912 packages installed into an empty temporary workspace by `pnpm verify:setup` |
| `pnpm db:generate`, `pnpm db:migrate` | Pass inside owned harness runs; initial migration from empty followed by a no-op redeploy, read-only introspection and clean before/after schema diffs |
| `pnpm lint` | Pass: ESLint zero warnings, Prettier |
| `pnpm typecheck` | Pass: API/shared/web, Next routes and DOM-only shared boundary |
| `pnpm test` | Pass: 9 script checks (6 evaluation, 3 target-ownership), 231 API tests in 11 suites, 12 frontend/client/proxy tests; generated OpenAPI matches shared contracts |
| `pnpm test:integration` | Pass: 71 tests in five suites on real PostgreSQL/pgvector; document and ingestion/search curl demos pass |
| `pnpm test:e2e` | Pass: 10 Chromium cases across both viewports; production Next.js, real Nest API and fake AI; public bundle secret-canary scan passes (16 assets) |
| `pnpm eval:offline` | Pass: E01–E12 and six additional regressions, four original fixture files/six indexed chunks; 36 bounded fake-provider boundary calls, zero paid calls |
| `pnpm build` | Pass: all workspaces and production web routes |
| `pnpm verify:setup` | Pass: fresh frozen install; isolated `docker compose up -d --wait db`, explicit `--profile tools run --rm --build migrate`, `up --build -d --wait`, health/readiness, both pages, loopback bindings and API restart; `down` removes owned containers/network |
| `pnpm eval:live` | **Not run**: preflight rejected missing explicit paid opt-in (`PAID_OPT_IN_REQUIRED`), exit 1 before any provider call/database setup; no live settings/credentials were supplied |
| Impeccable source detector | `impeccable detect apps/web/app apps/web/components --json`: `[]`; desktop/narrow screenshots manually inspected against the existing S06 direction |
| Relative links / `git diff --check` | Pass; affected file links resolve and no whitespace errors |

Socket-based unit tests and Next subprocess builds initially failed with sandbox
EPERM restrictions; reruns with the necessary execution permissions passed. The
first Compose verifier completed build/health but reused an HTTP socket closed
by restart; its GET probe now closes connections and the full verifier passed
again. These failed attempts are not counted as passes. There is only one
committed migration, so a distinct earlier migration version is N/A; repeat
deployment against the existing migrated schema and custom vector/catalog checks
passed. No retained user database or volumes were reset.

### Evaluation records

- [Offline synthetic report](../../../apps/api/evaluation/reports/offline-2026-11-17.json)
- [Live not-run record](../../../apps/api/evaluation/reports/live-2026-11-17.json)
- [Reproduction, caps, schemas and human review](../../../apps/api/evaluation/README.md)

The offline report records complete gold-span coverage 10/10 (multi-span 4/4),
emitted citation identity 10/10, scripted missing-evidence abstention 2/2 and false
abstention 0/8. These are **fake-provider mechanics**, not real retrieval or answer
quality. Human retrieval precision, citation support and groundedness are N/A
(0/0); no curated live answer ran or awaits review. E09/E10/E11/E12 preserve
individual rubrics and scripted statuses, without claiming model resistance to
ambiguity, conflict or injection. The report saves corpus/harness hashes, logical
and resolved gold spans, source maps, scores, admitted evidence, statements,
citations and usage/settings. Live reports require independent source-support
review; the import validates the source-report hash and complete chunk/claim/pair
labels while retaining negative judgments.

### Regression and review conclusions

The existing owning-stage suites were rerun rather than replaced. They verify
atomic publication/rollback, reprocess invalidation, restart recovery, deletion
compensation, stale generation fencing, exact vector order/profile/run/document
filters, PDF physical pages, canonical source spans, invalid model citations,
provider errors/deadlines, local Host/Origin controls and safe browser rendering.
The browser fixture's 409 code was corrected from `EVIDENCE_CHANGED` to the actual
`DOCUMENT_CHANGED` contract. No unresolved critical lifecycle, invalid-citation,
secret-disclosure, module-boundary or public-exposure defect was found in the
reviewed scope. This is bounded evidence, not a universal security guarantee.

The two-screen UI retains its S06 Operate direction. Four fresh screenshots
(Documents/Ask, desktop/narrow) were inspected: visible local/OpenAI disclosures,
readable source excerpts, visible focus and no overlap/overflow. Browser assertions
cover keyboard focus/confirmations, polling pause, explicit retries, hostile HTML
escaped as text, proxy bounds and CSP. No product UI redesign was needed.

`evaluation/` is test-only and not imported into production modules. HTTP uploads
use generated private paths; parameterized pgvector SQL remains in VectorReader;
production controllers/contracts and focused persistence boundaries are unchanged.
No schema push, new service, auth, queue or retrieval algorithm was introduced.
Live evaluation uses the production adapters with zero retries and reserves cost
before every batch/generation call; missing usage/caps fail visibly with partial
results. Pricing sources/date and estimated-vs-known usage are explicit. Responses
still have no tools/history and `store:false`; this is not a retention guarantee.

### Success criteria and remaining limitations

[SC-01–SC-10](../../product/success-criteria.md) now link these checks: fresh setup;
private PDF/TXT/Markdown upload and safe validation; source-aware ingestion and
failed/scanned handling; real vector filters; grounded response/citation contracts;
two-screen workflow; lifecycle compensation/fencing; deterministic regression;
evaluation/reporting; and honest local-only documentation/demo.

Live semantic relevance, factual support, real ambiguity/conflict handling,
injection resistance and cutoff calibration remain unmeasured. No paid account
access was checked. The six [demo scenarios](../../product/demo-scenarios.md) have
deterministic evidence and explicitly separate live targets. Other browser engines,
public deployment/authentication, OCR and full hostile-PDF isolation remain outside
the MVP. S07 is complete under its explicit optional-live rule; this is not a live
quality pass or a claim that the optional backlog is implemented.

Changed files: `apps/api/evaluation/` corpus/fixtures, harness/config/report/review
formats and synthetic records; `scripts/evaluation.test.mjs`, `verify-setup.mjs`
and the reused integration launcher; root commands/ignore rules; the browser 409
fixture; README, affected product/architecture documentation, AGENTS and roadmap.

## Demo Scenario

Run the [six documented scenarios](../../product/demo-scenarios.md) with the synthetic corpus. Present actual evaluation records, known limitations, and passing deterministic checks. Demonstrate source inspection and deletion, and state clearly that unauthenticated public exposure remains outside the MVP.
