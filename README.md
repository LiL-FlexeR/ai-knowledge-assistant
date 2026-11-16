# AI Knowledge Assistant

A planned document question-answering application using Retrieval-Augmented Generation (RAG). Upload PDF, TXT, or Markdown files, search their content, and ask questions with references to the supporting passages.

**Status: documentation and agent tooling foundation.** There is no implemented application, application workspace, migration, or runnable Docker configuration yet. The existing `package.json` and `package-lock.json` provide auxiliary Playwright CLI tooling. All application features and development commands below are planned; all implementation stages remain unchecked.

## Problem and planned features

General chatbots lack access to a user's local documents and can provide unsupported answers. This project will retrieve passages from uploaded documents and use them as evidence, with explicit insufficient-information responses. Citations make sources inspectable; they do not guarantee factual correctness.

- Upload and validate text-based PDFs, UTF-8 TXT, and Markdown.
- Track pending, processing, ready, failed, and deleting states.
- Extract, normalize, chunk, and embed content with preserved locations.
- Search documents using PostgreSQL/pgvector.
- Ask grounded questions with page or section references and source excerpts.
- Delete original files, extracted content, chunks, and vectors.

The unauthenticated MVP must run locally and must not be exposed publicly. Uploaded text and questions will be sent to OpenAI when AI features are used; use synthetic or permitted data.

## Technology stack

| Area | Planned technology |
| --- | --- |
| Backend | Node.js, strict TypeScript, NestJS, Prisma, Zod, Jest |
| Data | PostgreSQL with pgvector; local originals on a Docker volume |
| AI | OpenAI embeddings and grounded structured generation |
| Frontend | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui |
| Client state/forms | TanStack Query, React Hook Form, Zod |
| Development | pnpm workspaces, Docker Compose |

S00 will verify compatible current stable releases and pin them. No package versions are prescribed by this planning exercise.

## Architecture and RAG workflow

A modular NestJS API owns document lifecycle, ingestion, retrieval, and question answering. Next.js calls its REST API through a same-origin `/api` proxy. One PostgreSQL database holds metadata, extracted content, and vectors; no external vector service or Redis is required.

```text
Upload → validation → local original + pending metadata
       → bounded ingestion → extraction → normalization → chunks
       → OpenAI embeddings → atomic pgvector publication → ready

Question → query embedding → cosine search over ready chunks
         → bounded context → grounded generation → validated citations
```

See [architecture](docs/architecture/README.md), [API contracts](docs/architecture/api-contracts.md), and [RAG pipeline](docs/architecture/rag-pipeline.md).

## Repository structure

Current documentation lives in `docs/` and root `AGENTS.md`; installed project-local skills live in [.agents/skills](.agents/skills/). S00 will add the application workspaces to this structure:

```text
apps/                  # Planned in S00
  api/                 # NestJS API; Prisma schema/migrations live here
  web/                 # Next.js UI
packages/              # Planned in S00
  shared/              # Public DTO schemas/types only
docs/
  architecture/        # Contracts, lifecycle, RAG, security, testing, ADRs
  product/             # Vision, requirements, stories, scope, demo
  features/
    ROADMAP.md
    stages/            # Eight executable specifications
.agents/skills/        # Installed project workflows and technology skills
```

## Agent skills

The 15 installed skills include four project workflows: [implement-roadmap-stage](.agents/skills/implement-roadmap-stage/SKILL.md), [architecture-review](.agents/skills/architecture-review/SKILL.md), [rag-quality-check](.agents/skills/rag-quality-check/SKILL.md), and [documentation-sync](.agents/skills/documentation-sync/SKILL.md). Two design skills complement them: [refero-design](.agents/skills/refero-design/SKILL.md) researches references and establishes the visual direction; [impeccable](.agents/skills/impeccable/SKILL.md) supports UI planning, implementation, critique, and refinement within that direction. The other nine cover NestJS, PostgreSQL, Prisma, Docker builds/Compose, React/Next.js, shadcn/ui, UI review, and browser verification.

Follow the [skill selection and precedence rules](AGENTS.md#agent-skills): read the matching `SKILL.md` and combine the relevant workflow, design, and technology guidance without expanding the requested stage. Installing a skill does not install the corresponding application framework or implement a feature. Skills CLI-managed source revisions, including Refero, are tracked in [skills-lock.json](skills-lock.json). Impeccable is installed locally and declares its version in its skill metadata, but is not recorded in that lockfile. Playwright CLI is provided separately by [package.json](package.json).

## Planned local setup

These instructions become usable as S00/S01 deliver tooling; full AI and UI flows require S03–S06. S00 must document exact prerequisites and environment loading for the selected versions.

1. Install the verified Node.js LTS release, pinned pnpm, and Docker with Compose.
2. Copy the future root `.env.example` to `.env`; supply local database credentials and, from S03 onward, a server-only OpenAI key.
3. Run `pnpm install --frozen-lockfile` after the workspace exists.
4. Run `pnpm infra:up`, then `pnpm db:migrate`, then `pnpm dev` for host development.
5. Alternatively run `docker compose up --build` after S01 for the API/web/database containers, with S06 supplying the UI.

Host development will use database `127.0.0.1:5432`; the container API will use `db:5432`. The web UI will be at `http://localhost:3000`, the API at `http://localhost:3001/api`. Bind published ports to loopback. See [runtime topology](docs/architecture/system-context.md).

## Environment configuration

The [system overview](docs/architecture/system-overview.md) owns the complete planned configuration and defaults. Root `.env` is private and ignored; `.env.example` contains placeholders. `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `STORAGE_ROOT`, and the internal proxy target are server-only. No AI secret may use a `NEXT_PUBLIC_` prefix.

The embedding profile is initially `text-embedding-3-small`, 1,536 dimensions; generation model selection and tokenizer compatibility are verified during implementation. Changing an embedding profile requires coordinated schema/data migration, not just an environment edit.

## Planned development commands

| Command | Available from | Purpose |
| --- | --- | --- |
| `pnpm dev`, `pnpm build` | S00 | Run app shells; build workspaces |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | S00 | Deterministic quality checks |
| `pnpm infra:up`, `pnpm infra:down` | S01 | Start/stop local PostgreSQL; preserve volumes |
| `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:migrate:dev` | S01 | Generate client, apply/create migrations |
| `pnpm test:integration` | S01 | Isolated PostgreSQL/pgvector tests, expanded each stage |
| `pnpm test:e2e` | S06 | Mock-provider browser workflow checks |
| `pnpm eval:offline`, `pnpm eval:live` | S07 | Deterministic fixtures; explicit paid AI evaluation |

No command in this table is executable in the current documentation-only repository.

## Testing and evaluation

Unit tests cover validation, normalization, source-preserving chunking, context construction, and error handling. Integration tests use actual PostgreSQL/pgvector with deterministic AI fakes. API and browser tests cover uploads, processing, questions, and deletion. A synthetic evaluation set will measure retrieval relevance, citation validity, groundedness, abstention, ambiguity, conflicts, and document prompt injection. There are no measured scores yet. See [testing strategy](docs/architecture/testing-strategy.md).

## Roadmap and future work

Use the [primary execution roadmap](docs/features/ROADMAP.md): S00 setup → S01 infrastructure → S02 document management → S03 ingestion → S04 retrieval → S05 question answering → S06 frontend → S07 evaluation and polish. Each stage has its own dependencies, tests, acceptance criteria, and demo.

Authentication, deployment hardening, OCR, background queues, streaming, hybrid search, reranking, chat history, additional providers, versioning, S3 storage, and observability dashboards are optional [future work](docs/product/mvp-scope.md). They are not MVP infrastructure.

Start future development with **S00 — Project Setup**. Agents should first read [AGENTS.md](AGENTS.md).
# ai-knowledge-assistant
