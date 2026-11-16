# Stage S06 — Frontend

## Objective

Deliver minimal Documents and Ask AI screens supporting the complete local workflow and all API outcome states.

## Context

Read [user stories](../../product/user-stories.md), [demo](../../product/demo-scenarios.md), [API contracts](../../architecture/api-contracts.md), [runtime proxy](../../architecture/system-context.md), and [security](../../architecture/security.md). Keep UI simple: shadcn/ui, Tailwind, readable typography, no complex dashboard or unnecessary animation.

Follow the [UI skill routing rules](../../../AGENTS.md#agent-skills) for Refero research, Impeccable's task-oriented `Operate` workflow, implementation guidance, and browser verification within this stage's scope.

## Dependencies

S00–S05 complete: stable shared public schemas; upload/list/detail/delete/reprocess/search/ask contracts; source validation; configured API; deterministic fake-provider profile for tests. Stop if required routes are missing instead of building a fake product as completion.

## Scope

Typed API client, server-side same-origin proxy, two screens/navigation, form validation, remote-state/polling management, source cards, responsive accessibility, safe rendering, and deterministic browser workflow tests.

## Technical Requirements

Use TanStack Query for server data/cache invalidation, React Hook Form/Zod for question/upload forms, and browser-safe shared DTOs. The browser calls relative `/api` URLs; the Next.js proxy streams bounded uploads and preserves API status/envelopes/request IDs with a 75-second ask transport allowance. No key, database URL, storage path, or internal proxy target in public bundles.

Documents show filename/type/size/status/error and cursor pagination. Upload progress may indicate transfer state but must not invent ingestion percentages. Poll only visible pending/processing/deleting documents at 2-second intervals, stop on ready/failed/unmount, and use backoff/pause when hidden/offline. Show an explicit delete confirmation and a reprocess cost/unavailability explanation; these are product controls, not an agent permission flow. Successful mutations invalidate affected lists/detail; avoid optimistic ready/deleted claims before server success.

Ask AI displays answer statements with their validated citation links and source cards; physical page versus section/line labels follow source kind. Display all distinct insufficient/refused/error outcomes, loading/submission prevention, clear retry, and safe error correlation IDs. Render source/model text as escaped React text; no raw HTML or model URLs. No persisted chat history/localStorage of document/answer content in MVP. Provide provider-processing/local-only disclosure before use, keyboard focus, labels, status live regions, error association, sensible contrast, and narrow viewport layout.

## Implementation Tasks

- [ ] Verify compatible Tailwind/shadcn/ui/Query/form releases and add only necessary UI dependencies.
- [ ] Implement same-origin proxy/client/schema parsing and public error mapping.
- [ ] Build Documents upload/list/pagination/status/error/delete/reprocess flows and bounded polling/cache behavior.
- [ ] Build Ask AI question/loading/answer/source/insufficient/refused/error/retry flows.
- [ ] Add basic safe response headers/CSP consistent with verified Next.js behavior and local proxy policy.
- [ ] Create deterministic browser tests and inspect desktop/narrow layouts and keyboard flow; update demo/setup docs.

## Expected Files and Modules

`apps/web/app/documents/`, `apps/web/app/ask/`, layout/navigation; focused UI/components/hooks/API client; Next.js proxy configuration appropriate for the verified version; test setup/browser scenarios. Shared package changes only for documented public schema gaps.

## API Contracts

Consume existing endpoints without redefining business behavior in Next.js. Search-only UI is not required. Handle 204 with no JSON parse, 409 evidence changes/busy/capacity, 429 Retry-After, safe 5xx, and all successful ask statuses. Preserve server request IDs.

## Database Changes

Not applicable. Frontend has no database access and creates no history/user tables.

## Error Handling

Show field errors near inputs and operation errors near the affected action. Retain failed document rows/errors for manual action. Avoid duplicate paid submissions and automatic ask/reprocess retries. Distinguish network/proxy failure from insufficient evidence. React Query retry policies must not multiply paid POST calls; mutations are explicitly retried by the user.

## Testing Requirements

Test API client schema/error/204 behavior, form bounds, source labels and hostile-text escaping. Browser tests use the real API/test database with fake provider (or controlled route fixtures for isolated rendering cases) to cover upload→ready→ask→source→delete, failed ingestion/reprocess, pagination, empty/insufficient/refused/error and changed-evidence states. Verify multipart/proxy timeouts/Origin policy, no secret in build output, keyboard focus and desktop/narrow visual layout. Use a verified browser test tool; normal runs incur no AI cost.

## Acceptance Criteria

- [ ] Both screens support required stories with visible accessible loading/error/empty/outcome states.
- [ ] Source cards show correct physical pages/sections/lines/excerpts and execute no uploaded/generated HTML.
- [ ] Polling terminates appropriately and paid POST retries/submissions are controlled.
- [ ] Full deterministic browser flow, proxy behavior and responsive/keyboard inspection pass without leaked secrets.

## Definition of Done

- [ ] Required checks/visual observations are recorded and README/demo match the actual UI.
- [ ] Update only verified S06 roadmap items; stop before S07.

## Out of Scope

Authentication, dashboards/analytics, standalone search page, rich PDF viewer, animations, streaming, history, collaboration, deployment.

## Verification Commands

Add `test:e2e` in this stage using the pinned browser test tooling:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
docker compose up --build
```

Record actual browser/viewport/keyboard observations plus commands/results. Full Compose AI demo is cost-bearing; deterministic browser checks use fake provider configuration.

## Demo Scenario

Perform the [document→ask→source→delete journey](../../product/demo-scenarios.md) in the browser, then show failed ingestion, missing evidence, refusal and upstream error using deterministic scenarios. Explain local-only and external text-processing limits.
