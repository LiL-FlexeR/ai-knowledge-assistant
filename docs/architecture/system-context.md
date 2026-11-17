# System context

## Actors and boundaries

The single local user supplies documents and questions through a browser. Uploaded content, filenames, browser requests, and model output are all untrusted. The browser sees public DTOs and source excerpts only. The API holds filesystem permissions, database credentials, and the OpenAI key. OpenAI receives selected text and questions, not local file access.

```text
Local browser
    │ localhost:3000 (same-origin /api calls)
    ▼
Next.js ── server-side /api proxy ──► NestJS API
                                       ├──► PostgreSQL + pgvector
                                       ├──► private originals volume
                                       └──► OpenAI HTTPS API
```

The proxy forwards `/api/...` unchanged, preserves status/error bodies and request IDs, streams bounded multipart bodies, and supports the ask deadline plus a small transport margin (75 seconds). No Next.js business-logic API duplicate. Reject unexpected origins on mutating API calls; do not enable wildcard CORS. Direct CLI requests without an Origin remain allowed on this local-only API.

## Local runtime

Compose services are `db`, `api`, and `web`. Publish web 3000, API 3001, and optional development database 5432 on `127.0.0.1` only. API/web bind their container interfaces internally. Only `api` mounts `/data/documents`; PostgreSQL uses a separate named data volume. API connects to `db:5432`; web connects to `api:3001` internally. The browser never resolves container service names.

S00 host development runs API/web shells through `pnpm dev`, bound to loopback. Dev/start commands explicitly load root `.env` relative to the launcher file, including filtered child workspace commands; shell variables take precedence. `PORT` overrides web port 3000 and `API_PORT` overrides API port 3001. S06 implements the proxy as a Node route handler: only known `/api` paths and a local `http` target are allowed; the exact configured `WEB_ORIGIN` Host is required. Forwarded identity headers and cookies are not relayed. Multipart is streamed with a 10-MiB file plus 64-KiB framing ceiling; other bodies are limited to 16 KiB. Transport/disconnects cancel upstream work, and local proxy errors have safe correlation IDs. S01 supplies database startup through `pnpm infra:up`; use `127.0.0.1` in the host database URL and proxy target. Compose supplies container DNS URLs, while only the explicit tools-profile migration container receives privileged credentials. See the [host/container setup](../../README.md#local-setup). No anonymous volumes that hide application sources unexpectedly.

Readiness checks database connectivity, vector extension/dimension compatibility, and storage writability. They check required AI configuration locally, not by spending money on a provider call. Liveness is independent of provider/database outages. Apply migrations explicitly before serving a new schema; do not race migrations across application instances. Only one API instance and ingestion runner are supported.

## Failures and privacy

An interrupted ingestion run becomes failed on startup, with an explicit manual reprocess action. Pending work resumes; deleting work is reconciled. Provider outages do not remove originals or leak partially indexed content. See [data lifecycle](data-model.md).

Local hosting does not mean local AI inference. Inform the user before upload/ask that textual content is sent to the configured provider; do not claim zero retention. Review current provider data policies before using sensitive material. Database, volumes, backups, excerpts, and browser memory all contain user data. Public hosting requires authentication, TLS, access controls, and a separate threat review, outside MVP.
