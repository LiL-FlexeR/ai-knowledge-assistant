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

- [ ] Add schema, initial reviewed/custom SQL migration, client generation, and API database lifecycle injection.
- [ ] Prove parameterized insert/select of fixed-dimension vectors through the chosen Prisma interface; use a focused internal SQL adapter, not a search feature.
- [ ] Add Dockerfiles/build setup and Compose services/health/volumes; document host/container environment overrides.
- [ ] Add readiness checks for database/extension/dimension/profile configuration and storage writability without provider calls.
- [ ] Create guarded isolated integration database/storage setup and root database/infrastructure scripts.

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

- [ ] Compose starts the three local services and preserves data across normal restart.
- [ ] Fresh migrations and client generation work; raw vector probe returns scalar fields without unsupported-type decoder errors.
- [ ] Readiness passes healthy services and reports safe 503 for controlled faults; no AI calls occur.
- [ ] Integration test cleanup affects only its owned isolated database/storage.

## Definition of Done

- [ ] Required migration/runtime/integration evidence is recorded and README setup is reproducible for host and Compose modes.
- [ ] Mark only verified S01 roadmap items; stop before S02.

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
