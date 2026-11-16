# Stage S00 — Project Setup

## Objective

Create a reproducible pnpm monorepo with strict tooling and runnable API/web shells. No document or AI features in this stage.

## Context

The repository contains planning documentation, installed project-local agent skills, and auxiliary Playwright CLI tooling, but no application workspace. Preserve these existing resources when establishing the pnpm workspace. Read [AGENTS.md](../../../AGENTS.md), including its [skill selection rules](../../../AGENTS.md#agent-skills), [scope](../../product/mvp-scope.md), [system overview](../../architecture/system-overview.md), [runtime context](../../architecture/system-context.md), and [ADR-001](../../architecture/decisions/ADR-001-technology-stack.md).

## Dependencies

No prior implementation stage. Preserve existing work if the repository has changed. Check Node/pnpm availability and read applicable repository guidance before edits.

## Scope

Workspace/tooling, app shells, shared schema foundation, environment validation/loading, liveness, setup documentation. All later features remain planned.

## Technical Requirements

Verify current stable versions and Node LTS compatibility through official release/support documentation. Record selected Node, pnpm, NestJS, Next.js, React, TypeScript, Zod, Jest, lint/format tooling and required adapters; pin direct dependencies and lockfile. Do not invent versions from planning documents. Keep only api/web/shared packages. Use Next.js App Router and a NestJS HTTP app; no business API in Next.js. Set strict TypeScript and clear workspace dependency exports.

Provide explicit root `.env` loading for `pnpm dev` and child workspace scripts; avoid implicit working-directory assumptions. Add an API config schema with staged feature requirements: liveness boots without database/AI; S01 adds readiness and database requirements. Validate supported bounds without requiring future provider secrets. Shared schemas/types must compile in browser and API without importing backend code. No database/AI SDK behavior yet.

## Implementation Tasks

- [ ] Establish workspace manifests, package manager/runtime pin, lockfile, and strict TS/lint/format configuration.
- [ ] Create NestJS bootstrap with `/api/health` and safe request/error envelope foundation.
- [ ] Create a minimal Next.js shell and shared browser-safe schema package; do not build product screens.
- [ ] Add `.env.example` placeholders and ignore `.env`, generated builds, local data and logs; never replace unrelated ignore rules.
- [ ] Define `dev`, `build`, `lint`, `typecheck`, and `test` root scripts with predictable workspace failure propagation.
- [ ] Update README with actual prerequisites/commands/version choices while keeping later workflows labeled planned.

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

- [ ] A fresh frozen-lockfile install and root quality commands succeed on the documented runtime.
- [ ] API liveness matches the envelope; app shells start at documented ports.
- [ ] Invalid config fails safely; a server secret is absent from shared/web public configuration.
- [ ] Documentation identifies which commands are now available and which remain planned.

## Definition of Done

- [ ] Deliverables and acceptance checks exist with recorded command outcomes; no business features or later-stage infrastructure were added.
- [ ] Update only verified S00 roadmap items and relevant setup/ADR version notes; stop before S01.

## Out of Scope

Database/Compose, migrations, uploads, AI integration, feature UI, authentication, deployment.

## Verification Commands

Planned commands to create and then run during this stage; not currently available:

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
