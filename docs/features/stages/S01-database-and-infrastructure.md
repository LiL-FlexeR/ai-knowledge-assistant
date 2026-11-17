# Stage S01 — Database and Infrastructure

## Objective

Provide reproducible local services and technically verified Prisma/pgvector persistence for the documented data model.

## Context

Read [data model](../../architecture/data-model.md), [runtime context](../../architecture/system-context.md), [configuration](../../architecture/system-overview.md), [ADR-003](../../architecture/decisions/ADR-003-data-storage.md), and [testing strategy](../../architecture/testing-strategy.md). The raw-query API depends on the selected Prisma major; verify official documentation rather than copying legacy calls.

## Dependencies

S00 complete: workspace builds/checks, config loading and liveness exist. Stop if these prerequisites are missing. Docker/Compose and usable local ports must be available for runtime verification; report environmental blockers accurately.

## Scope

Database/config/health modules; complete two-entity base schema; custom vector migration; API/web/database Compose skeleton; private original-file volume; isolated integration harness. No document API or ingestion runner.

## Technical Requirements

Pin a compatible PostgreSQL/pgvector image and Prisma release after current stable compatibility checks. Create both Document and DocumentChunk with every field/constraint in [data model](../../architecture/data-model.md), including lifecycle/run/profile/source fields needed by later stages. The first migration enables `vector` before declaring `vector(1536) NOT NULL`. Use the verified Prisma schema mapping and parameterized SQL interface; no automatic native vector assumption.

Create Compose `db`, `api`, `web`, with database and originals volumes, dependency health checks, loopback-only published ports, and explicit migration operation. Host uses localhost database URL; containers use service DNS. Runtime credentials should have only necessary data privileges; extension/schema creation uses migration credentials. Configure a migration/shadow database only when required by the selected Prisma tooling. Preserve volumes on normal shutdown.

## Implementation Tasks

- [x] Add schema, initial reviewed/custom SQL migration, client generation, and API database lifecycle injection.
- [x] Prove parameterized insert/select of fixed-dimension vectors through the chosen Prisma interface; use a focused internal SQL adapter, not a search feature.
- [x] Add Dockerfiles/build setup and Compose services/health/volumes; document host/container environment overrides.
- [x] Add readiness checks for database/extension/dimension/profile configuration and storage writability without provider calls.
- [x] Create guarded isolated integration database/storage setup and root database/infrastructure scripts.

## Expected Files and Modules

`compose.yaml`, API/web Dockerfiles and appropriate ignore files; `apps/api/prisma/` schema/migrations (or verified Prisma-major equivalent documented in README); API database/config/health infrastructure; test Compose configuration/harness; environment examples and root scripts.

## API Contracts

Extend health with `GET /api/health/ready` and the [documented safe 200/503 contracts](../../architecture/api-contracts.md). AI configuration may be disabled in S01/S02. No paid health probes.

## Database Changes

Create complete Document/DocumentChunk schema, enum, keys/indexes, pgvector extension, and fixed vector dimension. No HNSW/IVFFlat index initially. Verify empty-database replay and schema/client regeneration preserve the custom vector type/SQL.

## Error Handling

Startup/config/readiness failures identify failed dependencies safely without credentials or full connection URLs. An unavailable database fails readiness but does not redefine liveness. Reject production-looking/non-test database targets before destructive test cleanup.

## Testing Requirements

Real PostgreSQL/pgvector tests: extension/type, row constraints, FK cascade/unique chunk index, vector dimension and cosine ordering with padded basis vectors, bound malicious-looking strings, and rollback. Test readiness failures and storage writability using controlled faults. Do not mock vector behavior or use SQLite.

## Acceptance Criteria

- [x] Compose starts the three local services and preserves data across normal restart.
- [x] Fresh migrations and client generation work; raw vector probe returns scalar fields without unsupported-type decoder errors.
- [x] Readiness passes healthy services and reports safe 503 for controlled faults; no AI calls occur.
- [x] Integration test cleanup affects only its owned isolated database/storage.

## Definition of Done

- [x] Required migration/runtime/integration evidence is recorded and README setup is reproducible for host and Compose modes.
- [x] Mark only verified S01 roadmap items; stop before S02.

## Out of Scope

Upload APIs, extractors, embedding calls, search, product UI, queues, cloud infrastructure, approximate indexes.

## Verification Commands

Create these scripts in this stage; run against isolated test/local data:

```bash
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm test:integration
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose up --build
curl -i http://localhost:3001/api/health/ready
pnpm infra:down
```

Also record a clean-database migration replay and volume-preserving restart. `db:migrate` applies committed migrations; `db:migrate:dev` creates reviewed development migrations. Do not use destructive volume removal on user data. Append outcomes on implementation.

## Demo Scenario

Start Compose, apply migrations, inspect readiness, run the vector integration probe, restart services, and verify persisted fixture data. No document upload is expected yet.

## Verification evidence

Historical stage snapshot. Later-stage status statements below describe this stage's verification time; see the [current roadmap](../ROADMAP.md) for S00–S07 completion and limits.

Completed 2026-11-16 on Linux with the repository's pinned Node.js **24.22.3** and pnpm **12.21.0**, installed under `/tmp/aka-s01-toolchain` for this session. S00 prerequisites were reverified before implementation: lint/typecheck/build and all 36 original tests passed. Sandbox socket/subprocess restrictions required approved execution outside the sandbox; Docker and package network access were also approved.

Selected PostgreSQL **18.7** / pgvector **0.8.7**, pinned by image digest, Prisma CLI/client/adapter **7.10.1**, and pg/types **8.23.1**. [ADR-003](../../architecture/decisions/ADR-003-data-storage.md#s01-implementation-and-compatibility) records official sources, the stable Prisma-7 choice over the version-8 release candidate, CommonJS generation, raw-query APIs, privilege separation, and the verified introspection limitation.

| Check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed with exact dependencies and committed lockfile; selected watcher/Prisma lifecycle scripts explicitly allowed |
| `pnpm infra:up` | Passed; only the local database started, healthy on loopback 5432; runtime role initialized on the new empty volume |
| `pnpm db:generate` | Passed; Prisma 7.10.1 generates the ignored CommonJS TypeScript client without needing credentials or reading private root `.env` |
| `pnpm db:migrate` | Passed against the new local database; committed extension-first SQL creates both entities, enum, constraints/indexes and runtime data grants |
| `docker compose --profile tools run --rm --build migrate` | Passed using container DNS `db:5432` and migration-only credentials; repeated deploy reported no pending migrations |
| `pnpm test:integration` | Passed: **10 real PostgreSQL/pgvector tests**, unique project/database/passwords/random loopback port, tmpfs data and temporary storage; fixtures and project cleaned after success and observed earlier failures |
| Clean migration replay/regeneration | Passed from fresh isolated database; second deploy is a no-op, read-only introspection recognizes unsupported vector, regenerated schema/client retain the reviewed mapping, relational drift checks report no difference before/after controlled faults; SQL independently verifies NOT NULL `vector(1536)` |
| `pnpm lint` | Passed, zero ESLint warnings and Prettier checks including Compose files; generated Prisma code excluded |
| `pnpm typecheck` | Passed strict API/tests/config, web, shared and DOM-only browser boundary compilation |
| `pnpm test` | Passed: **5 Jest suites / 51 tests**, plus **3 Node test-target guard tests**; no database/provider calls |
| `pnpm build` | Passed shared/API and optimized host Next shell; separate container build emits standalone web runtime |
| `docker compose up --build -d --wait` | Passed all three healthy services, API/web as non-root `node`; published ports only `127.0.0.1:5432`, `:3001`, `:3100` (web 3000 was already occupied by another project) |
| `curl -i http://localhost:3001/api/health/ready` | HTTP 200, shared envelope/request ID, database/storage/profile `ok`, AI `disabled`; web shell on localhost:3100 also HTTP 200 |
| Host compiled API smoke | HTTP 200 readiness on temporary loopback port 3011, runtime database URL at 127.0.0.1:5432 and default `<repo>/.local/documents`; probe cleaned; temporary host process stopped |
| Normal shutdown/recreation | Inserted an owned row/vector and API-volume original; `pnpm infra:down` then `docker compose up -d --wait` preserved all three; fixture subsequently removed using only its generated UUID/path |
| Controlled database outage | Stopped only this stack's database: readiness returned safe 503 `SERVICE_UNAVAILABLE` with `database` detail, liveness stayed 200; restarting database restored readiness |
| `pnpm infra:down` | Passed; owned services/network stopped, both named volumes retained; unrelated project containers untouched |
| Guard/privacy/document checks | External production-looking `TEST_DATABASE_URL` rejected before setup without echoing its value; web container has no database/provider credentials, private local passwords absent from web/shared build files, changed Markdown links/anchors and `git diff --check` passed |

Real integration coverage includes extension version/type, enum/defaults, timestamps, positive/nonnegative constraints, unique storage/chunk ordering, foreign key/cascade, fixed dimensions rejected at SQL independently of adapter validation, padded-basis cosine order, bound hostile-looking text/JSON/UUID values, scalar-only decoding, and metadata/vector transaction rollback. Runtime credentials can mutate entity data but cannot create/alter tables or read the migration ledger. Readiness faults cover actual extension removal and dimension changes with restoration, incompatible ready profiles, storage I/O failure, and safe errors; deterministic HTTP tests cover dependency exceptions/redaction while liveness remains healthy. AI is disabled and no provider SDK/call was added.

Prisma 7's read-only introspection omits vector dimensions and CHECK constraints. This is a documented tooling limitation, not an unverified schema: the reviewed schema/custom SQL are preserved and catalog, invalid-dimension and readiness checks establish actual behavior. `db:migrate:dev` creates reviewable SQL with `--create-only`; deploy never uses schema push or automatically applies migrations at API startup. Its interactive development/shadow workflow is documented; no speculative development migration was generated for S01.

Changed files: root Compose/test Compose, `.dockerignore`, API/web Dockerfiles and web container-output config; `infra/postgres/init-runtime.sh`; API Prisma schema/config/initial migration and generated-client ignore rules; database client/lifecycle/vector adapter, health/readiness/storage probe, safe HTTP mapper, shared readiness schemas; isolated harness/guard/database scripts and root commands/lockfile; API unit/HTTP/integration/Jest configuration. README, project context, affected product/architecture/testing/data-model/ADR notes, this specification and roadmap now distinguish verified S01 infrastructure from future behavior.

No required S01 check remains unavailable. Docker builds retain the existing optional Playwright skill notice and Jest its experimental VM-module warning. Private local credentials are in ignored `.env`; normal shutdown preserves initialized volumes. The same-origin proxy, document APIs, storage lifecycle/quotas, ingestion/publication, ready-filtered retrieval and all AI features remain unimplemented. Architecture review found no remaining S01 scope/module/contract violations. **S01 is complete; S02–S07 remain unchecked, and work stops before S02.**
