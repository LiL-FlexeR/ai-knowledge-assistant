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

S00–S01 implement the API configuration schema and database/storage readiness. Blank database URLs allow liveness only; readiness reports 503. Database connections are lazy, shared by dependency injection, bounded by a five-connection pool and connection/statement timeouts, and disconnected on shutdown. Readiness probes private storage with a generated temporary file and removes only its own probe. S03 adds AI operations and S05 generation settings. Only require the key when AI-backed operations become enabled; missing credentials then produce a documented disabled/not-ready state. From S03 the full Compose profile requires the key; S05 also requires the reviewed generation model for readiness. Missing generation configuration does not block ingestion or search. Fail fast on malformed configuration with variable names only. S00 rejects `NEXT_PUBLIC_*` settings; shared schemas contain no configuration or secrets. These are project defaults, not measured quality or performance claims.

| Variable | Default or rule |
| --- | --- |
| `NODE_ENV`, `API_PORT`, `API_HOST` | development; 3001; host `127.0.0.1`, container override `0.0.0.0` behind loopback-only port publishing |
| `POSTGRES_PASSWORD`, `RUNTIME_DB_PASSWORD`, `DB_PORT` | Private Compose initialization credentials; host database port 5432. Use distinct URL-safe passwords; see README host/container setup |
| `PORT` | Web port 3000; standard Next.js override, loaded from root `.env` by dev/start |
| `DATABASE_URL`, `TEST_DATABASE_URL` | Required when database/tests enabled; separate databases; no production targets in tests |
| `MIGRATION_DATABASE_URL` | Server/tooling-only schema-owner URL for explicit migrations; runtime URL uses data privileges |
| `SHADOW_DATABASE_URL` | Optional isolated development database only if required by the selected Prisma migration tooling |
| `WEB_ORIGIN` | `http://localhost:3000`; exact API mutation Origin and web proxy Host/Origin allowlist; open this address |
| `API_INTERNAL_URL` | Server-only web proxy target; host `http://127.0.0.1:3001`, Compose `http://api:3001` |
| `STORAGE_ROOT` | Absolute path; host `.local/documents` resolved at startup, container `/data/documents`; never served statically |
| `OPENAI_API_KEY` | Server-only secret, no default |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` |
| `EMBEDDING_DIMENSIONS`, `EMBEDDING_PROFILE_ID` | 1536; `openai-small-1536-v1`; reject mismatch with stored ready profiles |
| `OPENAI_CHAT_MODEL` | `gpt-5.4-mini-2026-03-17` only; explicit setting required for generation/readiness, no fallback. `o200k_base`, reasoning `none`; see ADR-002 for capabilities, pricing and unverified account access |
| `PIPELINE_VERSION` | `v1`; extraction/normalization/chunking revision |
| `MAX_UPLOAD_BYTES` | 10485760 (10 MiB), one file per request |
| `MAX_UPLOAD_STREAMS`, `UPLOAD_TIMEOUT_MS` | 2 concurrent multipart streams; 60000 ms for receipt/validation; configurable downward |
| `UPLOAD_REQUESTS_PER_MINUTE`, `DOCUMENT_REQUESTS_PER_MINUTE`, `SEARCH_REQUESTS_PER_MINUTE`, `ASK_REQUESTS_PER_MINUTE` | 10 uploads/reprocess combined; 120 list/detail/delete combined; separate 10 search and 10 ask requests per socket client; configurable downward |
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
| `INGESTION_TIMEOUT_MS`, `ASK_TIMEOUT_MS` | 180000 whole run; 65000 whole search/ask, including database checks, embedding/generation/retries |
| `EXTRACTION_TIMEOUT_MS`, `EXTRACTION_MAX_MEMORY_MB` | 15000; 256 worker budget; see security for limitations |
| `AI_MAX_CONCURRENT_REQUESTS` | 2 outbound calls process-wide; bounded wait included in operation deadline |

Limits may be lowered without a redesign. Raising them requires checking memory, token budgets, provider constraints, and evaluation. Model context window must accommodate instructions, question, context wrappers, 4000 evidence tokens, and 800 output tokens; validate the complete assembled request, not only chunk text. Tokenizer selection is part of pinned model configuration.

S00 caps resource limits at the documented defaults (retrieval topK remains 1–10), fixes embedding dimensions to 1536 and ingestion concurrency to one, and validates overlap below chunk size. Raising those caps requires a reviewed configuration/documentation change. S01 readiness verifies actual vector dimension and stored ready profile/model/dimensions/pipeline compatibility; S03 fixes the model/profile/pipeline identifiers to the verified v1 configuration and uses cl100k_base tokenization. Other model/profile combinations require a reviewed implementation change.

S02 implements the documents module, private local store, serialized quota admission, signed pagination, and deletion compensation. Startup and hourly reconciliation resume deleting rows and remove only generated, unreferenced originals/staging files older than one hour. Reconciliation faults log safe messages and retry; they do not prevent liveness startup. S03 installs one scanner/worker, which processes oldest pending rows only with locally valid AI configuration and database/profile compatibility. Interrupted processing becomes failed on startup; pending resumes. A whole-run AbortController also fences extraction, provider work, deletion and shutdown. Filesystem and database work are separate; transactions contain no streaming or filesystem operations.

Per-route request limits and safe storage rules are owned by [security](security.md). Public processing states and error contracts are owned by [API contracts](api-contracts.md). [README](../../README.md) distinguishes available S00–S06 commands from planned later-stage commands.

## S03 runtime choices

Pinned PDF.js (`pdfjs-dist` 6.5.438), `js-tiktoken` 1.0.21 (`cl100k_base`), and OpenAI Node SDK 7.57.0 are compatible with Node 24.22.3. The accepted embedding model/profile/dimensions/pipeline are fixed to the documented v1 values. Parsing, normalization, document token counting and chunking execute in a terminable worker; it receives bounded bytes and extraction settings with an empty environment, never keys, URLs or storage paths. Worker stdout/stderr are drained without logging untrusted parser output. API Compose resources are limited to 1 GiB and one CPU; the worker heap limit is 256 MiB, which does not cap native allocations or establish a hostile-file sandbox.

Missing `OPENAI_API_KEY` preserves upload/list/detail/delete and pending rows, while readiness reports `aiConfiguration` failed. Database-only Compose setup and migration remain usable without the key; full `up --wait` requires it for API health. Health checks validate configuration locally and never call OpenAI. The single scanner waits its polling interval after bootstrap, retries unavailable database/recovery checks, and never automatically retries failed documents.

## S04 retrieval implementation

The retrieval module exports `RetrievalService` and owns a focused exact SQL reader and source mapper. Search checks existing filter IDs, database/vector/profile compatibility and eligible ready documents before embedding. Query text alone uses the existing model/dimensions and `cl100k_base` token policy. SQL binds vector, UUID arrays, profile fields and limit; it joins ready/current-run documents and selects scalar metadata/content/location/distance only. The mapper validates stored spans and creates plain-text excerpts at Unicode boundaries. No migration or new package is required.

Interactive embedding requests never queue behind full outbound capacity: they return 429 with Retry-After. Ingestion retains its bounded semaphore wait. Search uses the existing 65-second `ASK_TIMEOUT_MS` operation budget and cancels on disconnect. An empty eligible corpus returns a successful limitation even without an AI key; configured/profile/storage/provider errors remain distinct.

## S05 question answering implementation

`chat` consumes the internal complete-span/processing-run retrieval result; the public search DTO is unchanged. It admits complete spans under 4000 `o200k_base` tokens, suppresses >50% overlap in the same document/unit, freezes the source map, and serializes question/evidence as user data under `grounded-answer-v1` system instructions. The full serialized Responses request (including schema, metadata and wrappers) is counted with an additional 1024-token framing allowance; input must fit 272000 tokens and input plus the output reservation must fit the 400000-token window. This local count is a conservative admission estimate, not billed usage.

One `GroundedAnswerClient` call uses the existing pinned OpenAI SDK, strict JSON schema, reasoning disabled, no tools, no streaming/history, disabled automatic truncation and `store: false`. The provider output cap is 800 tokens, with incomplete output rejected rather than shown partially. Embedding and generation share the same semaphore and extracted retry/deadline policy; interactive generation rejects full capacity immediately. The whole ask deadline includes retrieval, context preparation, generation, retries and final ready/run/model/dimension/profile/pipeline checks on cited documents only. No database migration or new package is needed. Readiness remains a local configuration check; no account-access or paid-model health probe is performed.

## S06 frontend implementation

Documents and Ask AI consume browser-safe shared schemas through relative `/api` URLs. Next.js route handlers perform transport only; the API owns business rules. TanStack Query manages list/detail cache and mutation invalidation; only visible active document rows poll at two seconds, with capped exponential error backoff and Retry-After, hidden/offline pause and unmount cancellation. Ready/failed rows stop interval polling. Paid mutations have no automatic retries or offline queue. React Hook Form/Zod validates inputs; server validation remains authoritative.

The proxy has a 75-second allowance and the browser a 78-second allowance. Public assets contain no provider/database/storage/internal-target configuration. Per-request script nonces and dynamic rendering support CSP; inline styles remain permitted for Next/Radix compatibility, while objects, framing and external connections are blocked in production. Source links are fixed local citation anchors and all user/model text is escaped. Content is held only in browser memory, with no persisted history.
