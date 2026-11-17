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

- [x] Verify compatible Tailwind/shadcn/ui/Query/form releases and add only necessary UI dependencies.
- [x] Implement same-origin proxy/client/schema parsing and public error mapping.
- [x] Build Documents upload/list/pagination/status/error/delete/reprocess flows and bounded polling/cache behavior.
- [x] Build Ask AI question/loading/answer/source/insufficient/refused/error/retry flows.
- [x] Add basic safe response headers/CSP consistent with verified Next.js behavior and local proxy policy.
- [x] Create deterministic browser tests and inspect desktop/narrow layouts and keyboard flow; update demo/setup docs.

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

- [x] Both screens support required stories with visible accessible loading/error/empty/outcome states.
- [x] Source cards show correct physical pages/sections/lines/excerpts and execute no uploaded/generated HTML.
- [x] Polling terminates appropriately and paid POST retries/submissions are controlled.
- [x] Full deterministic browser flow, proxy behavior and responsive/keyboard inspection pass without leaked secrets.

## Definition of Done

- [x] Required checks/visual observations are recorded and README/demo match the actual UI.
- [x] Update only verified S06 roadmap items; stop before S07.

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

## Verification evidence

Historical stage snapshot. Later-stage status statements below describe this stage's verification time; see the [current roadmap](../ROADMAP.md) for S00–S07 completion and limits.

Verified 2026-11-17 on Node 24.22.3 / pnpm 12.21.0. All S00–S05 routes/shared schemas and deterministic provider boundaries were present; the existing integration suite was rerun before completing dependent frontend work. No persistence, public DTO, ingestion, retrieval or generation behavior changed. S06 is complete; S07 remains unstarted.

Implemented files: `apps/web/app/{documents,ask,api}/`, root layout/navigation/styles and redirect; `components/` (task screens, source rendering, providers, activity subscription, safe errors and selected shadcn primitives); `lib/{api,proxy,forms,presentation}.ts`; `proxy.ts` for nonce CSP/security headers; Tailwind/PostCSS/shadcn configuration; unit and Playwright tests. Workspace manifests/lockfile pin compatible dependencies; `compose.yaml` supplies the exact public web Origin to the proxy. `scripts/browser-server.mjs`, `check-web-bundle.mjs` and the integration harness provide an isolated real-API/fake-AI production browser environment. README, demo, affected requirements/stories/architecture and roadmap match these changes.

| Check | Recorded result |
| --- | --- |
| `pnpm lint` | Pass: ESLint and Prettier, zero warnings |
| `pnpm typecheck` | Pass: strict API/web/shared types, generated Next routes and DOM-only shared boundary |
| `pnpm test` | Pass: existing harness checks/OpenAPI drift, 231 API tests in 11 suites; frontend client/proxy/form/source tests pass (12 after final disconnect regression) |
| `pnpm test:integration` | Pass: 71 tests in five suites using actual PostgreSQL/pgvector; fresh migrations/redeploy, schema diff/introspection, runtime privileges, lifecycle/source/citation races and deterministic REST demos |
| `pnpm test:e2e` | Pass: 10 Chromium cases across desktop 1440×1000 and narrow 390×844 against production Next.js; no retries or paid AI calls |
| `pnpm build` | Pass: all workspaces; web routes dynamically rendered for per-request script nonces |
| `docker compose up --build -d --wait` | Pass in an isolated temporary project after explicit reviewed migrations; loopback random ports and tmpfs replace retained data volumes. Documents/Ask, proxied readiness and empty-corpus ask succeed; all test containers/networks removed with `down` |
| Public bundle scan | Pass: 16 static build assets do not contain the fake provider-key canary, internal API target, test database URL or private storage root |
| Documentation links / `git diff --check` | Pass: affected relative file links resolve; no whitespace errors |

The environment's selected Docker Desktop socket was absent; `DOCKER_CONTEXT=default` used the available local daemon. Commands used the existing pinned project toolchain under `.local/s02-toolchain/bin`; the host default Node/pnpm versions were incompatible. Socket-based API tests and Docker/browser/build checks ran with the necessary execution permissions after sandbox EPERM failures. Those failed environment attempts were not counted as passes.

Browser observations and assertions: keyboard upload→ready→ask→source→confirm-delete→no-ready-evidence works at both sizes; results and citation targets receive focus, deletion returns focus to the collection, confirmation traps focus and initially selects Cancel. Screenshots of both screens at both sizes were visually inspected against `apps/web/DESIGN.md`: readable hierarchy, contrast and focus outlines; stacked narrow controls; no overlap or horizontal overflow. Screenshot outputs are reproducible under ignored `apps/web/test-results/`.

The real API exercises successful upload/ingestion/answer/delete, image-only PDF failure and manual reprocess after a transient fake embedding fault. Controlled fixtures exercise all source kinds, escaped hostile text, missing/insufficient evidence, refusal, changed evidence (409), capacity/rate guidance, safe upstream/configuration/timeout failures, cursor navigation and failed deletion/retry. Polling assertions prove two-second active polling, terminal stop, hidden/offline pause and unmount stop. API-client/proxy tests cover 204, schema rejection, safe unknown/network errors, Retry-After/request IDs, Origin/Host/target policy, bounded streamed multipart/JSON, 75-second transport allowance, disconnect cancellation and no automatic paid retry.

Refero MCP was unavailable; bundled typography/craft/accessibility references and Impeccable Operate informed the recorded direction. A focused module/security/contracts review found no unresolved S06 boundary issue.

No live OpenAI evaluation or AI-enabled Compose document demo was run. The Compose smoke used a fake key only for local readiness and an empty corpus (which skips AI); deterministic browser tests replace providers in a test module. Scripted outputs and known vectors establish workflow/contracts, not semantic relevance, factual support or universal prompt-injection protection. Other browser engines, authentication/public hosting and S07 evaluation/polish remain outside this stage.
