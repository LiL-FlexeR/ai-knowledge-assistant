# Demo scenarios

S06 implements the browser workflow. The deterministic journey below is verified; the later Orion scenarios are live-evaluation targets for S07, not recorded model-quality results. S05 adds deterministic HTTP answer tests for single/multi-source answers, conflicts, ambiguity, injection, refusal, invalid references and deletion/reprocess races; these use scripted outputs and establish no live semantic-quality result. S03 provides a verified REST-only processing demo through `pnpm test:integration`: synthetic TXT/two-page PDF/Markdown to ready, physical source pages, image-only failure, explicit reprocess after a fake-provider fault, and delete during processing without resurrected evidence. S04 extends it with actual curl search, Markdown source metadata, PDF-only filtering, and unrelated/empty-corpus outcomes. This demo uses separate CC0 fixtures and deterministic vectors; it does not measure semantic quality. Use the fictional corpus and gold facts in [testing strategy](../architecture/testing-strategy.md). Never use private uploads for a public portfolio demo. Record the actual environment/models and observed behavior; expected answers here are acceptance targets, not recorded results.

## Verified deterministic S06 browser demo

Run `pnpm --filter @aka/web exec playwright install chromium` once and `pnpm test:e2e` with Docker available. The harness starts an isolated PostgreSQL/pgvector database, applies reviewed migrations, overrides only AI providers in the real Nest app, builds production Next.js and uses its actual same-origin proxy. No private `.env` or paid AI calls are used.

1. In Documents, upload a synthetic Markdown file containing `# Maintenance` and `Maintenance is Sunday at 02:00 UTC.`. Wait for ready while its row is visible.
2. Navigate to Ask AI and submit “When is maintenance?”. Inspect `[S1]` using the keyboard: the source names Maintenance, original lines 1–3 and its escaped excerpt. This scripted answer proves workflow/citation mechanics, not semantic accuracy.
3. Return to Documents, confirm deletion, and ask again. Observe “No ready documents”.
4. Upload the existing image-only `apps/api/test/fixtures/scanned.pdf`: observe failed/NO_EXTRACTABLE_TEXT. The desktop test also uploads a transient-failure TXT, confirms the reprocess cost/unavailability explanation, reprocesses to ready and deletes it.
5. Controlled route fixtures show physical PDF pages, Markdown headings/lines and TXT lines; insufficient relevance/evidence, refusal, 409 changed evidence, 429 Retry-After, safe upstream/configuration/timeout errors, failed cleanup and cursor pages. Hostile HTML is displayed as text. Polling tests cover terminal, hidden, offline and unmounted states.

Both Chromium projects (1440×1000 and 390×844) verify the keyboard workflow, result/source focus, no horizontal overflow and no page errors in the real journey. Screenshot outputs are under ignored `apps/web/test-results/`. [S06 evidence](../features/stages/S06-frontend.md#verification-evidence) records verification and limits.

## Live target scenarios (S07; not measured)

The following gold Orion cases require the S07 corpus/evaluation harness and an explicit paid run. Existing S03 fixtures support the deterministic demo above; these target names/facts do not claim that S07 files already exist.

### 1. Setup and document processing

For an explicit live run, follow README setup, check liveness/readiness, and open Documents. Upload `operations.md`, the two-page `handbook.pdf`, and `notice.txt`. Show pending/processing/ready states and file details. Confirm handbook citations preserve physical pages. Mention local runtime, external OpenAI text processing, supported limits, and no OCR.

### 2. Grounded answer and references

Ask “When is the Orion maintenance window?” Expect Sunday at 02:00 UTC with a Maintenance source excerpt. Open the source card and inspect its section/lines. Ask “Who owns recovery and what is its target duration?” Expect Mira Chen and four hours with references to the Recovery section and handbook page 2. Verify statement/citation correspondence instead of claiming the model is always correct.

### 3. Missing, ambiguous, and conflicting information

Ask for Orion's subscription price: expect insufficient information. Ask “When is it available?” without a referent: expect a clarification limitation. Ask about support hours: expect both conflicting handbook/notice ranges, with their sources and no unsupported supersession claim. Record a quality failure honestly if the live model does not meet the expectation.

### 4. Transparent failures and retry

Upload an oversize/unsupported file and show the immediate validation error. Upload a scanned-only PDF fixture and show `NO_EXTRACTABLE_TEXT` after processing. In a deterministic demo/test profile simulate a provider timeout; show a safe error and manual reprocess after recovery. Explain reprocessing can incur AI costs and removes the previous searchable generation temporarily. Do not modify real credentials to manufacture a demo failure.

### 5. Untrusted document content

Include `injection.md` and repeat the maintenance question. The expected result still uses operational evidence; the model must not reveal secrets or perform actions. Show that no tools are connected and inspect the evaluation result. Do not claim this proves universal prompt-injection protection.

### 6. Deletion and repeatability

Delete the handbook, confirm its original/chunks/metadata are removed through integration evidence, and repeat the target-duration question with only remaining sources. Expect insufficient evidence for the deleted target. A previously displayed excerpt may remain in browser memory; deletion does not retract already delivered data. Finish with deterministic checks and an explicitly opt-in live evaluation report, showing actual results and limitations.
