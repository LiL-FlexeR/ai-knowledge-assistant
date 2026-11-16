# AI Knowledge Assistant

A planned document question-answering application using Retrieval-Augmented Generation (RAG). Upload PDF, TXT, or Markdown files, search their content, and ask questions with references to the supporting passages.

**Status: S00 — Project Setup implemented and verified.** The pnpm workspace runs a NestJS liveness API and a minimal Next.js shell. Configuration validation, safe error envelopes, browser-safe shared schemas, and quality commands are implemented. Database/Compose, document management, retrieval, AI, and product screens remain planned in S01–S07. See [S00 verification evidence](docs/features/stages/S00-project-setup.md#verification-evidence).

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

| Area | Selected technology (later capabilities remain planned) |
| --- | --- |
| Backend | Node.js, strict TypeScript, NestJS, Prisma, Zod, Jest |
| Data | PostgreSQL with pgvector; local originals on a Docker volume |
| AI | OpenAI embeddings and grounded structured generation |
| Frontend | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui |
| Client state/forms | TanStack Query, React Hook Form, Zod |
| Development | pnpm workspaces, Docker Compose |

S00 pins Node.js 24.22.3 LTS, pnpm 12.21.0, NestJS 12.5.1, Next.js 16.4.6, React 19.3.1, TypeScript 6.0.3, Zod 4.6.7, and Jest 30.5.2. TypeScript 6 and ESLint 9.39.5 are selected for current adapter/plugin compatibility. [ADR-001](docs/architecture/decisions/ADR-001-technology-stack.md#s00-version-verification) records sources, adapters, and version decisions. All direct dependencies are exact and transitive dependencies are locked in `pnpm-lock.yaml`.

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

Documentation lives in `docs/` and root `AGENTS.md`; installed project-local skills live in [.agents/skills](.agents/skills/). The application workspaces are:

```text
apps/
  api/                 # NestJS liveness/config/HTTP foundation; Prisma planned S01
  web/                 # Next.js App Router setup shell; product screens planned S06
packages/
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

## Local setup

Install Node.js **24.22.3** (also recorded in `.node-version`) and pnpm **12.21.0**. For example, after selecting Node with your runtime manager, install pnpm with `npm install --global pnpm@12.21.0`. Docker, database credentials, and an OpenAI key are unnecessary for S00.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Copying `.env.example` is optional for S00; its blank database/AI placeholders are valid. Open `http://localhost:3000` and call `curl -i http://localhost:3001/api/health`. Liveness returns `{"data":{"status":"ok"},"requestId":"<generated UUID>"}` with the same ID in `X-Request-Id`. Unknown routes, including readiness, return a safe 404 envelope. Both servers bind to `127.0.0.1`. Stop development with Ctrl-C; the process runner stops sibling watchers when a command exits.

If web port 3000 is occupied, run `PORT=3100 WEB_ORIGIN=http://localhost:3100 pnpm dev` (or set these in root `.env`), then open `http://localhost:3100`. `API_PORT` overrides API port 3001. Root environment loading uses the launcher's file location, including when running `pnpm --filter @aka/api dev` or `pnpm --filter @aka/web dev`; exported shell variables take precedence. After installation, root `pnpm dev` builds shared contracts before starting watchers. For an individual app, run `pnpm --filter @aka/shared build` first.

After `pnpm build`, `pnpm --filter @aka/api start` and `pnpm --filter @aka/web start` run the compiled shells. pnpm scripts enforce the pinned Node runtime. pnpm dependency-script execution is explicitly limited to the selected native watcher; its optional Playwright agent-skill approval notice does not block installation or the already installed project skills.

**Planned from S01:** Docker Compose, `pnpm infra:up`, migrations, database readiness, and container runtime. Host database connections will use `127.0.0.1:5432`; container API connections will use `db:5432`. See [runtime topology](docs/architecture/system-context.md). No database/AI operation is available yet.

## Environment configuration

The [system overview](docs/architecture/system-overview.md) owns configuration defaults. API validation is implemented for the listed settings, including integer/range bounds, overlap smaller than chunk size, absolute storage paths, and local web origins. Blank optional database/AI values are treated as absent; S00 never connects to these services or creates storage. Future feature stages add their required settings and runtime compatibility checks. Invalid settings fail startup with variable names and no values. In S00, `NEXT_PUBLIC_*` configuration is unsupported and rejected by the API.

Root `.env` is private and ignored; `.env.example` contains placeholders. The API and web dev/start scripts explicitly load it, with shell variables taking precedence. Quality checks do not load the private file, and tests use isolated settings. `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `STORAGE_ROOT`, and the internal proxy target are server-only. No Next.js public configuration exports secrets. The same-origin proxy is planned for S06.

The embedding profile is initially `text-embedding-3-small`, 1,536 dimensions; generation model selection and tokenizer compatibility are verified during implementation. Changing an embedding profile requires coordinated schema/data migration, not just an environment edit.

## Development commands

| Command | Available from | Purpose |
| --- | --- | --- |
| `pnpm dev`, `pnpm build` | Available (S00) | Run app shells; build workspaces |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | Available (S00) | ESLint/Prettier, strict TS/browser boundary, deterministic Jest checks |
| `pnpm format` | Available (S00) | Format application code and tooling; preserve existing documentation/skills |
| `pnpm infra:up`, `pnpm infra:down` | S01 | Start/stop local PostgreSQL; preserve volumes |
| `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:migrate:dev` | S01 | Generate client, apply/create migrations |
| `pnpm test:integration` | S01 | Isolated PostgreSQL/pgvector tests, expanded each stage |
| `pnpm test:e2e` | S06 | Mock-provider browser workflow checks |
| `pnpm eval:offline`, `pnpm eval:live` | S07 | Deterministic fixtures; explicit paid AI evaluation |

S01–S07 commands remain planned and are not defined yet. The Jest script enables Node's experimental VM modules for NestJS 12's ESM dependencies and runs serially; normal tests make no database or paid AI calls. The existing Playwright CLI remains pinned at 0.1.24. npm's old lockfile and tracked generated `node_modules` copies were replaced by the pnpm lockfile and ignore rules; installed project-local skills are preserved.

## Testing and evaluation

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. S00 tests cover liveness/envelopes, generated request IDs, safe unknown-route/internal/parser errors, the JSON size limit, environment bounds/redaction, and root `.env` loading/exit propagation. Shared contracts compile independently with DOM libraries and no Node types. A clean-build secret-canary scan verified that server credentials did not enter web artifacts.

Later stages will add normalization/chunking/context tests, real PostgreSQL/pgvector integration with AI fakes, browser business workflows, and synthetic AI evaluation. There are no measured RAG quality scores yet. See [testing strategy](docs/architecture/testing-strategy.md).

## Roadmap and future work

Use the [primary execution roadmap](docs/features/ROADMAP.md): S00 setup → S01 infrastructure → S02 document management → S03 ingestion → S04 retrieval → S05 question answering → S06 frontend → S07 evaluation and polish. Each stage has its own dependencies, tests, acceptance criteria, and demo.

Authentication, deployment hardening, OCR, background queues, streaming, hybrid search, reranking, chat history, additional providers, versioning, S3 storage, and observability dashboards are optional [future work](docs/product/mvp-scope.md). They are not MVP infrastructure.

S00 is complete; S01 is the next unimplemented stage and requires an explicit request. Agents should first read [AGENTS.md](AGENTS.md).
