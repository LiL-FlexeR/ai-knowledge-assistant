---
name: implement-roadmap-stage
description: Implement one explicitly requested AI Knowledge Assistant roadmap stage S00–S07, verify its deliverables, and update its completion evidence without advancing to other stages.
---

# Implement one roadmap stage

Use this for a request to execute a stage in this repository, not for documentation initialization or an unrelated fix.

1. Identify the requested stage in [ROADMAP](../../../docs/features/ROADMAP.md). If no stage is specified and scope cannot be inferred, identify the first incomplete stage and resolve the intended scope before dependent implementation.
2. Read [AGENTS.md](../../../AGENTS.md), the stage specification linked from the roadmap, relevant product requirements, and only the architecture documents needed for its boundaries/contracts.
3. Inspect current code and verify prerequisite deliverables/checks. If a dependency is incomplete, stop dependent work and report the exact gap. Do not invent earlier-stage substitutes or mark prerequisites complete from prose alone.
4. Implement only the requested stage, following its acceptance criteria. Verify/pin current stable dependencies when introduced; keep public schemas aligned with the API contract and vector behavior aligned with the data model.
5. Add the stage's meaningful unit/integration/error tests. Use fake AI in deterministic tests and real PostgreSQL/pgvector when vector behavior matters. Do not invoke paid evaluation implicitly.
6. Run the stage's verification commands that now exist. Record actual outcomes and environmental blockers; an unrun command is not a pass.
7. Update affected documentation and stage verification evidence. Check roadmap items only for implemented, verified deliverables. A partly implemented stage remains incomplete.
8. Report functionality, changed files, commands/results, remaining issues, and roadmap status. Stop before the next stage unless the user explicitly requested it too.

Public DTOs are owned by [API contracts](../../../docs/architecture/api-contracts.md), persistence/lifecycle by [data model](../../../docs/architecture/data-model.md), and grounding/configuration by [RAG pipeline](../../../docs/architecture/rag-pipeline.md) and [system overview](../../../docs/architecture/system-overview.md). Resolve contradictions explicitly rather than redesigning silently.
