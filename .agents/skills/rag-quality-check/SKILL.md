---
name: rag-quality-check
description: Review AI Knowledge Assistant ingestion, retrieval, grounding, citation handling, or evaluation changes against the project's RAG invariants and synthetic evidence cases.
---

# Check RAG quality

Read the changed pipeline code/proposal plus the relevant [RAG pipeline](../../../docs/architecture/rag-pipeline.md), [source/lifecycle model](../../../docs/architecture/data-model.md), [API contract](../../../docs/architecture/api-contracts.md), and [testing strategy](../../../docs/architecture/testing-strategy.md). Scope checks to the requested change.

Trace one supported document through extraction, canonical source units, chunk spans, embeddings, retrieval, admitted context, statements, and server-created citations. Check:

- Physical PDF pages and text/Markdown sections/lines survive normalization and chunking; content equals the referenced span; no invented pages or empty/duplicate trailing chunks.
- Token budgets, Unicode boundaries, overlap, chunk caps and deterministic ordering hold on edge fixtures.
- Query/document vectors share provider/model/dimensions/input policy; response indices, finite/nonzero validation, parameterized cosine SQL and ready/profile/run filters are correct.
- Partial/stale generations cannot become searchable; retry/reprocess/delete/interruption behavior preserves source identity and bounds paid work.
- Context admission/deduplication respects full prompt budgets; only admitted source IDs are allowed; output validation and changed-evidence checks reject bad references.
- Missing evidence, ambiguity, conflicts, refusal and upstream failure remain distinct; valid citation IDs are not treated as proof of factual support.
- Untrusted source instructions cannot grant tools, filesystem or network actions; prompt boundaries and safe rendering are present without claims of complete protection.
- Evaluation includes answerable/unanswerable, multi-section, ambiguous, conflicting and injection cases with gold spans and measured denominators.

Run relevant existing deterministic checks when available; use actual pgvector for vector behavior. Do not infer real semantic quality from fake outputs or run paid AI unless explicitly requested/configured for this task. Report concrete defects, evidence gaps, practical improvements, and tests run/unavailable. Never invent evaluation scores or silently add advanced retrieval infrastructure.
