---
name: documentation-sync
description: Synchronize AI Knowledge Assistant product, architecture, API, stage, roadmap, and README documentation after an implemented or explicitly proposed behavior change, updating only affected sections.
---

# Synchronize affected documentation

Read [AGENTS.md](../../../AGENTS.md), the requested change or implementation evidence, and relevant entries in the [product guide](../../../docs/product/README.md), [architecture guide](../../../docs/architecture/README.md), and [roadmap](../../../docs/features/ROADMAP.md).

1. Identify what actually changed and what is still proposed. Inspect code/tests when implementation accuracy matters; never infer completed behavior from a plan.
2. Trace affected requirements/stories/success criteria, canonical API/data/RAG specifications, ADRs, stage tasks, README setup/commands, and demo steps. Read only affected documents.
3. Update the smallest necessary sections and relative links. Public DTOs belong in API contracts, lifecycle in data model, configuration in system overview, and evaluation definitions in testing strategy; avoid divergent copies.
4. Record material architectural or product-scope changes explicitly with rationale, consequences and affected acceptance criteria. Do not silently expand scope or create infrastructure to match aspirational prose. If intent conflicts with observed behavior, describe the gap and preserve the requested scope until resolved.
5. Check roadmap boxes only when implementation and required verification support completion. Keep planned commands/features labeled planned; unavailable tests/live evaluation are not passes.
6. Verify local links/anchors, file references, stage dependencies, API examples, profile/dimension settings, limits, state names, and skill frontmatter where touched.

Report updated files, corrected discrepancies, verification performed and unresolved questions. Do not execute application stages, paid evaluation, or unrelated rewrites merely to synchronize documents.
