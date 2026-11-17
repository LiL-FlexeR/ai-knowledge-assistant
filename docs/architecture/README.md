# Architecture guide

These documents specify target behavior. S00–S02 implement the workspace, liveness/readiness/configuration/error foundation, minimal web shell, local Compose runtime, Prisma/pgvector persistence primitives, and private document upload/list/detail/delete with compensated cleanup. Ingestion and RAG runtime behavior remain planned; uploads stay pending. The [generated OpenAPI](openapi.json) describes implemented routes only.

| Document | Owns |
| --- | --- |
| [System overview](system-overview.md) | Modules, configuration defaults, invariants |
| [System context](system-context.md) | Actors, trust boundaries, local runtime topology |
| [Data model](data-model.md) | Schema, state transitions, atomic publication and cleanup |
| [RAG pipeline](rag-pipeline.md) | Extraction, chunking, vectors, context, grounding, cost |
| [API contracts](api-contracts.md) | Requests, responses, validation, error codes |
| [Security](security.md) | Local MVP controls, privacy, reliability limitations |
| [Testing strategy](testing-strategy.md) | Deterministic checks and measured AI evaluation |

Accepted decisions: [ADR-001 stack](decisions/ADR-001-technology-stack.md), [ADR-002 RAG](decisions/ADR-002-rag-design.md), [ADR-003 storage](decisions/ADR-003-data-storage.md). Each record distinguishes selected behavior from the portions implemented and verified; acceptance alone is not completion evidence.

Read [product requirements](../product/requirements.md) for user outcomes and [the roadmap](../features/ROADMAP.md) for execution order. Public contracts take precedence over illustrative examples; changes require updating their consumers and relevant stage documents together.
