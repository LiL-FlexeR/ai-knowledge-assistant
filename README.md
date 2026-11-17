# AI Knowledge Assistant

A local document question-answering API and planned product interface using Retrieval-Augmented Generation (RAG). Upload PDF, TXT, or Markdown files, search their content, and ask questions with references to the supporting passages.

**Status: S00–S05 implemented and verified.** The workspace provides API liveness/readiness, a minimal Next.js shell, local Compose services, reviewed Prisma migrations, PostgreSQL/pgvector primitives, and private document upload/list/detail/delete with quotas and retryable cleanup. S03 adds bounded source-aware extraction/chunking, OpenAI embeddings, atomic vector publication, restart recovery and manual reprocessing. S04 adds exact semantic search over ready/profile-compatible generations with stored source locations and explicit evidence limitations. S05 adds structured question answering, server-created citations, explicit insufficiency/refusal/errors and cited-generation consistency checks. Product screens and live quality evaluation remain S06–S07. See [S05 verification evidence](docs/features/stages/S05-ai-question-answering.md#verification-evidence).

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
  api/                 # NestJS health/config/database/documents/ingestion/ai/retrieval and Prisma schema
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

Install Node.js **24.22.3**, pnpm **12.21.0**, and Docker with Compose. Node/pnpm are also pinned in the repository. Database setup and deterministic checks need no OpenAI key. S03 ingestion and full readiness require a server-only `OPENAI_API_KEY`. Without it liveness and document management remain available, uploads wait pending, and readiness reports 503. PostgreSQL **18.7** with pgvector **0.8.7** and Node images are pinned by immutable digest; Prisma CLI/client/adapter are **7.10.1**, with `pg` **8.23.1**. [ADR-003](docs/architecture/decisions/ADR-003-data-storage.md#s01-implementation-and-compatibility) records the stable-version selection and compatibility evidence.

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

Open `http://localhost:3000`. Liveness `/api/health` returns `{"data":{"status":"ok"},"requestId":"<UUID>"}`. Readiness returns database/storage/profile/AI checks with `aiConfiguration: "ok"`; missing AI credentials or dependency faults return a safe 503 envelope identifying check names. Without a database URL, liveness still runs and readiness returns 503. No health endpoint calls AI. Default host storage is `<repo>/.local/documents`, created privately on the first readiness probe and never served statically.

Host servers bind to `127.0.0.1`. If port 3000 is occupied, use `PORT=3100 WEB_ORIGIN=http://localhost:3100 pnpm dev`, or put those settings in `.env`. `API_PORT` and `DB_PORT` override host ports; update host database URLs when changing `DB_PORT`. Shell variables override root `.env`, loaded relative to the launcher even for filtered app dev/start commands. Root `dev` generates the Prisma client and builds shared contracts first; do both explicitly before running a filtered app from a fresh install. Stop with Ctrl-C.

For the complete container runtime, set `OPENAI_API_KEY` in private root `.env` first. Canonical chunk text and search queries are sent to OpenAI for embeddings, including on reprocess. Then:

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

## Document management and ingestion API (S02–S03)

With the database migrated and API running, create a synthetic fixture and use the REST API:

```bash
printf 'Synthetic notes: maintenance is Sunday at 02:00 UTC.\n' > /tmp/synthetic-notes.txt
curl -i -F 'file=@/tmp/synthetic-notes.txt' http://localhost:3001/api/documents
curl -i 'http://localhost:3001/api/documents?limit=20'
# Substitute the returned UUID:
curl -i 'http://localhost:3001/api/documents/<id>'
# Reprocess only after ready/failed; it clears the old generation and may cost again:
curl -i -X POST 'http://localhost:3001/api/documents/<id>/reprocess'
curl -i -X DELETE 'http://localhost:3001/api/documents/<id>'
curl -i -X DELETE 'http://localhost:3001/api/documents/<id>'
```

Use a quoted URL after substituting the UUID; `<id>` is an illustrative placeholder. Upload exactly one `file` and no other fields. PDF, UTF-8 TXT, `.md` and `.markdown` are supported, with server-verified bytes and canonical MIME. The API returns 201 with `Location` and pending metadata after storing the original; a single scanner processes oldest pending rows when AI is configured. At most five pending/processing documents are admitted. Poll detail for ready/failed; without a key delete pending uploads to free capacity. Search is available through the REST route below; ask is available below, and product UI remains S06.

Defaults are 10 MiB/file, two simultaneous streams, a 60-second receipt/validation deadline, 100 documents/200 MiB retained originals, and 10 upload/reprocess requests combined or 120 list/detail/delete requests per client per minute. Settings may be lowered in `.env`; 429 includes `Retry-After`. Mutations accept the exact `WEB_ORIGIN` when an Origin header is present; curl may omit it. GET pagination supports `status` and a signed cursor bound to that filter; cursors expire on API restart.

Generated originals and staging files stay under private `STORAGE_ROOT`, outside web/static directories. DELETE invalidates evidence, removes the original and metadata, and returns empty 204 only after cleanup; repeated deletion is safe. A cleanup failure returns 500/`DELETE_FAILED` and leaves an inspectable deleting row for retry. Startup/hourly reconciliation retries deleting rows and removes only generated, unreferenced files older than an hour, skipping symlinks and unknown paths. Storage faults and crashes may delay compensation until reconciliation; this is logical deletion, not secure physical erasure. No file download route exists.

See [REST contracts](docs/architecture/api-contracts.md), [generated OpenAPI](docs/architecture/openapi.json), and [S02 verification evidence](docs/features/stages/S02-document-management.md#verification-evidence). `pnpm test:integration` performs document-management, ingestion and search curl workflows against disposable database/storage with fake embeddings, plus controlled failure/race tests.

## Processing limits and limitations (S03)

PDF extraction uses physical pages, TXT retains original lines, and Markdown retains heading paths/section ordinals/lines (headings inside fenced code are ignored). Chunk text is an exact normalized source substring with UTF-16 offsets; normalization handles BOM/CRLF/NFC and trailing horizontal whitespace. PDF reading order, glyph spacing and tables can be imperfect. Encrypted/malformed PDFs fail safely; image-only/scanned PDFs fail `NO_EXTRACTABLE_TEXT`. No OCR is provided.

Extraction, normalization, token counting and chunking run in a terminable worker: defaults are 15 seconds, 256 MiB worker heap, 100 PDF pages, 500000 characters, 100000 pre-overlap tokens and 256 chunks. Chunk target/maximum is 600 tokens with up to 100 overlap tokens. API Compose limits are 1 GiB memory and one CPU. Worker heap limits do not cap all native allocations; this is not a complete hostile-file sandbox.

Embeddings use `text-embedding-3-small`, explicit 1536 dimensions and profile `openai-small-1536-v1`. Batches are bounded by both 32 chunks and the provider token cap, with a shared two-call semaphore. Per-attempt/whole-run deadlines are 20/180 seconds. Up to two eligible transport retries use bounded backoff; SDK retries are disabled. Authentication/format/invalid-output errors do not retry. Failure retains the original and no partial indexed generation. Restart marks interrupted runs failed; pending resumes. Delete/shutdown abort active work; run IDs reject late publication. No failed document is automatically re-embedded.

`POST /api/documents/:id/reprocess` returns 202/pending for ready/failed documents with readable originals and capacity. It clears the old generation before scheduling another, preserving original metadata. Busy, missing-original and capacity faults return documented 409 errors. Each reprocess may incur embedding costs. Required checks use fake AI; paid live embedding smoke and semantic-quality evaluation were not run.

## Semantic search API (S04)

After a synthetic upload reaches ready:

```bash
curl -i -H 'Content-Type: application/json' \
  -d '{"query":"maintenance window","topK":5}' \
  http://localhost:3001/api/search
# To restrict the corpus, add "documentIds":["<existing-document-uuid>"].
```

Search returns passages with chunk IDs, cosine similarities and stored filenames/page or section/line locations. Excerpts contain at most 1000 UTF-16 characters at Unicode boundaries; locations refer to the full chunk. No answer is generated. Queries are trimmed and bounded by 2000 characters/512 `cl100k_base` tokens; topK is 1–10, default configured 5. Exact pgvector queries apply ready/profile/model/dimension/pipeline/current-run/document filters before limiting. The configured 0.30 similarity cutoff is provisional: scores rank passages and do not measure factual confidence or guarantee relevance.

An empty eligible corpus returns 200/`insufficient_context`/`NO_READY_DOCUMENTS` without embedding; candidates below the cutoff return `NO_RELEVANT_CONTEXT`. Unknown document filters return 404. Missing AI, incompatible profiles, storage faults and provider errors remain distinct errors. Search uses `SEARCH_REQUESTS_PER_MINUTE` (10 by default), the shared two-call AI capacity and the whole-operation `ASK_TIMEOUT_MS` (65000 by default). Full AI capacity returns immediate 429 with Retry-After; disconnect aborts provider work. Queries can incur embedding cost. Host settings load from root `.env`; Compose tuning requires explicit API environment overrides. Required tests/curl demos use fake AI; live semantic quality and the cutoff are uncalibrated.

## Question answering API (S05)

Set server-only `OPENAI_CHAT_MODEL=gpt-5.4-mini-2026-03-17` in root `.env` (also passed to Compose), alongside the OpenAI key. Existing environment files with a blank model must be updated explicitly. Liveness, document management, ingestion and search can still run without generation configuration; full readiness requires both key and model.

```bash
# Configured-provider smoke only: indexed synthetic evidence and a real key required.
# This can incur embedding and generation cost; it is not part of normal tests.
curl -i -H 'Content-Type: application/json' \
  -d '{"question":"When is the Orion maintenance window?","topK":5}' \
  http://localhost:3001/api/chat/ask
```

Ask returns `answered`, `insufficient_context` or `refused`, with statements, server-created citations/excerpts, retrieval counts and nullable provider usage. Complete spans are deduplicated under a 4000 `o200k_base` evidence-token cap. The full prompt/schema/metadata plus framing allowance and 800 output-token reservation must fit the reviewed model budgets. One generation call is allowed before eligible transport retries; malformed, truncated or invalid references return 502 without a repair call. Cited documents changed by deletion/reprocessing return 409; the client may retry explicitly. Separate ask rate limits, shared AI capacity, a whole 65-second deadline and disconnect cancellation bound work. No tools, streaming or persisted chat history. Valid citation IDs establish identity, not factual support.

No paid smoke or account-access check was run: this environment has no OpenAI key. Fake-provider tests establish mechanics, while semantic quality and injection resistance remain unmeasured. Responses use `store: false`; no provider retention guarantee is implied.

## Environment configuration

The [system overview](docs/architecture/system-overview.md) owns configuration defaults. API validation is implemented for the listed settings, including integer/range bounds, overlap smaller than chunk size, absolute storage paths, and local web origins. Blank database/AI values are treated as absent. S01 readiness checks the database, extension, required vector dimension, stored ready profile/model/dimensions/pipeline, and actual storage I/O. S03 requires a key for ingestion claims; S05 readiness additionally requires the exact reviewed generation model; health never makes provider calls. Invalid settings fail startup with variable names and no values. `NEXT_PUBLIC_*` configuration remains unsupported and rejected by the API.

Root `.env` is private and ignored; `.env.example` contains placeholders. The API and web dev/start scripts explicitly load it, with shell variables taking precedence. Quality checks do not load the private file, and tests use isolated settings. `DATABASE_URL`, `MIGRATION_DATABASE_URL`, local passwords, `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `STORAGE_ROOT`, and the internal proxy target are server-only. No Next.js public configuration exports secrets. The same-origin proxy is planned for S06.

The embedding profile is initially `text-embedding-3-small`, 1,536 dimensions; S03 pins PDF.js 6.5.438, js-tiktoken 1.0.21 (`cl100k_base`) and OpenAI Node SDK 7.57.0, verified on Node 24.22.3. The accepted model/profile/pipeline identifiers are fixed to the v1 configuration; S05 fixes generation to `gpt-5.4-mini-2026-03-17`, `o200k_base`, reasoning `none`; no fallback is supported. See [ADR-002](docs/architecture/decisions/ADR-002-rag-design.md#s05-generation-model-and-implementation) for public capability/pricing checks and unverified account access. Changing an embedding profile requires coordinated schema/data migration, not just an environment edit.

## Development commands

| Command | Available from | Purpose |
| --- | --- | --- |
| `pnpm dev`, `pnpm build` | Available (S00) | Run app shells; build workspaces |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | Available (S00) | ESLint/Prettier, strict TS/browser boundary, deterministic Jest checks |
| `pnpm format` | Available (S00) | Format application code and tooling; preserve existing documentation/skills |
| `pnpm infra:up`, `pnpm infra:down` | Available (S01) | Start/stop local PostgreSQL; preserve volumes |
| `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:migrate:dev` | Available (S01) | Generate client, deploy committed SQL/create reviewable migration |
| `pnpm test:integration` | Available (S01) | Fresh isolated PostgreSQL/pgvector tests and cleanup |
| `pnpm api:openapi` | Available (S02) | Regenerate implemented health/document/search/ask OpenAPI from shared schemas; `pnpm test` checks drift |
| `pnpm test:e2e` | S06 | Mock-provider browser workflow checks |
| `pnpm eval:offline`, `pnpm eval:live` | S07 | Deterministic fixtures; explicit paid AI evaluation |

Only S06/S07 commands in the table remain planned. The Jest script enables Node's experimental VM modules for NestJS 12's ESM dependencies and runs serially; normal tests make no database or paid AI calls. The existing Playwright CLI remains pinned at 0.1.24. npm's old lockfile and tracked generated `node_modules` copies were replaced by the pnpm lockfile and ignore rules; installed project-local skills are preserved.

## Testing and evaluation

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. S00 tests cover liveness/envelopes, generated request IDs, safe unknown-route/internal/parser errors, the JSON size limit, environment bounds/redaction, and root `.env` loading/exit propagation. Shared contracts compile independently with DOM libraries and no Node types. A clean-build secret-canary scan verified that server credentials did not enter web artifacts.

`pnpm test:integration` starts a unique Compose project with the same pinned image, random credentials, a generated `aka_test_<run-id>` database, a random loopback port, tmpfs database data, and temporary storage. It refuses supplied `TEST_DATABASE_URL`/`TEST_STORAGE_ROOT` overrides, ignores normal database targets, checks ownership before writes, replays committed migrations, verifies read-only introspection and schema diff, regenerates the client, and runs real vector/constraint/privilege/readiness and document lifecycle tests. S02 covers supported/invalid uploads, private storage, quota races, stable pagination, safe errors, deletion fencing/compensation/retry, cleanup, admission and stream disconnect/deadline handling; the harness builds the API and runs a curl REST demo too. Cleanup removes only that project and its temporary storage, including after failures; it never removes named volumes. Unit tests also verify rejected production-looking URLs/storage paths and document format/name/path/quota/cursor rules. Normal tests make no database/provider calls and check generated OpenAPI for drift.

S03 adds canonical source/Unicode/chunk tests, real PDF worker fixtures, embedding validation/retry/deadline/semaphore tests, real-database atomic publication/rollback/reprocess/restart/delete races, and a curl processing demo with fake AI. S04 adds query/source/error/admission tests, actual cosine order/tie/cutoff/topK/profile/run/document-filter tests, canonical-source checks and curl search demos. S05 adds context/statement/citation/status and Responses-adapter tests, shared retry/capacity/deadline checks, plus real-database citation mapping and deletion/reprocess/rebuild races. Later stages add browser workflows and semantic evaluation. There are no measured RAG quality scores yet. See [testing strategy](docs/architecture/testing-strategy.md).

## Roadmap and future work

Use the [primary execution roadmap](docs/features/ROADMAP.md): S00 setup → S01 infrastructure → S02 document management → S03 ingestion → S04 retrieval → S05 question answering → S06 frontend → S07 evaluation and polish. Each stage has its own dependencies, tests, acceptance criteria, and demo.

Authentication, deployment hardening, OCR, background queues, streaming, hybrid search, reranking, chat history, additional providers, versioning, S3 storage, and observability dashboards are optional [future work](docs/product/mvp-scope.md). They are not MVP infrastructure.

S00–S05 are complete; S06–S07 remain unimplemented and require an explicit request. Agents should first read [AGENTS.md](AGENTS.md).
