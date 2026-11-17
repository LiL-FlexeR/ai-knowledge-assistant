# ADR-002 — RAG Architecture

## Status

Accepted, 2026-11-16. S03 ingestion and S04 retrieval implemented and verified on 2026-11-17; grounded generation remains planned. Quality settings are initial hypotheses to evaluate after implementation.

## Context

Users need answers from their own documents, source references, and a clear indication when evidence is missing. A model's pretrained knowledge cannot provide reliable document-specific provenance. Fine-tuning is unnecessary for loading changing user documents.

## Decision

Use a direct RAG pipeline: page/section-preserving extraction, deterministic 600-token chunks with up to 100-token overlap, OpenAI `text-embedding-3-small` at 1536 dimensions, exact cosine retrieval in pgvector, and one grounded structured generation call. Defaults and token limits are owned by [system overview](../system-overview.md); processing and query details by [RAG pipeline](../rag-pipeline.md).

Embeddings represent semantic similarity so relevant passages can be found beyond exact keyword matches. Search only complete ready generations in one compatible embedding space. Use default topK 5 (max 10) and a provisional 0.30 cosine-similarity noise cutoff; calibrate with synthetic evaluation. No threshold guarantees answerability or correctness.

Build a request-local map of source IDs to admitted persisted chunks. The model emits statements with allowed IDs; the server validates IDs and builds public citations from stored metadata. No model-generated file/page fields. Empty retrieval skips generation; evidence insufficiency produces a successful explicit abstention; provider failures remain errors. Conflicting evidence is described with references, and ambiguity triggers clarification when required.

The generation model remains a deployment configuration choice to verify in S05, not an invented current model recommendation. Record the chosen identifier, tokenizer, structured-output compatibility, and cost/context checks here when implemented. No LLM tools or external actions.

## Alternatives considered

- Send entire documents each time: simple only for tiny files, with growing context/cost and weaker retrieval transparency.
- Fine-tuning/custom models: expensive and poorly suited to frequently uploaded factual sources/provenance.
- Keyword-only search: useful for exact terms but insufficient semantic recall for the intended demonstration.
- Hybrid retrieval, reranking, query rewriting, agents: potential later improvements, with more evaluation and operational work than the first baseline needs.

## Consequences

Chunk boundaries, extraction order, and query phrasing affect retrieval. Exact search is a clear small-corpus baseline, not a scaling claim. Structured output provides citation identity checks, not entailment verification. Prompt injection and hallucination remain possible; [evaluation](../testing-strategy.md) and visible excerpts are required. Model/profile changes require explicit reindexing; simple reprocessing temporarily removes document searchability.

## S03 implementation evidence

The initial model/profile and source invariants are implemented without an architectural scope change. PDF.js 6.5.438, js-tiktoken 1.0.21 (`cl100k_base`) and OpenAI SDK 7.57.0 were verified against their package engines and exercised on Node 24.22.3. Extraction/chunking is bounded by a terminable worker; complete vectors publish with text/source/profile/ready in one row-locked, run-fenced transaction. Reprocess removes the old generation; no fallback version is retained. Exact choices, request caps, parser limitations and fake-provider evidence are in [pipeline](../rag-pipeline.md#s03-implementation-and-verified-boundaries) and [S03 evidence](../../features/stages/S03-document-ingestion.md#verification-evidence). No live semantic-quality result is claimed.

## S04 implementation evidence

Exact cosine retrieval, bounded query embeddings, ready/profile/model/dimension/pipeline/run/document filters and persisted source mapping implement the accepted baseline without changing the architecture. Real pgvector tests cover order, UUID ties, topK, cutoff, subsets, source spans and stale runs; HTTP tests cover safe limitations and configuration/provider/capacity/deadline errors. The default 0.30 cutoff remains provisional and configurable; deterministic vectors establish no semantic accuracy or factual-confidence claim. See [S04 evidence](../../features/stages/S04-semantic-retrieval.md#verification-evidence). Generation/model selection remains S05.
