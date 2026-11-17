# Product documentation

S00–S06 implement workspace tooling, API liveness/readiness/configuration, the two-screen web interface, local Prisma/PostgreSQL/pgvector infrastructure, private document management and source-aware ingestion with embeddings and reprocessing. S04 adds exact cosine search with profile/run/document filters and stored source locations. S05 adds structured question answering with admitted evidence, server-created citations and explicit insufficiency/refusal/errors. S06 implements Documents and Ask AI with a same-origin proxy and deterministic browser checks; live semantic quality is unmeasured. Missing AI configuration leaves uploads pending and readiness unavailable. These documents describe the intended local MVP and the evidence required to call it complete.

- [Product vision](product-vision.md): problem, users, value, core journey.
- [Requirements](requirements.md): traceable functional/non-functional requirements.
- [User stories](user-stories.md): measurable acceptance criteria.
- [MVP scope](mvp-scope.md): explicit boundaries and optional future backlog.
- [Success criteria](success-criteria.md): observable completion evidence.
- [Demo scenarios](demo-scenarios.md): reproducible demonstrations and limitations.

Implementation follows the [roadmap](../features/ROADMAP.md). Transport/schema details live in [architecture](../architecture/README.md), not separate product-specific DTO definitions.

S07 adds the original Orion corpus, offline/opt-in capped live evaluation, human review records and fresh-setup/regression evidence. See [S07 verification](../features/stages/S07-testing-and-polish.md#verification-evidence). Live semantic quality and cutoff calibration remain unmeasured.
