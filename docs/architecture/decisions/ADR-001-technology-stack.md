# ADR-001 — Technology Stack

## Status

Accepted for planning, 2026-11-16. No application packages installed; S00 verifies stable versions and pins a compatible set. Existing agent tooling does not establish application version choices.

## Context

The project should demonstrate backend, frontend, database, and AI engineering while remaining feasible for one developer. A shared language helps maintain API contracts. Avoid infrastructure that does not directly support the local MVP.

## Decision

Use pnpm workspaces with `apps/api`, `apps/web`, and `packages/shared`. NestJS provides explicit modules, dependency injection, transport validation, and testable services. Next.js/React supplies the two small product screens and a same-origin API proxy. TypeScript is strict; Zod defines browser-safe public contracts. TanStack Query owns remote state; React Hook Form handles form state. Use Tailwind/shadcn/ui for restrained accessible presentation.

PostgreSQL stores relational metadata, extracted content, and pgvector embeddings. Prisma manages relational persistence and migrations, with a focused SQL boundary for vector operations. OpenAI is the only MVP AI provider, behind two small capability interfaces. Jest covers deterministic backend logic; Docker Compose provides reproducible local services.

Select maintained PDF/tokenizer libraries during S03 after compatibility/fixture checks. Choose the generation model during S05 after checking stable availability and structured-output/context/output capabilities. Do not invent versions or build a provider framework. See [system overview](../system-overview.md) for boundaries and planned configuration.

## Alternatives considered

- Express/Fastify directly: fewer conventions but more architecture decisions for subsequent agents; NestJS is selected for explicit module ownership.
- A single full-stack Next.js service: fewer processes but less clear backend responsibility for this portfolio's backend emphasis.
- Python AI backend: strong ecosystem but adds a second language/runtime without a demonstrated MVP need.
- External vector database: useful at some scales, but adds operations and cross-store consistency work.
- A heavy AI orchestration framework: unnecessary for one embedding/search/generation pipeline.

## Consequences

Two application processes add local configuration and proxy testing, but keep UI/business logic separated. Prisma does not remove the need to understand pgvector SQL or major-version API differences. One provider simplifies delivery but exposes provider availability/privacy/cost trade-offs. Shared contracts must remain independent of backend infrastructure. Authentication, cloud deployment, queues, and extra packages remain future work until justified.
