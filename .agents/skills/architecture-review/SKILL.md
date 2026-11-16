---
name: architecture-review
description: Review proposed or implemented AI Knowledge Assistant changes for concrete violations of its module boundaries, lifecycle, security, contracts, and accepted architectural decisions.
---

# Review architectural consistency

Read [AGENTS.md](../../../AGENTS.md), the change/diff, its stage, and relevant sections of the [architecture guide](../../../docs/architecture/README.md). Review only the scope needed for the request; do not rewrite the architecture or product scope as part of a review.

Trace the affected data flow and check:

- Controllers delegate business rules to owning application services; cross-module calls use explicit exports; shared schemas contain no server infrastructure.
- Prisma/raw vector SQL stays in focused API infrastructure, binds values safely, and matches the pinned version and vector dimensions/profile.
- Ingestion publishes a complete generation atomically; run fencing, reprocess invalidation, and compensated deletion/restart cleanup preserve invariants.
- Local originals use generated contained paths; API keys stay server-side; document/model output stays untrusted; MVP exposure remains loopback-only.
- Errors, deadlines, retries, admission/resource limits, and usage accounting are explicit rather than hidden or multiplied.
- Dependencies/abstractions serve current requirements; future auth/queues/providers/cloud infrastructure are not added speculatively.
- Tests and public contracts demonstrate modified behavior and error cases; documentation/ADRs describe material changes accurately.

Return actionable findings ordered by impact, each with a precise file/line or proposed-design section, concrete failure scenario, violated contract/decision, and smallest practical correction. Separate confirmed defects from unresolved questions. State when there are no findings and identify material unverified behavior. Do not demand hypothetical enterprise features outside [MVP scope](../../../docs/product/mvp-scope.md). Apply fixes only when the user's request includes them.
