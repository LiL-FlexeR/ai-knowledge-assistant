# Demo scenarios

S07 supplies the original [Orion corpus and E01–E12 harness](../../apps/api/evaluation/README.md). The six scenarios below have deterministic evidence from the offline pipeline, real PostgreSQL/API integration and production-browser checks. Live semantic quality is unmeasured; expected model answers remain acceptance targets. No private uploads or paid AI were used. [S07 evidence](../features/stages/S07-testing-and-polish.md#verification-evidence) records the environment, commands and limitations.

| Scenario | Recorded deterministic observation |
| --- | --- |
| 1. Setup/processing | Fresh Compose build/migration/health/readiness/two pages/restart passes; offline HTTP uploads all four Orion documents and verifies six ready chunks, original lines/headings and physical PDF pages 1/2 |
| 2. Answers/references | E01 and E05 return scripted statements with server-mapped Maintenance/Recovery/page-2 sources; browser keyboard source inspection passes |
| 3. Missing/ambiguous/conflicting | E07/E08 abstain, E09 asks for clarification, E10 includes both ranges; these outputs are scripted, not live judgments |
| 4. Failure/retry | Integration curl rejects unsupported/oversize uploads, scanned PDF fails safely; transient fake embedding failure recovers through reprocess; desktop browser demonstrates the confirmation/error/retry flow |
| 5. Untrusted source | E11 admits injection.md but scripted output uses Maintenance; E12 returns an explicit fake-provider refusal; separate production prompt/schema tests verify boundaries, not live injection resistance |
| 6. Deletion/repeatability | Offline deletes handbook through HTTP, verifies no handbook chunks/hits, scripts insufficiency for its target; final corpus deletion leaves no chunks and an empty ask skips AI. Concurrent deletion/reprocess/rebuild races also pass integration |

The [offline report](../../apps/api/evaluation/reports/offline-2026-11-17.json) preserves actual per-case mechanics. The [live record](../../apps/api/evaluation/reports/live-2026-11-17.json) is not_run: explicit paid opt-in/configuration was absent. Source-support review is N/A because no live answer ran; it cannot be inferred from the scripted answers.

## Verified deterministic S06 browser demo

Run `pnpm --filter @aka/web exec playwright install chromium` once and `pnpm test:e2e` with Docker available. The harness starts an isolated PostgreSQL/pgvector database, applies reviewed migrations, overrides only AI providers in the real Nest app, builds production Next.js and uses its actual same-origin proxy. No private `.env` or paid AI calls are used.

1. In Documents, upload a synthetic Markdown file containing `# Maintenance` and `Maintenance is Sunday at 02:00 UTC.`. Wait for ready while its row is visible.
2. Navigate to Ask AI and submit “When is maintenance?”. Inspect `[S1]` using the keyboard: the source names Maintenance, original lines 1–3 and its escaped excerpt. This scripted answer proves workflow/citation mechanics, not semantic accuracy.
3. Return to Documents, confirm deletion, and ask again. Observe “No ready documents”.
4. Upload the existing image-only `apps/api/test/fixtures/scanned.pdf`: observe failed/NO_EXTRACTABLE_TEXT. The desktop test also uploads a transient-failure TXT, confirms the reprocess cost/unavailability explanation, reprocesses to ready and deletes it.
5. Controlled route fixtures show physical PDF pages, Markdown headings/lines and TXT lines; insufficient relevance/evidence, refusal, 409 changed evidence, 429 Retry-After, safe upstream/configuration/timeout errors, failed cleanup and cursor pages. Hostile HTML is displayed as text. Polling tests cover terminal, hidden, offline and unmounted states.

Both Chromium projects (1440×1000 and 390×844) verify the keyboard workflow, result/source focus, no horizontal overflow and no page errors in the real journey. Screenshot outputs are under ignored `apps/web/test-results/`. [S06 evidence](../features/stages/S06-frontend.md#verification-evidence) records verification and limits.

## Orion scenarios (live outcomes not measured)

The committed files are under `apps/api/evaluation/fixtures/`. Run `pnpm eval:offline` for the recorded mechanics; an AI-enabled browser demonstration or semantic judgment requires the separately configured paid run. The expectations below remain live targets.

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
