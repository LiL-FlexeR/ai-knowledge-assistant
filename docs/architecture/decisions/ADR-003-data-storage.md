# ADR-003 — Data Storage

## Status

Accepted for planning, 2026-11-16. Schema/migrations are specified but not created.

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
