# System overview

## Design

One local Next.js web app, one NestJS API process, one PostgreSQL/pgvector database, and one API-owned file volume. Target a single user and single API replica. No authentication, multi-tenancy, Redis, microservices, or cloud services in MVP. Docker Compose is the complete local runtime target.

## Module boundaries

| Module | Responsibility and exported boundary |
| --- | --- |
| `documents` | Upload/list/detail/delete/reprocess application services; document persistence; `LocalDocumentStore` for safe original-file operations |
| `ingestion` | Pending-row scanner, bounded processing, extractor adapters, normalization, chunking, atomic publication; imports documents internals explicitly exported for lifecycle operations |
| `ai` | One OpenAI SDK adapter, `EmbeddingClient` and `GroundedAnswerClient` interfaces, provider timeouts and usage accounting |
| `retrieval` | Query embedding through `ai`, vector SQL and ready/profile filters, source DTO mapping; exports `RetrievalService` |
| `chat` | Context and prompt construction, calls retrieval and `ai`, validates answer citations; exports ask service |
| `database`, `config`, `health` | Prisma lifecycle, validated environment, liveness/readiness |

Controllers only validate transport, invoke application services, and map responses. Prisma is used directly within owning services and focused SQL helpers; no generic repository layer. `documents` never imports `ingestion`: uploads persist pending rows, and ingestion discovers them. `retrieval` owns vector reads; ingestion owns vector writes. Both use shared database infrastructure and the same profile configuration. `chat` cannot read arbitrary files or call external tools.

`packages/shared` exports browser-safe Zod request/response schemas and inferred types. It must not import Prisma, NestJS, Node filesystem APIs, or secrets. Keep internal entities/provider DTOs in the API. Next.js uses TanStack Query for server state, React Hook Form/Zod for forms, and shadcn/ui/Tailwind for accessible UI.

## Invariants

- Only `ready` documents matching the active embedding profile are searchable.
- A complete chunk set and the ready transition commit together; partial embeddings are never visible.
- All persisted chunks map to a real canonical source unit and location.
- Reprocessing invalidates old chunks before scheduling new work; processing run IDs fence stale writes.
- Deletion hides the document before removing files; retries and startup reconciliation finish cleanup.
- Citation identities and locations come from retrieved rows, never from model-generated filenames or pages.
- A valid citation identity is necessary but does not prove that the cited passage supports a claim.

## Configuration

S00–S01 implement the API configuration schema and database/storage readiness. Blank database URLs allow liveness only; readiness reports 503. Database connections are lazy, shared by dependency injection, bounded by a five-connection pool and connection/statement timeouts, and disconnected on shutdown. Readiness probes private storage with a generated temporary file and removes only its own probe. S03 adds AI operations and S05 generation settings. Only require the key when AI-backed operations become enabled; missing credentials then produce a documented disabled/not-ready state. From S03 the full Compose profile requires the key. Fail fast on malformed configuration with variable names only. S00 rejects `NEXT_PUBLIC_*` settings; shared schemas contain no configuration or secrets. These are project defaults, not measured quality or performance claims.

| Variable | Default or rule |
| --- | --- |
| `NODE_ENV`, `API_PORT`, `API_HOST` | development; 3001; host `127.0.0.1`, container override `0.0.0.0` behind loopback-only port publishing |
| `POSTGRES_PASSWORD`, `RUNTIME_DB_PASSWORD`, `DB_PORT` | Private Compose initialization credentials; host database port 5432. Use distinct URL-safe passwords; see README host/container setup |
| `PORT` | Web port 3000; standard Next.js override, loaded from root `.env` by dev/start |
| `DATABASE_URL`, `TEST_DATABASE_URL` | Required when database/tests enabled; separate databases; no production targets in tests |
| `MIGRATION_DATABASE_URL` | Server/tooling-only schema-owner URL for explicit migrations; runtime URL uses data privileges |
| `SHADOW_DATABASE_URL` | Optional isolated development database only if required by the selected Prisma migration tooling |
| `WEB_ORIGIN` | `http://localhost:3000`; exact mutation Origin allowlist |
| `API_INTERNAL_URL` | Server-only web proxy target; host `http://127.0.0.1:3001`, Compose `http://api:3001` |
| `STORAGE_ROOT` | Absolute path; host `.local/documents` resolved at startup, container `/data/documents`; never served statically |
| `OPENAI_API_KEY` | Server-only secret, no default |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` |
| `EMBEDDING_DIMENSIONS`, `EMBEDDING_PROFILE_ID` | 1536; `openai-small-1536-v1`; reject mismatch with stored ready profiles |
| `OPENAI_CHAT_MODEL` | Required from S05; verify a stable structured-output Responses model and tokenizer in S05, record exact identifier in `.env.example` and ADR-002 |
| `PIPELINE_VERSION` | `v1`; extraction/normalization/chunking revision |
| `MAX_UPLOAD_BYTES` | 10485760 (10 MiB), one file per request |
| `MAX_PDF_PAGES`, `MAX_EXTRACTED_CHARS` | 100; 500000 UTF-16 code units |
| `MAX_DOCUMENT_TOKENS`, `MAX_CHUNKS` | 100000; 256; reject excess rather than silently truncate |
| `MAX_DOCUMENTS`, `MAX_STORED_BYTES` | 100; 209715200 (200 MiB), originals including pending/deleting reservations |
| `MAX_PENDING_DOCUMENTS` | 5 pending + processing combined |
| `INGESTION_CONCURRENCY`, `INGESTION_POLL_MS` | 1 only for MVP; 1000 |
| `CHUNK_TOKENS`, `CHUNK_OVERLAP_TOKENS` | 600; 100; overlap smaller than size |
| `EMBEDDING_BATCH_SIZE` | 32 chunks, also bounded by selected provider request-token limit |
| `RETRIEVAL_TOP_K`, `RETRIEVAL_MIN_SIMILARITY` | 5 (request range 1–10); 0.30 (config range -1–1, provisional calibration setting) |
| `CONTEXT_MAX_TOKENS`, `ANSWER_MAX_OUTPUT_TOKENS` | 4000 evidence tokens; 800 total provider output-token cap |
| `QUESTION_MAX_CHARS`, `QUESTION_MAX_TOKENS` | 2000; 512; both enforced |
| `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_RETRIES` | 20000 per attempt; 2 retries after the first |
| `INGESTION_TIMEOUT_MS`, `ASK_TIMEOUT_MS` | 180000 whole run; 65000 whole ask, including embedding/generation/retries |
| `EXTRACTION_TIMEOUT_MS`, `EXTRACTION_MAX_MEMORY_MB` | 15000; 256 worker budget; see security for limitations |
| `AI_MAX_CONCURRENT_REQUESTS` | 2 outbound calls process-wide; bounded wait included in operation deadline |

Limits may be lowered without a redesign. Raising them requires checking memory, token budgets, provider constraints, and evaluation. Model context window must accommodate instructions, question, context wrappers, 4000 evidence tokens, and 800 output tokens; validate the complete assembled request, not only chunk text. Tokenizer selection is part of pinned model configuration.

S00 caps resource limits at the documented defaults (retrieval topK remains 1–10), fixes embedding dimensions to 1536 and ingestion concurrency to one, and validates overlap below chunk size. Raising those caps requires a reviewed configuration/documentation change. S01 readiness verifies actual vector dimension and stored ready profile/model/dimensions/pipeline compatibility; provider/tokenizer compatibility remains for later stages.

Per-route request limits and safe storage rules are owned by [security](security.md). Public processing states and error contracts are owned by [API contracts](api-contracts.md). [README](../../README.md) distinguishes available S00/S01 commands from planned later-stage commands.
