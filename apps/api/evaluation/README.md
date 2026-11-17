# Orion evaluation

This test-only area runs the existing production ingestion, pgvector retrieval,
context, answer validation and deletion code in an owned temporary database and
storage root. It adds no API endpoint or production fake mode. Docker and the
repository's pinned Node/pnpm versions are required. No private root `.env` is
loaded. Normal test/build/CI commands never invoke paid evaluation.

```bash
pnpm eval:offline
```

`corpus.mjs` owns original CC0 fictional passages, logical gold span IDs and all
E01–E12 questions/outcomes/rubrics. Committed `fixtures/handbook.pdf` is generated
by `node apps/api/evaluation/corpus.mjs`: deterministic PDF 1.7, Helvetica 9pt,
Letter pages, support on physical page 1 and recovery target on page 2, with no
clock-dependent metadata. The same command regenerates TXT/Markdown. Fixtures
are excluded from formatting because original lines are evidence. A byte hash
check rejects drift. Production extraction must find each exact unique passage
in its expected unit/page/heading/original lines before any case can run.

Gold is independent of chunk UUIDs and sizes: exact text locates UTF-16 spans
inside canonical source units after ingestion. Reports save those resolved spans,
intersecting chunk IDs and source maps. Coverage requires the union of retrieved
intersections to cover the entire gold span, rather than rewarding a one-character
overlap. E05/E10 need two spans and have a separate multi-span denominator.

Offline embeddings are identical nonzero basis vectors; topK=10 deliberately
admits all six corpus chunks. Answers are scripted from the gold cases. Successful
offline recall/status/citation checks establish harness mechanics only. They say
nothing about semantic ranking, factual quality or live injection resistance.
Additional regressions check PDF filtering, Unicode, invalid citation rejection,
below-cutoff vectors, handbook deletion and final empty-corpus AI short-circuit.
The normal integration suite owns malformed/scanned PDFs, source-deleted-mid-ask,
restart/reprocess races and compensation. Browser checks own keyboard/source
inspection, plain-text escaping, responsive layout and proxy contracts.

## Explicit live run

The following command spends money. Export a server-side `OPENAI_API_KEY` through
your normal private environment, copy `live-config.example.json` to an ignored
local path, review the caps and verify the linked current prices. Do not put a key
in the config or command history. Then deliberately invoke:

```bash
AKA_EVAL_ALLOW_PAID=yes AKA_EVAL_CONFIG=/absolute/private/live-config.json pnpm eval:live
```

Both launch and worker validate opt-in/configuration. Missing key/configuration
or an unreviewed price date stops before creating a database or calling OpenAI.
Pricing must have been reviewed within seven days; copying a newer date without
checking prices is not verification. Rates were verified on 2026-11-17 against
[text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small)
and [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini): USD
0.02 embedding input, 0.75 generation input, 4.50 generation output per million
tokens, standard public endpoint. No cached-input discount is assumed. If prices
change, review the schema/rate constants and tests before a paid run.

The example caps are 12 cases, 28 provider requests including four ingestion
requests, 300 seconds, 800 output tokens and USD 3 in cumulative reservations.
Every embedding batch reserves 8192 tokens per input; every generation reserves
the reviewed 272000-input-token application bound and the configured output cap.
Reservations are retained even when a request fails. Both application and SDK
retries are disabled. Case/request/cost/deadline limits never silently expand;
the example may stop early if a cap is reached. Provider calls share the normal
capacity/deadline boundaries. Unknown or above-bound usage terminates the run.
This is a conservative estimated ceiling, not a provider billing guarantee.

Only the production AI boundaries change in live mode. All synthetic documents
are ingested anew through HTTP; asks call the production ChatService directly to
avoid the UI's 10/minute request bucket. Separate API/browser suites verify routes.
No tools/history/streaming, `store:false`, and the pinned model/prompt/settings
remain unchanged. Account access is established only by a successful paid call.

## Reports and human review

Ignored `results/{offline,live}-latest.json` is checkpointed before paid calls and
after cases; partial records retain a safe termination reason. A launcher setup
failure also produces a terminated/not_run record. `core.mjs` exports strict
Zod `reportSchema` (`evaluation-report-v1`) and `liveConfigSchema`; malformed
reports/configuration fail visibly. Committed reports contain synthetic data only.
The process stores no credentials, database URLs or private document text in a
report. Abrupt process/OS termination can leave a `running` checkpoint; it is not a
pass. The parent harness still owns target cleanup on ordinary child failures.

Metadata records corpus/harness hashes, commit, runtime, models/profile/dimensions,
tokenizers, pipeline/prompt, topK/cutoff/chunk/context/output settings and retries.
Each case retains question/rubric, retrieved scores/spans, admitted evidence,
statements, server citations, usage and elapsed time. `calls` includes corpus
embedding usage too. `reservedUsd` is an estimate; `actualKnownUsd` prices reported
tokens, with `usageComplete=false` when failed calls may have unknown usage. It is
not an invoice. Repeated runs are separate observations, not averaged benchmarks.

All measures retain numerator, denominator and nullable value. Zero denominator
means N/A. Automated status equality is only a contract observation. Citation
identity counts emitted server citation mappings that resolve to admitted,
unchanged stored spans. Human retrieval precision, citation support and
groundedness remain 0/0/N/A until reviewed. E09/E10/E11/E12 retain individual
ambiguity/conflict/injection rubrics; no aggregate accuracy score is emitted.

For each live case, segment every factual statement into claims, label all
retrieved chunks, judge every claim/source pair and each claim's support, and
record an explicit special-case judgment where applicable. `review.mjs` exports
strict `judgmentsSchema`: top-level `reportSha256`, `reviewer`, `reviewedAt`,
`cases`; each case has `id`, `notes`, `retrievalLabels` (`chunkId`, `relevant`),
`claims` (`id`, `statementIndex`, `text`, `verdict`: supported/unsupported/
contradicted/unverifiable), `pairs` (`claimId`, `sourceId`, `supported`, `notes`),
and nullable `special` (`passed`, `notes`). Statement indices are zero-based.
The hash binds the exact source report bytes. Import judgments with:

```bash
pnpm eval:review /absolute/path/live-latest.json /absolute/path/judgments.json
```

The command writes a new `.reviewed.json` without overwriting the source.
Incomplete/foreign/duplicate labels are rejected. Support is scored independently
from valid IDs; failed and unverifiable judgments stay visible. Every curated
live case that ran needs review before release, including abstentions/errors.
An unavailable live run is **not run**, never a quality pass. See the
[S07 evidence](../../../docs/features/stages/S07-testing-and-polish.md#verification-evidence).
