# Stage S00 — Project Setup

## Objective

Create a reproducible pnpm monorepo with strict tooling and runnable API/web shells. No document or AI features in this stage.

## Context

Before S00, the repository contained planning documentation, installed project-local agent skills, and auxiliary Playwright CLI tooling, but no application workspace. S00 preserves those skills and the pinned CLI dependency while replacing tracked dependency-install output with a pnpm lockfile. Read [AGENTS.md](../../../AGENTS.md), including its [skill selection rules](../../../AGENTS.md#agent-skills), [scope](../../product/mvp-scope.md), [system overview](../../architecture/system-overview.md), [runtime context](../../architecture/system-context.md), and [ADR-001](../../architecture/decisions/ADR-001-technology-stack.md).

## Dependencies

No prior implementation stage. Preserve existing work if the repository has changed. Check Node/pnpm availability and read applicable repository guidance before edits.

## Scope

Workspace/tooling, app shells, shared schema foundation, environment validation/loading, liveness, setup documentation. All later features remain planned.

## Technical Requirements

Verify current stable versions and Node LTS compatibility through official release/support documentation. Record selected Node, pnpm, NestJS, Next.js, React, TypeScript, Zod, Jest, lint/format tooling and required adapters; pin direct dependencies and lockfile. Do not invent versions from planning documents. Keep only api/web/shared packages. Use Next.js App Router and a NestJS HTTP app; no business API in Next.js. Set strict TypeScript and clear workspace dependency exports.

Provide explicit root `.env` loading for `pnpm dev` and child workspace scripts; avoid implicit working-directory assumptions. Add an API config schema with staged feature requirements: liveness boots without database/AI; S01 adds readiness and database requirements. Validate supported bounds without requiring future provider secrets. Shared schemas/types must compile in browser and API without importing backend code. No database/AI SDK behavior yet.

## Implementation Tasks

- [x] Establish workspace manifests, package manager/runtime pin, lockfile, and strict TS/lint/format configuration.
- [x] Create NestJS bootstrap with `/api/health` and safe request/error envelope foundation.
- [x] Create a minimal Next.js shell and shared browser-safe schema package; do not build product screens.
- [x] Add `.env.example` placeholders and ignore `.env`, generated builds, local data and logs; never replace unrelated ignore rules.
- [x] Define `dev`, `build`, `lint`, `typecheck`, and `test` root scripts with predictable workspace failure propagation.
- [x] Update README with actual prerequisites/commands/version choices while keeping later workflows labeled planned.

## Expected Files and Modules

Root `package.json`, `pnpm-workspace.yaml`, lockfile, runtime pin/configuration, `.env.example`, ignore/tooling files; `apps/api/src/main.ts`, app/config/health foundation; `apps/web/app/` shell; `packages/shared/src/` and exports. Exact config filenames may follow the verified tool versions.

## API Contracts

Implement only `GET /api/health`: 200 success envelope with `{status: "ok"}` and server request ID, as [specified](../../architecture/api-contracts.md). Unknown routes/errors have the common safe envelope. No readiness/document/search/ask route claimed yet.

## Database Changes

Not applicable. No Prisma schema/migrations or database dependency until S01.

## Error Handling

Malformed environment produces an actionable startup error with variable names and no secret values. Liveness requires no paid calls. Build/test failures must propagate a nonzero exit status.

## Testing Requirements

Use Jest for API liveness/response envelope and meaningful environment-boundary tests. Verify strict compilation, shared browser-safe imports, lint, and builds. Do not add tautological shell-render tests merely for coverage.

## Acceptance Criteria

- [x] A fresh frozen-lockfile install and root quality commands succeed on the documented runtime.
- [x] API liveness matches the envelope; app shells start at documented ports.
- [x] Invalid config fails safely; a server secret is absent from shared/web public configuration.
- [x] Documentation identifies which commands are now available and which remain planned.

## Definition of Done

- [x] Deliverables and acceptance checks exist with recorded command outcomes; no business features or later-stage infrastructure were added.
- [x] Update only verified S00 roadmap items and relevant setup/ADR version notes; stop before S01.

## Out of Scope

Database/Compose, migrations, uploads, AI integration, feature UI, authentication, deployment.

## Verification Commands

Implemented commands (use the pinned runtime):

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev
curl -i http://localhost:3001/api/health
```

Run dev/smoke checks separately from terminating quality commands; stop owned processes after inspection. Append actual outcomes and unavailable checks here on implementation.

## Demo Scenario

Start both shells, open localhost:3000, and call API liveness. Show a safe invalid-config error in an isolated test. Explain that upload/RAG and database readiness are not implemented yet.

## Verification evidence

Completed 2026-11-16 on Linux with Node.js **24.22.3** and pnpm **12.21.0**. The host initially supplied Node 24.16.0/pnpm 11.25.0; checks used the pinned toolchain installed under `/tmp/aka-s00-toolchain`, prepended to `PATH`. [ADR-001](../../architecture/decisions/ADR-001-technology-stack.md#s00-version-verification) records release/support sources, exact versions, peer constraints, and tooling caveats.

| Check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed in `/tmp/aka-s00-fresh`, copied without `node_modules`, `.next`, or `dist`; 669 locked packages installed with strict peers |
| `pnpm lint` | Passed in working checkout and clean-install copy; ESLint with zero warnings and Prettier code/tooling checks |
| `pnpm typecheck` | Passed in both; strict API/test/shared/web compilation, generated Next route types, DOM-only shared import check with no Node types and declaration checking enabled |
| `pnpm test` | Passed in both; **3 suites, 36 tests**; no database, provider SDK, or paid calls |
| `pnpm build` | Passed in both; shared declarations/JS, Nest API JS, optimized Next shell |
| `pnpm dev` | Correctly returned nonzero and stopped siblings when the pre-existing service on port 3000 caused `EADDRINUSE` |
| `PORT=3100 WEB_ORIGIN=http://localhost:3100 pnpm dev` | Passed; shared/API watchers, API on loopback 3001 and web on loopback 3100; owned processes stopped with Ctrl-C |
| `curl -i http://localhost:3001/api/health` | HTTP 200; `{"data":{"status":"ok"},"requestId":"<UUID>"}` and identical `X-Request-Id` |
| Web shell request to `http://127.0.0.1:3100/` | HTTP 200; heading, S00 shell label, and planned-feature text checked in the HTML |
| `API_PORT=invalid-secret-canary OPENAI_API_KEY=s00-private-canary pnpm --filter @aka/api start` | Expected exit 1; reported only `API_PORT` and setup guidance, with neither canary value in output |
| Clean build with server-only canary key/database URL | Passed; scanned all **158** web build files and found no server-secret canary; shared source has no environment/backend imports |

The tests cover liveness envelopes, per-request server UUIDs despite a supplied client ID, unknown/future-route 404s, redacted unexpected errors, malformed JSON, 16-KiB body bounds, valid `.env.example`, numeric/cross-field/local-origin/path bounds, secret-safe configuration diagnostics, and explicit root environment loading from a child workspace with shell precedence and nonzero exit propagation. No shell-render coverage tests were added.

Environment notes: sandbox DNS blocked initial npm metadata queries; package queries/installation succeeded with approved network access. Process-launch tests and Next's TypeScript build subprocess initially failed under sandbox restrictions, then passed outside that sandbox. Port 3000 belonged to an existing service and was left untouched; the documented web-port override was used. No required S00 check remains unavailable. ESLint 9 is an upstream-deprecated compatibility pin for Next's current lint peers; Jest emits its documented experimental VM-module warning. pnpm's optional Playwright skill-approval notice does not prevent installation; project-installed skills were unchanged.

Changed files: root workspace/runtime/tooling manifests, `pnpm-lock.yaml`, `.env.example`, ignore/format files, `scripts/with-env.mjs`; `apps/api` configuration/health/HTTP/bootstrap plus three test suites; `apps/web` App Router shell, browser-contract compilation fixture, and Next-generated `AGENTS.md`; `packages/shared` public schemas/types. Setup/status notes were synchronized in root README/AGENTS, product/architecture guides, requirements, system context/overview, testing strategy, ADR-001, this stage, and the roadmap. npm's old lockfile and 196 tracked generated dependency files were removed from version control; dependencies remain installable and on disk, and the existing CLI is retained at 0.1.24.

Architecture review found no S00 module-boundary or scope violations. No Compose, Prisma/schema/migrations, readiness, document routes, AI adapters, proxy, or product screens were added. **S00 is complete; S01–S07 remain unchecked and implementation stopped before S01.**
