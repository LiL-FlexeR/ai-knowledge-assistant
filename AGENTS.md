# AI Knowledge Assistant: agent instructions

## Project Context

This repository currently contains a design foundation, not an implemented application. The target is a local, single-user document RAG application: NestJS/TypeScript API, Next.js/React UI, Prisma, PostgreSQL/pgvector, OpenAI, and a pnpm monorepo. Do not claim planned behavior is implemented.

## Documentation Priority

Before implementation, read only relevant material, in this order:

1. [Product scope and requirements](docs/product/README.md).
2. [Architecture](docs/architecture/README.md), especially the API, data model, and relevant ADRs.
3. [Roadmap](docs/features/ROADMAP.md).
4. The requested [stage specification](docs/features/stages/S00-project-setup.md).

The API contracts own public DTOs; the data model owns persistence and lifecycle; the RAG pipeline owns retrieval and generation settings. Resolve conflicts explicitly in affected documents before changing behavior. Record material architectural changes in an ADR.

## Development Principles

- Follow the modular architecture and existing conventions. Keep controllers thin and functions focused.
- Use strict TypeScript, explicit errors, dependency injection, and simple, maintainable solutions.
- Avoid premature abstractions, generic repositories, unnecessary dependencies, and unrelated functionality.
- Verify stable package versions, Node compatibility, Prisma APIs, and provider capabilities during implementation; pin the selected versions and commit the lockfile.
- Never hardcode credentials or expose provider keys to the browser.
- Keep the unauthenticated MVP local. Authentication and public deployment are separate future work.

## Testing

- Test meaningful business rules, failure paths, and modified behavior.
- Mock AI in deterministic tests; use real PostgreSQL/pgvector for vector integration tests.
- Run stage verification and relevant checks when available. Report commands, results, and checks that could not run.
- Live AI evaluation is an explicit, cost-bearing command, never an implicit prerequisite for normal tests.

## Database

- Use reviewed migrations; do not make undocumented manual schema changes or use schema push as a migration substitute.
- Preserve transactions, foreign keys, and lifecycle invariants. Parameterize raw SQL.
- Document model, dimension, and pipeline changes; never mix incompatible vector spaces.

## Documentation

Update only affected requirements, contracts, architecture, stage documents, and README when behavior changes. Keep relative links valid. Do not mark unimplemented work complete.

## Roadmap Execution

For a requested stage: read its specification and relevant architecture, verify dependencies, implement only that stage, add required tests, run verification, update its roadmap checkboxes with evidence, and report the result. If a prerequisite is missing, stop dependent work and report the gap. Do not invent earlier-stage functionality or automatically proceed to the next stage.

## Agent Skills

Project-local skills are installed in [.agents/skills](.agents/skills/). Before starting a matching task, read the relevant `SKILL.md` and only the references needed for that task. Combine a workflow skill with the applicable technology skills; a workflow does not replace framework or database guidance.

| Skill | When to use |
| --- | --- |
| [implement-roadmap-stage](.agents/skills/implement-roadmap-stage/SKILL.md) | Execute one explicitly requested S00–S07 stage, verify its prerequisites and deliverables, and record evidence. |
| [architecture-review](.agents/skills/architecture-review/SKILL.md) | Review proposed or implemented changes against module boundaries, contracts, lifecycle, security, and ADRs. |
| [rag-quality-check](.agents/skills/rag-quality-check/SKILL.md) | Review ingestion, retrieval, grounding, citations, or evaluation changes. |
| [documentation-sync](.agents/skills/documentation-sync/SKILL.md) | Synchronize affected documentation after an implemented or explicitly proposed change. |
| [nestjs-best-practices](.agents/skills/nestjs-best-practices/SKILL.md) | Write, test, review, debug, or refactor NestJS code, including while following another workflow. |
| [supabase-postgres-best-practices](.agents/skills/supabase-postgres-best-practices/SKILL.md) | Before authoring database schemas, migrations, SQL, or pgvector operations; also for database diagnostics. Applies to the local PostgreSQL database without adopting Supabase services. |
| [prisma-orm-setup](.agents/skills/prisma-orm-setup/SKILL.md) | Set up Prisma or diagnose its connection. Verify the selected version and load its version-matched guidance; preserve existing major versions unless an upgrade is requested. |
| [docker-build-strategies](.agents/skills/docker-build-strategies/SKILL.md) | Write, review, or optimize Dockerfiles and image builds. |
| [docker-compose-patterns](.agents/skills/docker-compose-patterns/SKILL.md) | Create, modify, or debug Compose services, health checks, volumes, networking, or development overrides. |
| [refero-design](.agents/skills/refero-design/SKILL.md) | Research UI references and lock the visual direction before design or visual implementation. Use Refero MCP when available; otherwise use bundled craft and user-provided references. |
| [impeccable](.agents/skills/impeccable/SKILL.md) | Plan, build, critique, audit, or refine a frontend interface within the selected direction, including typography, layout, UX copy, accessibility, and responsive behavior. |
| [vercel-react-best-practices](.agents/skills/vercel-react-best-practices/SKILL.md) | Write, review, or refactor React/Next.js code and data fetching. |
| [shadcn](.agents/skills/shadcn/SKILL.md) | Add, compose, customize, or troubleshoot shadcn/ui components. |
| [web-design-guidelines](.agents/skills/web-design-guidelines/SKILL.md) | Review UI accessibility, keyboard interaction, responsive behavior, forms, and UX. |
| [playwright-cli](.agents/skills/playwright-cli/SKILL.md) | Inspect browser flows and work with Playwright tests; browser inspection alone does not replace the required deterministic E2E suite. |

For UI work, primarily S06 implementation and S07 review, use Refero for reference research and the visual direction; use Impeccable for the requested design/build/refinement workflow within that direction. Apply React and shadcn guidance to implementation, web-design-guidelines to UI review, and Playwright to browser verification. Documents and Ask AI are task-oriented app screens: use Impeccable's `Operate` mode and preserve S06's simple, accessible two-screen scope. Documentation maintenance and backend work do not start a design workflow.

The existing product and architecture documents remain authoritative. If a requested UI workflow creates `PRODUCT.md` or `DESIGN.md`, align those records with the canonical documents instead of redefining product scope, API contracts, persistence, or RAG behavior.

These project instructions and the canonical product/architecture documents take precedence over generic skill examples. Keep TanStack Query, reviewed migrations, focused persistence boundaries, and the local MVP scope; do not introduce SWR, generic repositories, schema push, hosted database services, authentication, or extra infrastructure merely because a skill illustrates them. Verify stable package compatibility before adopting a skill's version defaults.

Upstream skills may reference optional companion skills that are not installed. Load only those required by the requested task, and report a missing prerequisite before dependent work. Source revisions for Skills CLI-managed installs, including Refero, are recorded in [skills-lock.json](skills-lock.json). Impeccable is installed locally but has no entry in that lockfile; its installed version is declared in its `SKILL.md` metadata. Playwright CLI is supplied by the existing [tooling package](package.json). Installed skills and agent tooling do not mark any application stage complete.

## Communication

At completion report implemented functionality, changed files, tests executed or unavailable, remaining issues, and roadmap status. Separate proposed work from verified behavior.
