# MVP scope and optional backlog

## In scope

- One local user/corpus, no accounts; Docker Compose runtime and pnpm development.
- PDF (extractable text only), TXT, and Markdown upload with bounded validation/private originals.
- Metadata/status/error listing, detail, deletion, and explicit reprocessing.
- Source-aware extraction/normalization/chunking, OpenAI embeddings, PostgreSQL/pgvector storage.
- Exact cosine semantic search REST endpoint with configurable bounded retrieval.
- Grounded question answering, server-mapped citations/excerpts, explicit insufficient-context and refusal states.
- Documents and Ask AI screens with basic accessibility, loading/error feedback, source cards, and safe rendering.
- Migrations, health, safe diagnostics, deterministic tests, real vector integration, synthetic evaluation, and demo documentation.

The initial limits are specified in [system overview](../architecture/system-overview.md). “Production-oriented” means deliberate contracts, failure handling, security fundamentals, and verification; it does not mean this unauthenticated MVP is approved for public deployment.

## Out of scope for MVP

Authentication, multi-user workspaces, multi-tenancy, subscriptions/billing, cloud hosting, Kubernetes, microservices, external vector databases, OCR/scanned-document recognition, multi-agent workflows, fine-tuning/custom training, advanced document analytics, complex permissions, real-time collaboration, persisted chat history, document version history, and a rich PDF viewer. No arbitrary LLM tools or filesystem/network actions. Redis/BullMQ are not required for the bounded single-process design.

## Future backlog

These are options, not automatic next stages or prebuilt interfaces:

| Candidate | Trigger / prerequisite |
| --- | --- |
| Authentication and deployment hardening | Any public exposure; threat model, access control, TLS, retention and operational review first |
| Multi-user workspaces/permissions | Actual shared-use need; identity and isolation schema/testing first |
| BullMQ ingestion | Measured pending load, execution time, or recovery needs exceed single-process bounds; design durable workers/idempotency then |
| Streaming answers | User latency feedback warrants transport/citation-finalization complexity |
| Hybrid search/reranking/query rewriting | Evaluation shows retrieval failures that the technique can address |
| HNSW vector index | Exact search measurements on a larger corpus justify approximate recall trade-offs |
| Multiple AI providers | Concrete second provider requirement; extend the two existing capability boundaries |
| Chat history | Product demand and explicit privacy/retention decisions |
| Document versioning/incremental ingestion | Need to keep old generations or reduce repeated embedding cost |
| OCR | Need for scanned documents; separate resource/privacy/evaluation plan |
| S3 storage/cloud deployment | Deployment requirement and authentication/hardening completed |
| Observability dashboards | Operational questions exceed safe logs/usage reports |

Scope changes require a documented rationale, affected requirements/contracts, and roadmap updates. Do not install future infrastructure speculatively.
