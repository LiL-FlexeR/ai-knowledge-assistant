# Requirements

The document/RAG requirements below remain planned. S00–S01 verify health contracts, initial workspace/configuration, local infrastructure reproducibility, and database/vector integrity primitives in FR-09 and NFR-01/03/04/05/06; none of those broader requirements is complete yet. Architectural defaults and public DTOs are authoritative in [system overview](../architecture/system-overview.md) and [API contracts](../architecture/api-contracts.md).

## Functional requirements

| ID | Requirement | Acceptance evidence / owning stage |
| --- | --- | --- |
| FR-01 | Upload one PDF, UTF-8 TXT, or Markdown file, keep its original and metadata | Valid files return 201/pending; invalid type, empty text, oversize and quota failures follow API contract; S02 |
| FR-02 | List, inspect, and delete documents | Stable cursor pagination; observable states/errors; deletion removes file/text/chunks and tolerates retry; S02/S03 |
| FR-03 | Extract and normalize text with preserved source metadata | Text PDFs retain physical pages; TXT uses document section/lines; Markdown uses headings/section ordinal/lines; scanned/invalid files fail explicitly; S03 |
| FR-04 | Create token-aware chunks and compatible embeddings | Bounded deterministic spans, profile validation, complete atomic publication; no partial searchable document; S03 |
| FR-05 | Expose processing status and manual reprocessing | Pending→processing→ready/failed; interruption and retry handled; reprocess invalidates prior generation; S03 |
| FR-06 | Search semantically across ready documents | Query embeddings, exact cosine retrieval, topK 1–10, optional document filters, real source locations, explicit empty-evidence outcome; S04 |
| FR-07 | Answer questions using admitted evidence only | Structured statements, server-mapped citations, conflict/ambiguity behavior, separate abstention/refusal/errors; S05 |
| FR-08 | Provide Documents and Ask AI screens | Upload/list/status/error/delete/reprocess and question/loading/answer/source/insufficient/refusal/error states; S06 |
| FR-09 | Expose liveness/readiness and documented REST contracts | Safe health endpoints and generated contract documentation; S00/S01, extended with features |

## Non-functional requirements

| ID | Requirement | Verification |
| --- | --- | --- |
| NFR-01 | Local reproducibility | Fresh setup uses pinned versions, lockfile, environment example, migrations, and Compose; S00/S01/S07 |
| NFR-02 | Bounded resource/cost use | Numeric byte/page/character/token/chunk/corpus/admission limits, operation deadlines, bounded retries, usage counters; boundary/error tests |
| NFR-03 | Data integrity | Complete ready generations, run fencing, parameterized vector SQL, cascade/compensating cleanup, profile compatibility; real database tests |
| NFR-04 | Security/privacy baseline | Server-only keys, safe paths, no arbitrary model tools, untrusted content rendering, local-only exposure and provider disclosure; targeted checks |
| NFR-05 | Maintainability | Modular NestJS, strict TypeScript, thin controllers, focused interfaces, browser-safe shared schemas, affected documentation updated |
| NFR-06 | Testability | Deterministic AI fakes for normal tests; actual pgvector integration; synthetic evaluation with measured denominators and no invented scores |
| NFR-07 | Usable feedback | Labeled forms, keyboard interaction, readable status/errors, accessible loading/results, narrow/mobile layout checks; S06 |
| NFR-08 | Transparency | Show source excerpts and meaningful state/error reasons; record safe token/latency diagnostics; disclose extraction and grounding limitations |

No throughput, uptime, latency percentile, or accuracy SLA is promised before measurement. S07 records actual demo observations and test environment; exceeding a configured deadline must produce a safe bounded failure, not an invented performance guarantee.

## MVP requirements

FR-01 through FR-09 and NFR-01 through NFR-08 define the MVP with the constraints in [scope](mvp-scope.md). Upload defaults are 10 MiB/file, 100 PDF pages, 500000 extracted characters, 100000 document tokens, 256 chunks, 100 documents/200 MiB originals, five admitted pending/processing documents, and one ingestion worker. [System overview](../architecture/system-overview.md) owns future changes to these defaults.

Semantic search is a required REST capability; a standalone search UI is optional and not required for the two-screen MVP. Reprocess is a small required lifecycle action, not document versioning. No public file download or rich PDF viewer is required; source cards identify original locations and include stored excerpts.

## Future enhancements

Authentication/public deployment hardening, multi-user workspaces, queues, streaming, advanced retrieval, OCR, provider alternatives, cloud storage, and other optional work belong in the [future backlog](mvp-scope.md). Do not add their infrastructure while implementing MVP requirements.
