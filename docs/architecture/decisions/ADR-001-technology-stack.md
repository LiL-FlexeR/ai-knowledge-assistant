# ADR-001 — Technology Stack

## Status

Accepted, 2026-11-16. S00 implements the workspace and HTTP/app shells with the verified versions below. Database, AI, and product UI choices remain planned until their owning stages.

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

## S00 version verification

Verified on 2026-11-16 using the packages' npm release/engine/peer metadata and official support documentation. Exact direct pins live in workspace manifests; `pnpm-lock.yaml` owns transitive resolution.

| Component | Selected version | Compatibility decision |
| --- | --- | --- |
| Node.js | 24.22.3 LTS | Maintained LTS security release; use the latest patch on the mature 24 line, satisfying Nest/Jest's Node 24.9+ ESM requirement |
| pnpm | 12.21.0 | Current stable native manager; exact `packageManager` and runtime engines |
| NestJS common/core/platform-express/testing | 12.5.1 | Same release for all packages; Express adapter; CommonJS application with NodeNext resolution and native `require(esm)` |
| Next.js / React / React DOM | 16.4.6 / 19.3.1 / 19.3.1 | App Router; matching React/DOM and supported Node engines |
| TypeScript | 6.0.3 | Latest stable 6 release; TypeScript 7.0.2 exceeds typescript-eslint's `<6.1` and ts-jest's `<7` peer ranges |
| Zod | 4.6.7 | Browser-safe public contracts and API-only environment schema |
| Jest / ts-jest / Supertest | 30.5.2 / 29.4.15 / 7.3.2 | ts-jest supports Jest 30 and TypeScript 6; Jest runs with `--experimental-vm-modules` for Nest's ESM packages |
| ESLint / @eslint/js | 9.39.5 / 9.39.5 | Newest 9 release; ESLint 10.15.0 fails official Next lint plugins' peer ranges. Upstream marks ESLint 9 deprecated; retain this compatible pin until those peers support 10 |
| typescript-eslint / eslint-config-next | 8.73.0 / 16.4.6 | Flat config; project-aware TypeScript rules and Next web rules |
| Prettier / concurrently | 3.10.1 / 10.0.7 | Formatting and coordinated dev process shutdown; Node 24 satisfies both |
| reflect-metadata / RxJS | 0.2.2 / 7.8.2 | Required Nest runtime peers |
| Playwright CLI | 0.1.24 | Preserve and exactly pin existing auxiliary tooling; no product E2E scope added |

Type declarations are pinned in manifests, including Node 24.19.2 and React/DOM 19.3.0. Strict peer checks remain enabled. pnpm's generated release-age exceptions cover the explicitly selected Nest and typescript-eslint releases; only `@parcel/watcher` dependency builds are allowed. `verifyDepsBeforeRun: false` keeps quality commands from implicitly installing packages; installation is explicit.

Sources: [Node release](https://nodejs.org/en/blog/release/v24.22.3), [Node support](https://nodejs.org/en/about/previous-releases), [pnpm installation](https://pnpm.io/installation), [Nest 12 migration/runtime guidance](https://docs.nestjs.com/migration-guide), [Next installation](https://nextjs.org/docs/app/getting-started/installation), [typescript-eslint support](https://typescript-eslint.io/users/dependency-versions/), [Jest ESM support](https://jestjs.io/docs/ecmascript-modules). Adapter peer ranges were checked with `npm view` and verified by strict installation plus the recorded S00 checks. Prisma, PostgreSQL/pgvector, parsers, tokenizer, and AI model/provider capability verification remain assigned to S01/S03/S05.
