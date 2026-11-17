# AI Knowledge Assistant

A planned document question-answering application using Retrieval-Augmented Generation (RAG). Upload PDF, TXT, or Markdown files, search their content, and ask questions with references to the supporting passages.

**Status: S00–S02 implemented and verified.** The workspace provides API liveness/readiness, a minimal Next.js shell, local Compose services, reviewed Prisma migrations, PostgreSQL/pgvector primitives, and private document upload/list/detail/delete with quotas and retryable cleanup. Uploads stay pending: ingestion, retrieval, AI, and product screens remain planned in S03–S07. See [S02 verification evidence](docs/features/stages/S02-document-management.md#verification-evidence).

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
  api/                 # NestJS health/config/database/documents and Prisma schema
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

Install Node.js **24.22.3**, pnpm **12.21.0**, and Docker with Compose. Node/pnpm are also pinned in the repository. S01–S02 need no OpenAI key. PostgreSQL **18.7** with pgvector **0.8.7** and Node images are pinned by immutable digest; Prisma CLI/client/adapter are **7.10.1**, with `pg` **8.23.1**. [ADR-003](docs/architecture/decisions/ADR-003-data-storage.md#s01-implementation-and-compatibility) records the stable-version selection and compatibility evidence.

For host development:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# Fill the local credentials and host URLs described below before infra:up.
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm dev
curl -i http://localhost:3001/api/health/ready
```

In private root `.env`, set separate `POSTGRES_PASSWORD` and `RUNTIME_DB_PASSWORD` values (for example, generate each with `openssl rand -hex 24`). Set `DATABASE_URL=postgresql://aka_runtime:<runtime-password>@127.0.0.1:5432/aka` and `MIGRATION_DATABASE_URL=postgresql://aka_migrator:<migration-password>@127.0.0.1:5432/aka`, substituting the matching passwords. Use URL-safe hex or percent-encode password characters. `infra:up` starts only the database. Its empty-volume bootstrap creates the runtime role; the reviewed migration grants data access only to the two entity tables. The privileged migrator creates extensions/schema and owns the migration ledger; its URL is never supplied to the API container.

Open `http://localhost:3000`. Liveness `/api/health` returns `{"data":{"status":"ok"},"requestId":"<UUID>"}`. Readiness returns database/storage/profile checks and `aiConfiguration: "disabled"`; faults return a safe 503 envelope identifying check names. Without a database URL, liveness still runs and readiness returns 503. No health endpoint calls AI. Default host storage is `<repo>/.local/documents`, created privately on the first readiness probe and never served statically.

Host servers bind to `127.0.0.1`. If port 3000 is occupied, use `PORT=3100 WEB_ORIGIN=http://localhost:3100 pnpm dev`, or put those settings in `.env`. `API_PORT` and `DB_PORT` override host ports; update host database URLs when changing `DB_PORT`. Shell variables override root `.env`, loaded relative to the launcher even for filtered app dev/start commands. Root `dev` generates the Prisma client and builds shared contracts first; do both explicitly before running a filtered app from a fresh install. Stop with Ctrl-C.

For the complete container runtime:

```bash
pnpm infra:up
docker compose --profile tools run --rm --build migrate
docker compose up --build -d --wait
curl -i http://localhost:3001/api/health/ready
pnpm infra:down
```

Migrations are explicit; API startup never applies them. Container API uses `db:5432` and `/data/documents`, web uses the server-only target `http://api:3001`, and containers listen internally on their interfaces. Published database/API/web ports remain loopback-only. Only API mounts the `originals` volume; PostgreSQL has its own `database` volume at `/var/lib/postgresql` for PostgreSQL 18. Normal `infra:down`, `up`, and restart preserve both volumes. Password initialization runs only on an empty database volume: editing `.env` does not rotate an existing role's password. Do not remove volumes to resolve a credential mismatch.

After `pnpm build`, filtered API/web `start` commands run the compiled host apps. Docker uses a production dependency deployment for API and standalone output for web, both as non-root `node`. The optional `migrate` profile retains the CLI/OpenSSL tooling separately. Only the watcher and Prisma's selected lifecycle scripts are allowed by pnpm; its optional Playwright skills notice does not block installation.

`pnpm db:migrate` deploys committed SQL. `pnpm db:migrate:dev --name <change>` uses `migrate dev --create-only`: use a disposable development database, review generated SQL, then apply it explicitly. Prisma needs a shadow database for development diffs, creating a temporary one using the local migrator's privileges unless a separate `SHADOW_DATABASE_URL` is supplied. Deploy and generation need no shadow database. Never point a shadow URL at retained application data.

Keep `Unsupported("vector(1536)")` in the committed schema and the custom extension/type/check SQL in migrations. Prisma 7 introspection prints `Unsupported("vector")`, omitting dimensions, and does not model SQL CHECK constraints. Use read-only `db pull --print`; review any future introspection changes rather than overwriting this schema. Real catalog/readiness tests own dimension verification; a clean Prisma diff alone cannot establish it.

## Document API (S02)

With the database migrated and API running, create a synthetic fixture and use the REST API:

```bash
printf 'Synthetic notes: maintenance is Sunday at 02:00 UTC.\n' > /tmp/synthetic-notes.txt
curl -i -F 'file=@/tmp/synthetic-notes.txt' http://localhost:3001/api/documents
curl -i 'http://localhost:3001/api/documents?limit=20'
# Substitute the returned UUID:
curl -i 'http://localhost:3001/api/documents/<id>'
curl -i -X DELETE 'http://localhost:3001/api/documents/<id>'
curl -i -X DELETE 'http://localhost:3001/api/documents/<id>'
```

Use a quoted URL after substituting the UUID; `<id>` is an illustrative placeholder. Upload exactly one `file` and no other fields. PDF, UTF-8 TXT, `.md` and `.markdown` are supported, with server-verified bytes and canonical MIME. The API returns 201 with `Location` and pending metadata after storing the original; **pending does not process in S02**. The five-pending cap therefore requires deleting an upload before admitting a sixth. Reprocess, extraction, embeddings, search, chat and product UI arrive later.

Defaults are 10 MiB/file, two simultaneous streams, a 60-second receipt/validation deadline, 100 documents/200 MiB retained originals, and 10 uploads or 120 list/detail/delete requests per client per minute. Settings may be lowered in `.env`; 429 includes `Retry-After`. Mutations accept the exact `WEB_ORIGIN` when an Origin header is present; curl may omit it. GET pagination supports `status` and a signed cursor bound to that filter; cursors expire on API restart.

Generated originals and staging files stay under private `STORAGE_ROOT`, outside web/static directories. DELETE invalidates evidence, removes the original and metadata, and returns empty 204 only after cleanup; repeated deletion is safe. A cleanup failure returns 500/`DELETE_FAILED` and leaves an inspectable deleting row for retry. Startup/hourly reconciliation retries deleting rows and removes only generated, unreferenced files older than an hour, skipping symlinks and unknown paths. Storage faults and crashes may delay compensation until reconciliation; this is logical deletion, not secure physical erasure. No file download route exists.

See [REST contracts](docs/architecture/api-contracts.md), [generated OpenAPI](docs/architecture/openapi.json), and [S02 verification evidence](docs/features/stages/S02-document-management.md#verification-evidence). `pnpm test:integration` performs the curl workflow against disposable database/storage fixtures as well as controlled lifecycle-failure tests.

## Environment configuration

The [system overview](docs/architecture/system-overview.md) owns configuration defaults. API validation is implemented for the listed settings, including integer/range bounds, overlap smaller than chunk size, absolute storage paths, and local web origins. Blank database/AI values are treated as absent. S01 readiness checks the database, extension, required vector dimension, stored ready profile/model/dimensions/pipeline, and actual storage I/O. Later stages add AI operation requirements. Invalid settings fail startup with variable names and no values. `NEXT_PUBLIC_*` configuration remains unsupported and rejected by the API.

Root `.env` is private and ignored; `.env.example` contains placeholders. The API and web dev/start scripts explicitly load it, with shell variables taking precedence. Quality checks do not load the private file, and tests use isolated settings. `DATABASE_URL`, `MIGRATION_DATABASE_URL`, local passwords, `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `STORAGE_ROOT`, and the internal proxy target are server-only. No Next.js public configuration exports secrets. The same-origin proxy is planned for S06.

The embedding profile is initially `text-embedding-3-small`, 1,536 dimensions; generation model selection and tokenizer compatibility are verified during implementation. Changing an embedding profile requires coordinated schema/data migration, not just an environment edit.

## Development commands

| Command | Available from | Purpose |
| --- | --- | --- |
| `pnpm dev`, `pnpm build` | Available (S00) | Run app shells; build workspaces |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | Available (S00) | ESLint/Prettier, strict TS/browser boundary, deterministic Jest checks |
| `pnpm format` | Available (S00) | Format application code and tooling; preserve existing documentation/skills |
| `pnpm infra:up`, `pnpm infra:down` | Available (S01) | Start/stop local PostgreSQL; preserve volumes |
| `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:migrate:dev` | Available (S01) | Generate client, deploy committed SQL/create reviewable migration |
| `pnpm test:integration` | Available (S01) | Fresh isolated PostgreSQL/pgvector tests and cleanup |
| `pnpm api:openapi` | Available (S02) | Regenerate implemented health/document OpenAPI from shared schemas; `pnpm test` checks drift |
| `pnpm test:e2e` | S06 | Mock-provider browser workflow checks |
| `pnpm eval:offline`, `pnpm eval:live` | S07 | Deterministic fixtures; explicit paid AI evaluation |

Only S06/S07 commands in the table remain planned. The Jest script enables Node's experimental VM modules for NestJS 12's ESM dependencies and runs serially; normal tests make no database or paid AI calls. The existing Playwright CLI remains pinned at 0.1.24. npm's old lockfile and tracked generated `node_modules` copies were replaced by the pnpm lockfile and ignore rules; installed project-local skills are preserved.

## Testing and evaluation

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. S00 tests cover liveness/envelopes, generated request IDs, safe unknown-route/internal/parser errors, the JSON size limit, environment bounds/redaction, and root `.env` loading/exit propagation. Shared contracts compile independently with DOM libraries and no Node types. A clean-build secret-canary scan verified that server credentials did not enter web artifacts.

`pnpm test:integration` starts a unique Compose project with the same pinned image, random credentials, a generated `aka_test_<run-id>` database, a random loopback port, tmpfs database data, and temporary storage. It refuses supplied `TEST_DATABASE_URL`/`TEST_STORAGE_ROOT` overrides, ignores normal database targets, checks ownership before writes, replays committed migrations, verifies read-only introspection and schema diff, regenerates the client, and runs real vector/constraint/privilege/readiness and document lifecycle tests. S02 covers supported/invalid uploads, private storage, quota races, stable pagination, safe errors, deletion fencing/compensation/retry, cleanup, admission and stream disconnect/deadline handling; the harness builds the API and runs a curl REST demo too. Cleanup removes only that project and its temporary storage, including after failures; it never removes named volumes. Unit tests also verify rejected production-looking URLs/storage paths and document format/name/path/quota/cursor rules. Normal tests make no database/provider calls and check generated OpenAPI for drift.

Later stages will add normalization/chunking/context tests, business integration with AI fakes, browser workflows, and synthetic AI evaluation. There are no measured RAG quality scores yet. See [testing strategy](docs/architecture/testing-strategy.md).

## Roadmap and future work

Use the [primary execution roadmap](docs/features/ROADMAP.md): S00 setup → S01 infrastructure → S02 document management → S03 ingestion → S04 retrieval → S05 question answering → S06 frontend → S07 evaluation and polish. Each stage has its own dependencies, tests, acceptance criteria, and demo.

Authentication, deployment hardening, OCR, background queues, streaming, hybrid search, reranking, chat history, additional providers, versioning, S3 storage, and observability dashboards are optional [future work](docs/product/mvp-scope.md). They are not MVP infrastructure.

S00–S02 are complete; S03–S07 remain unimplemented and require an explicit request. Agents should first read [AGENTS.md](AGENTS.md).
