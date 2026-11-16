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

- [ ] Add shared ask/statement/citation/status/usage schemas with examples and exact invariant validation.
- [ ] Implement deterministic context selection, immutable source map, prompt version and untrusted-evidence serialization.
- [ ] Add small generation boundary/OpenAI adapter with output-token cap, refusal/incomplete mapping, usage and shared retry/deadline control.
- [ ] Validate output status/statements/source membership, construct answer/citations from server evidence, and recheck source generations.
- [ ] Add thin ask endpoint with no-evidence short circuits, rate limits and safe explicit failure outcomes.
- [ ] Record the chosen model/tokenizer/cost/context checks and keep quality claims limited to observed evidence.

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

- [ ] Every returned citation resolves to an admitted unchanged stored span; every answered statement has a valid reference.
- [ ] Empty evidence, model insufficiency, refusal, invalid output and upstream faults follow distinct public outcomes.
- [ ] Context/output/deadline/call-count bounds hold and stale evidence returns 409.
- [ ] Generation configuration is verified/documented and deterministic checks pass without paid AI.

## Definition of Done

- [ ] Required checks and optional live-smoke status are recorded; output validation and semantic-quality limitations are explicit.
- [ ] Update only verified S05 roadmap items; stop before S06.

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
