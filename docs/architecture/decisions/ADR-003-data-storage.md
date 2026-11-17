# ADR-003 — Data Storage

## Status

Accepted, 2026-11-16. S01 implements and verifies the base schema, migrations, infrastructure primitives, and readiness. S02 implements private original storage, quota admission and compensated document deletion using that schema. S03 implements claims, complete generation publication, restart recovery and manual reprocessing using the existing schema; no migration was needed.

## Context

Metadata, source text, vectors, and original files need a consistent lifecycle without a separate vector service. A small local corpus does not justify cloud object storage or a durable job platform.

## Decision

Use PostgreSQL with pgvector for two entities: Document and DocumentChunk. Store original files in an API-only local volume using generated relative paths; store normalized text/source maps in Document and exact source spans/vectors in chunks. Enforce relational keys, cascade deletion, unique chunk order, and reviewed SQL migrations. Begin with exact cosine search; defer HNSW until corpus measurements justify approximate indexing.

Use Prisma for ordinary data and its version-appropriate parameterized SQL boundary for required vector writes/search. Migrations explicitly create the extension and fixed-dimension vector column. Do not assume native Prisma vector CRUD or expose raw vectors through DTOs. [Data model](../data-model.md) owns the intended integration and compatibility procedure.

Track pending/processing/ready/failed/deleting states. Persist pending rows as the single runner's work ledger. Publish a complete chunk generation atomically; fence stale work with a run UUID. Reprocessing clears the old index and rebuilds from the original. Deletion first hides indexed data, then unlinks files, then removes metadata; retries/startup reconciliation handle filesystem/database partial failure. No version-history entity or job table.

## Alternatives considered

- External vector database: separates vector scaling but adds a service and distributed cleanup/consistency concerns.
- Store files in database: stronger transactional file retention but larger database/backup footprint without an MVP benefit.
- S3-compatible object storage: useful for cloud deployment; adds credentials/service setup to a local-only project.
- Redis/BullMQ: provides worker scheduling and retry tooling; deferred until bounded single-process ingestion proves inadequate.

## Consequences

One database keeps vectors and relational deletes transactionally aligned. Local file storage is easy to inspect but tied to one machine/API instance, with separate backup/cleanup needs. Filesystem and PostgreSQL cannot commit atomically, so compensating cleanup and orphan reconciliation are explicit work. Fixed dimensions and profile compatibility require coordinated migrations/reindexing. Logical deletion cannot guarantee removal from backups or physical media.

## S01 implementation and compatibility

Verified on 2026-11-16 against official npm metadata and upstream documentation. Select the stable **Prisma 7.10.1** CLI, client, and PostgreSQL adapter, with **pg 8.23.1** and its **8.23.1** types. The [Prisma release status](https://www.prisma.io/docs/orm/release-status) identifies Prisma 8 as a release candidate; S01 requires a stable release, so the generic setup skill's version-8 default does not apply. The selected Prisma packages support Node 24 and TypeScript 6 on this repository's pinned toolchain. No existing Prisma major was upgraded.

Use the `prisma-client` generator with an explicit ignored TypeScript output and CommonJS module format. Configure migration URLs in `prisma.config.ts` and initialize the runtime with `PrismaPg`. [Prisma 7 raw queries](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries) support tagged `$executeRaw`/`$queryRaw` and interactive transaction handles. Vector values and JSON/UUID/text parameters are bound, never interpolated into SQL syntax. Scalar-only results avoid the unsupported vector decoder. The nonzero finite float32-compatible vector boundary and real transaction/ordering probes are verified.

Pin `pgvector/pgvector:0.8.7-pg18-bookworm` to `sha256:38681dc6eaf55308e2a4c6de392d131652dcfac70e1263e35cd9b5ea3fe39782`, observed as **PostgreSQL 18.7 / pgvector 0.8.7**. [Upstream pgvector](https://github.com/pgvector/pgvector) publishes this tag and defines cosine distance. Node's `24.22.3-bookworm-slim` image is also digest-pinned. PostgreSQL 18 data mounts at `/var/lib/postgresql`; both data and private originals use named volumes. The API and web run as non-root users with loopback-only published ports. Explicit migrations use a separate CLI image/profile, not API startup.

The empty-volume bootstrap creates `aka_runtime` without superuser, role/database creation, or schema ownership. Migration SQL grants only SELECT/INSERT/UPDATE/DELETE on the two entity tables; the runtime cannot read `_prisma_migrations` or alter schema. The local migration/initialization account is privileged to install the non-native extension and is never supplied to the API container. Password rotation for an existing volume is an explicit maintenance operation, not an environment-file edit.

Prisma 7 accepts the reviewed `Unsupported("vector(1536)")` mapping but introspection prints `Unsupported("vector")` and omits dimensions. It also does not model CHECK constraints. Keep read-only introspection separate from the committed schema. A Prisma diff is useful for relational drift but cannot prove dimension preservation; SQL catalog/readiness and real invalid-dimension tests do. Regeneration does not rewrite the custom migration or schema. Future migrations must preserve extension order, constraints, privileges, and vector dimensions explicitly. [S01 evidence](../../features/stages/S01-database-and-infrastructure.md#verification-evidence) records the checks.
