# Security and reliability baseline

## Exposure and secrets

The unauthenticated single-user MVP **must not be exposed publicly**. Bind published ports to loopback, use exact local Origin checks for mutations and no permissive CORS, and reject unexpected Host/proxy configuration. Local controls reduce exposure; they do not replace authentication or protect a compromised machine. Public deployment requires a separate authenticated/hardened design.

Keep OpenAI/database credentials in ignored environment files, server memory, or local secret injection. Never use `NEXT_PUBLIC_` for secrets, commit `.env`, log credentials, or send keys through public DTOs. `.env.example` contains placeholders only. Validate configuration before enabling dependent features; return safe disabled errors. No cloud configuration, identity system, or secret manager required in MVP.

## Upload and file storage

- Enforce one-file multipart streaming limits: 10 MiB, accepted extension/bytes/MIME agreement, UTF-8 text validation, no empty/binary text. Validate server-side before metadata admission. Parser failures are tracked after upload as documented in [API contracts](api-contracts.md).
- Sanitize only the display basename (strip paths, control characters, separators and unsafe bidi controls; cap at 255 characters). Generate disk paths from UUID plus canonical extension; never use the display filename for reads/deletes. Duplicate names are allowed.
- Resolve paths under absolute `STORAGE_ROOT`, validate containment and expected generated shape, use restrictive ownership/permissions, exclusive staging creation, and reject symlinks. Originals are outside web/static roots. No arbitrary file download endpoint.
- Limit corpus to 100 documents, 200 MiB of originals, and five admitted pending/processing documents. Serialize quota admission/reprocess checks. Include deleting rows in capacity reservations. Limit concurrent upload streams to two; staging may temporarily consume up to 20 MiB beyond retained-original capacity.
- PDF extraction has 100-page, 500000-character, 100000-token and 256-chunk limits. Terminate a parser worker after 15 seconds; use a 256-MiB worker heap budget and container memory/CPU limits verified in S03. A worker heap limit does not cap all native allocations, and Docker is not a perfect hostile-file sandbox. Disable external resources and executable content, retain parser security updates, and use permitted sample documents.
- Filesystem deletion and database deletion require compensation and startup reconciliation; see [data model](data-model.md). Do not claim secure physical wiping. Database backups and stopped volumes retain data until the user removes them explicitly.

No antivirus/OCR service or parser microservice in MVP. Document the residual risk of parsing untrusted files. Do not broaden filesystem access to compensate for parser problems.

## Requests and data access

Apply 16-KiB JSON bodies and endpoint throttles per local client plus process-wide AI admission: ask/search each 10/minute, upload/reprocess combined 10/minute, list/detail/delete 120/minute; return 429 with Retry-After. Liveness/readiness can use a separate modest probe allowance. These are starting operational limits, configurable downward and exercised in tests. IP limits are weak abuse protection for a shared proxy and reset on restart; single-user loopback is the primary MVP boundary.

Allow at most two outbound AI calls concurrently; reject excess interactive requests when capacity cannot be obtained promptly within their deadline, and use bounded runner waits for ingestion. Do not trust forwarded IP headers from arbitrary clients. Use UUID validation, whitelisted fields, integer bounds, parameterized SQL, and validated nonzero finite vectors. Browser rendering uses escaped text/React nodes; never execute Markdown HTML from documents or model output. Source links use server-generated anchors, never model-provided URLs. Basic CSP and safe response headers belong in S06.

## AI and untrusted instructions

Document text and questions cannot override system instructions. Put source content into explicitly labeled data blocks, limit context, require structured statements and valid source IDs, and return safe errors for invalid output. The LLM receives no tools, shell, filesystem, arbitrary network access, database execution, or secret context. Following document links is not an ingestion feature.

Prompt instructions and schema checks cannot fully prevent hallucination, irrelevant citations, or prompt injection. Test malicious source content, measure groundedness, and expose excerpts so a person can inspect evidence. Similarity is not answer confidence. Do not claim complete injection protection or invent source pages.

## Privacy and diagnostics

Before upload/ask, explain that document text/questions leave the local runtime for OpenAI. Use synthetic/publicly redistributable data in demos/evaluation; do not commit private files or live outputs containing private data. Verify provider retention/usage settings and current terms before sensitive use; this plan makes no retention guarantee.

Log request ID, operation, internal safe document ID, state transitions, timings, retry counts, error code, and token usage. Exclude document bodies, questions, excerpts, filenames if sensitive, vectors, provider response bodies, and credentials. No persisted chat history in MVP. Show sanitized actionable errors with correlation IDs. Provider error messages must be mapped, not forwarded blindly.

## Reliability and costs

Keep network/whole-operation deadlines, cancellation, bounded retries, and output-token budgets from [RAG pipeline](rag-pipeline.md). Retry only eligible transient errors, account for SDK retries, and ensure database transactions never span network calls. On shutdown stop claims, cancel/drain within the deadline, and let startup mark interrupted runs failed. Pending/deleting recovery is idempotent; stale processing writes are fenced.

Per-document/request token caps and request admission bound individual costs. Repeated requests/reprocessing can still consume money; show the reprocess cost implication and allow explicit user retries. Provider budget alerts are additional safeguards, not an application-enforced monetary guarantee. No performance/availability claims until measured. Lack of authentication, durable multi-worker scheduling, physical deletion guarantees, and full hostile-PDF isolation are explicit MVP limitations.
