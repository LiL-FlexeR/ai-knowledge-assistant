# User stories

All stories are planned; acceptance requires observable behavior plus tests from the owning stage. Refer to [contracts](../architecture/api-contracts.md) for exact schemas/status codes.

## US-01 — Upload a supported document (S02)

As a user, I want to upload a PDF, TXT, or Markdown file so I can ask about its contents.

- [ ] A valid supported file within 10 MiB returns 201 with a generated ID, canonical MIME, size, filename, and pending state.
- [ ] The original is stored under an API-generated private path; duplicate display names do not overwrite files.
- [ ] Empty text, invalid UTF-8/binary text, unsupported/conflicting format, oversize, and capacity failures return the specified error without a retained metadata row or staging leak.

## US-02 — Inspect processing (S03/S06)

As a user, I want to see when a file is searchable and why processing failed.

- [ ] Documents show pending/processing/ready/failed/deleting with the current safe error and no invented completion percentage.
- [ ] A valid multi-page text PDF becomes ready with chunks referencing its actual physical pages.
- [ ] Scanned-only, encrypted/unsupported, empty, limit-exceeding, and provider-failing inputs reach an actionable failed state without searchable partial chunks.
- [ ] Polling stops for terminal states and does not continue indefinitely after navigation.

## US-03 — Manage my corpus (S02/S06)

As a user, I want to browse and delete documents so obsolete content stops influencing answers.

- [ ] Cursor pagination yields no duplicates in a stable dataset; detail returns the same document shape.
- [ ] Delete hides evidence before cleanup, then returns 204 only after file/chunk/metadata removal; repeating it is safe.
- [ ] A failed cleanup is visible and can be retried; deleting during ingestion cannot recreate the index.

## US-04 — Search semantically (S04)

As an API user, I want relevant passages even when I phrase the question differently from the document.

- [ ] Search returns at most requested topK ranked hits, with filename, excerpt, and real page/section locations.
- [ ] Document filters, active profile, and ready-state rules are enforced in actual pgvector queries.
- [ ] Empty corpus or no accepted hits returns a successful insufficient-context response; provider failure returns an error.

## US-05 — Ask with evidence (S05/S06)

As a user, I want answers with inspectable references so I can check their support.

- [ ] Every returned factual statement references at least one admitted chunk ID through a server-created citation map.
- [ ] PDF references show physical pages; TXT/Markdown show document/section/lines without page inventions.
- [ ] Unknown citation IDs and malformed/truncated generation fail safely; provider output cannot set file locations.
- [ ] Multiple-section and conflicting-evidence examples show appropriate references and evidence limitations.

## US-06 — Understand missing evidence (S05/S06)

As a user, I want an explicit limitation when the documents cannot answer my question.

- [ ] Empty or irrelevant evidence skips generation and displays insufficient information.
- [ ] Ambiguous or unsupported questions do not receive fabricated factual answers; the limitation explains the gap or asks for clarification.
- [ ] Refusals, upstream failures, and insufficient evidence appear as distinct outcomes with an appropriate user retry only for failures.

## US-07 — Retry ingestion (S03/S06)

As a user, I want to reprocess a ready or failed document after fixing configuration or a transient problem.

- [ ] Explicit reprocess warns of AI cost, returns 202/pending, clears old searchable data, and creates a fresh fenced run.
- [ ] Pending/processing/deleting documents return 409; missing originals return the documented error.
- [ ] Restart marks interrupted work failed and permits manual retry without duplicating chunks.

## US-08 — Run and verify locally (S00/S01/S07)

As a developer, I want reproducible setup and checks so I can demonstrate and maintain the application.

- [ ] A fresh documented setup starts local services, applies migrations, and passes liveness/readiness without public port binding.
- [ ] Deterministic tests need no OpenAI key and use actual pgvector when vector behavior matters.
- [ ] Live evaluation is opt-in with recorded models/configuration/usage and honest pass/failure notes; no evaluation scores are claimed before running it.
