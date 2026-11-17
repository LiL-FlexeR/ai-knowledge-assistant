# Stage S05 — AI Question Answering

## Objective

Generate concise evidence-bound answers with validated source identities, explicit insufficiency/refusal, and bounded provider use.

## Context

Read [RAG context/prompt/validation design](../../architecture/rag-pipeline.md), [ask contract](../../architecture/api-contracts.md), [security](../../architecture/security.md), [evaluation cases](../../architecture/testing-strategy.md), and [US-05/06](../../product/user-stories.md). Citation identity checks do not prove claim support.

## Dependencies

S00–S04 complete: working source-preserving retrieval and filters, real vector tests, common AI/config/retry infrastructure, safe errors, and shared DTOs. Stop if evidence cannot be mapped reliably.

## Scope

Chat application service/controller, context assembly, versioned grounded prompt, GroundedAnswerClient/OpenAI Responses adapter, output validation/public formatting, cited-run consistency check, and usage/deadline handling. No streaming/history/tools.

## Technical Requirements

Verify a stable OpenAI Responses generation model with structured-output support, adequate context/output budget, available account access, and compatible tokenizer. Record exact chosen model and checks in ADR-002/environment docs; do not invent a current default or substitute an unsupported model silently. Reuse shared AI semaphore/retry policy, with one generation call before eligible transport retries.

Build context from retrieved complete spans with deduplication/overlap policy and 4000 evidence-token cap. Assign S1... labels only after context admission; include trusted file/location metadata as data alongside untrusted text. Validate total prompt plus 800 output-token reservation against model limits. Structured generation returns statements/sourceIds/status/limitation; server validates and constructs public citations/answer. No model-provided location fields or external tools. Set the whole 65-second ask deadline across embedding, wait/backoff and generation. Recheck cited document run/status/profile before returning; a concurrent deletion/reprocess yields 409.

## Implementation Tasks

- [x] Add shared ask/statement/citation/status/usage schemas with examples and exact invariant validation.
- [x] Implement deterministic context selection, immutable source map, prompt version and untrusted-evidence serialization.
- [x] Add small generation boundary/OpenAI adapter with output-token cap, refusal/incomplete mapping, usage and shared retry/deadline control.
- [x] Validate output status/statements/source membership, construct answer/citations from server evidence, and recheck source generations.
- [x] Add thin ask endpoint with no-evidence short circuits, rate limits and safe explicit failure outcomes.
- [x] Record the chosen model/tokenizer/cost/context checks and keep quality claims limited to observed evidence.

## Expected Files and Modules

API `modules/chat/` service/controller/context/prompt/citation validator; generation interface/adapter under `modules/ai/`; shared ask DTOs; fake structured outputs and grounding/injection fixtures. No generic agent or provider registry.

## API Contracts

Implement POST `/api/chat/ask` with [AskResponse](../../architecture/api-contracts.md): answered, insufficient_context, and refused are distinct 200 states; validation/upstream/timeout/profile errors remain errors; source changes return 409. Every factual statement in answered has ≥1 admitted source ID. Invalid/truncated/unknown-ID output returns 502 without an automatic repair generation call.

## Database Changes

None. Read source runs for final consistency check; do not persist questions, answers, or history. Existing Document/DocumentChunk suffice.

## Error Handling

No ready documents/no relevant hits skips generation and explains insufficiency. Provider refusal is separate from missing evidence; incomplete structured output is invalid, never displayed partially. Abort at whole deadline and report safe retryable transport errors; do not turn timeouts into a claim that documents lack evidence. Never log document/question/provider response content.

## Testing Requirements

Unit context token limits, deduplication/overlap, source admission, prompt data serialization, statement/citation validation, server formatting, output caps and deadlines. Deterministic API/integration tests cover grounded single/multi-section answers, unsupported and ambiguous questions, conflicting passages, source prompt injection, refusal, malformed/truncated/uncited/unknown-ID output, no-evidence skipped generation, timeout/retry bounds and deletion/reprocess races. Assert no tools/actions are wired. Live semantic quality remains an explicit S07 evaluation, not proven by scripted fake outputs.

## Acceptance Criteria

- [x] Every returned citation resolves to an admitted unchanged stored span; every answered statement has a valid reference.
- [x] Empty evidence, model insufficiency, refusal, invalid output and upstream faults follow distinct public outcomes.
- [x] Context/output/deadline/call-count bounds hold and stale evidence returns 409.
- [x] Generation configuration is verified/documented and deterministic checks pass without paid AI.

## Definition of Done

- [x] Required checks and optional live-smoke status are recorded; output validation and semantic-quality limitations are explicit.
- [x] Update only verified S05 roadmap items; stop before S06.

## Out of Scope

Streaming, conversation memory, tools/agents, automatic output repair loops, additional providers, frontend, advanced retrieval.

## Verification Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
curl -i -H 'Content-Type: application/json' -d '{"question":"When is the Orion maintenance window?"}' http://localhost:3001/api/chat/ask
```

Curl is an optional configured-provider smoke against synthetic indexed data; deterministic checks use fake AI. Record model/settings and actual outcomes, or explicitly state no live call was run.

## Demo Scenario

Ask the synthetic maintenance and multi-section recovery questions, inspect server-mapped references, then demonstrate missing evidence and an invalid-citation fake response. Explain that valid references still need support/groundedness evaluation.

## Verification evidence

Implemented and verified on 2026-11-17. S00–S04 prerequisites were verified before implementation: 62 real PostgreSQL/pgvector integration tests, fresh/repeated migrations, introspection/schema checks and both existing REST demos passed. Complete retrieval rows resolved to persisted source spans; no prerequisite deliverable was missing.

### Delivered behavior and changed files

- `apps/api/src/modules/chat/{chat.module,chat.controller,chat.service,ask-admission.guard,context,answer}.ts`: thin JSON ask endpoint; separate local socket rate window; deterministic complete-span admission, duplicate/>50% overlap suppression, immutable source map and IDs assigned after admission. Prompt version `grounded-answer-v1` serializes question, untrusted content and source metadata as data, outside system instructions. Structured statements/status/source membership are validated; server-created citations and deterministic markers expose only used evidence, in context order. Empty/no-relevant context skips generation; lowered budgets with no fitting span also skip generation. Insufficiency, refusal, invalid output, transport/configuration/profile/storage failures and changed evidence remain distinct.
- `apps/api/src/modules/ai/{grounded-answer-client,openai-grounded-answer-client,generation-request,generation-model,generation-tokens,ai-request,ai.module,openai-embedding-client}.ts`: small Responses boundary using the existing pinned SDK; strict output schema, reasoning `none`, 800-token cap, refusal/incomplete/model/output validation, no tools/history/streaming, `store: false`, and no output-repair loop. Embedding and generation share the extracted existing retry policy and outbound capacity. SDK retries are disabled; at most two eligible transport retries fit within the caller deadline. Safe diagnostics record provider/model/request ID, usage, attempts and latency without question/source/provider content.
- `apps/api/src/modules/retrieval/{retrieval.service,vector-reader}.ts`: complete internal rows include processing run IDs and embedding usage; the public search response is unchanged. A single final read rechecks only cited ready documents against original runs and configured profile/model/dimensions/pipeline. DELETE, reprocess and a new ready generation invalidate old evidence with 409; database faults stay 503. No transaction spans a provider call, and no database migration or new dependency is needed.
- `packages/shared/src/index.ts`, `scripts/generate-openapi.mjs`, `docs/architecture/openapi.json`: browser-safe strict ask/statement/citation/status/usage contracts, cross-field invariants, deterministic public formatting and all ask outcome/error examples. Source locations and excerpts remain server-owned. The generator validates its ask examples; normal tests check generated contract drift.
- `apps/api/src/{app.module,config/environment,health/readiness.service}.ts`, `.env.example`, `compose.yaml`: chat wiring, exact reviewed generation snapshot, separate downward-configurable ask rate limit, and explicit model forwarding to Compose. Full readiness requires key and reviewed model but makes no paid/access probe; ingestion/search still work without generation configuration. Liveness and document management remain available without AI.
- `apps/api/test/{chat.spec,generation.spec,chat.integration}.ts` and `fixtures/{chat-evidence,fake-grounded-answer-client,fake-embedding-client}.ts`: deterministic context/prompt/statement/citation/status/output-cap/deadline/admission tests and actual stored-span/race coverage. Existing readiness/database/search/HTTP tests were updated for the new model setting/internal run field; `fixtures/README.md` documents scripted evidence. PDF/TXT/Markdown citations trace to exact canonical spans. API cases cover supported/multi-section answers, unsupported/ambiguous questions, conflicting accounts, injection data, refusal and malformed/truncated/unknown/excluded references without automatic regeneration.
- Affected AGENTS/README, product guide/requirements/story/success/demo records, architecture contracts/data model/config/RAG/security/testing, ADR-002 and roadmap now describe implemented S05 behavior and remaining S06/S07 work. No frontend files, schema, migrations, dependency versions or lockfile were changed.

### Model and budget checks

The reviewed snapshot is **`gpt-5.4-mini-2026-03-17`**, with **`o200k_base`** tokenization and **reasoning `none`**. Public Responses/structured-output capability, context/input/output limits, current price observations, SDK compatibility and tokenizer mapping are recorded with official references in [ADR-002](../../architecture/decisions/ADR-002-rag-design.md#s05-generation-model-and-implementation). Embeddings retain their original `cl100k_base` policy/profile/dimensions. No model fallback is allowed.

Evidence admits at most 4000 generation tokens in complete spans. The full serialized request (including schema, instructions, question, metadata and wrappers) plus a conservative 1024-token framing allowance must fit the 272000-token input limit, and input plus the 800-token output reservation must fit the 400000-token context window. These local estimates are not billed usage. One question embedding and at most one generation occur before eligible transport retries; a 65000-ms deadline spans retrieval, generation/backoff and the final consistency read. Output is never partially displayed. Provider output usage is nullable; raw output token counts are also checked when usage is absent.

### Commands and results

Checks used the repository’s pinned **Node 24.22.3**, **pnpm 12.21.0**, existing packages and PostgreSQL **18.7** / pgvector **0.8.7** integration image. The default shell exposed Node 24.16.0/pnpm 11.25.0; exact tooling was installed under `/tmp/aka-s05-runtime`, without changing manifests or lockfile. Commands used that directory’s `node_modules/.bin` on PATH. Docker used `DOCKER_HOST=unix:///var/run/docker.sock` because the configured Docker Desktop socket was absent.

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed ESLint and Prettier. |
| `pnpm typecheck` | Passed strict shared/API/web compilation and browser-safe shared import check. |
| `pnpm test` | Passed 3 test-target guard checks and 231 API/unit tests in 11 suites; generated OpenAPI matched shared schemas. No paid calls. |
| `pnpm test:integration` | Passed 71 tests in 5 suites using actual PostgreSQL/pgvector and fake AI. Fresh/repeated migrations, introspection, before/after schema diff, both existing curl REST demos and owned cleanup passed. |
| `pnpm build` | Passed shared/API compilation and Next.js production compilation/static generation. |
| `docker compose --env-file .env.example config --quiet` | Passed with synthetic password/model environment values; no resolved secrets printed. |
| `git diff --check` and changed-document relative-link validation | Passed. |
| Optional configured-provider ask curl/live smoke | **Not run:** no OpenAI key is configured. Account-specific access, billed usage, real latency and answer quality remain unverified; no fallback or paid request was attempted. Deterministic ask HTTP tests use fake AI. |

Sandboxed HTTP/worker checks initially hit EPERM; the permitted tests passed. The sandboxed Next.js build failed to read its TypeScript `--showConfig` subprocess output; the permitted build passed. These were execution restrictions, not omitted checks. The integration harness created only its own disposable targets and removed its container/network/storage.

### Review and remaining limitations

Architecture/RAG review traced supported originals → canonical spans → compatible embeddings → ready/current-run retrieval → context admission → structured statements → server-created citations → final consistency check. No unresolved module/lifecycle/reference-contract defect was found in the implemented scope. Valid references prove identity only: scripted fake answers do not establish factual support, real ambiguity/conflict handling, semantic relevance or injection resistance. A model may still cite an irrelevant admitted passage or repeat malicious content. The 0.30 retrieval cutoff remains provisional; S07 owns measured evaluation. `store: false` is not a provider retention guarantee. Account-specific generation access remains unverified without credentials.

**S05 is complete with deterministic verification and the optional live-smoke omission disclosed. S06 and S07 remain unchecked and unimplemented.** No product screen, streaming/history/tools, additional provider, advanced retrieval or evaluation infrastructure was added.
