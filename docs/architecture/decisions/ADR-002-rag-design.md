# ADR-002 — RAG Architecture

## Status

Accepted for planning, 2026-11-16. Quality settings are initial hypotheses to evaluate after implementation.

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
