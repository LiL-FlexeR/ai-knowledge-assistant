# Observable MVP success criteria

These are completion gates; checked entries have linked evidence and make no numerical performance claim. Link implementation/test evidence when stages finish; leave the checkboxes unchecked until verified.

- [ ] SC-01: Fresh setup follows README with pinned tooling/environment and starts database/API/web locally; migrations and health/readiness pass (S00/S01/S07).
- [ ] SC-02: PDF, TXT, and Markdown fixtures upload with correct metadata/private originals; invalid/oversize/capacity cases fail safely (FR-01, US-01, S02).
- [ ] SC-03: Valid documents reach ready; text is chunked/embedded with actual page/section/line spans; scanned/invalid/provider-failing files leave no partial index (FR-03–05, US-02, S03).
- [x] SC-04: Real pgvector integration proves compatible vector storage, cosine ordering, ready/profile/document filters, and empty-evidence behavior (FR-06, US-04, [S04 evidence](../features/stages/S04-semantic-retrieval.md#verification-evidence)); known vectors do not measure semantic quality.
- [ ] SC-05: Questions yield an answer with valid server-owned source mappings or a clear insufficient/refused/error outcome; invalid provider references cannot escape validation (FR-07, US-05/06, S05).
- [ ] SC-06: Both screens support the complete upload→processing→ask→inspect-source→delete journey with keyboard-usable feedback and safe source rendering (FR-08, S06).
- [ ] SC-07: Deletion/reprocessing/interruption tests demonstrate cleanup, stale-run fencing, and no resurrected evidence (FR-02/05, S02/S03/S05).
- [ ] SC-08: Unit, database/API integration, and browser checks cover critical workflows without paid AI; required checks pass or unresolved failures are stated (NFR-06, S07).
- [ ] SC-09: The synthetic evaluation harness reports retrieval/citation/grounding/abstention definitions, configuration, denominators, and observed results only; live AI evaluation is explicitly run or explicitly recorded as unavailable (S07).
- [ ] SC-10: README/demo/security documentation matches behavior, discloses external AI processing and local-only limitations, and roadmap completion includes verification evidence (S07).

A recorded live-evaluation omission must not be described as passing model quality. Do not claim accuracy percentages, deployment maturity, user counts, or latency figures without evidence. See [testing strategy](../architecture/testing-strategy.md) for release evidence and known-failure handling.
