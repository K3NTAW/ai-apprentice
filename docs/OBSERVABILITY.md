# Observability

Server logs are structured JSON, one object per line. The code is in `src/lib/log`.

## Log line format

Every call to `log.info|warn|error(event, fields?)` writes one line:

```json
{"ts":"2026-10-06T20:15:50.123Z","level":"error","event":"cron retention","error":"...","requestId":"3f0c..."}
```

| Field | Meaning |
| --- | --- |
| `ts` | ISO 8601 time in UTC |
| `level` | `info`, `warn` or `error`. `info` goes to stdout, `warn` and `error` to stderr |
| `event` | Short, fixed name of what happened |
| `requestId` | Present when the line was written during an API request |
| other keys | The caller's fields |

`ts`, `level`, `event` and `requestId` are set by the logger. A field with one of those names is dropped.

## Request lines

Every API request writes exactly one line with `event: "request"`:

```json
{"ts":"...","level":"info","event":"request","route":"/api/session/[id]","method":"GET","status":200,"ms":42,"requestId":"3f0c...","workspace":"9a1b2c3d4e5f6a7b"}
```

| Field | Meaning |
| --- | --- |
| `route` | Route template, e.g. `/api/session/[id]` (never the concrete path) |
| `method` | HTTP method |
| `status` | Response status |
| `ms` | Handler time in milliseconds |
| `requestId` | See below |
| `workspace` | Hashed workspace id, only once the request context is known |
| `thrown` | `true` when the handler threw. The line has status 500 and level `error`; the error is rethrown unchanged |

Responses with status 500 or more are logged at level `error`.

Routes that use `withApi` or `withMutation` (`src/app/api/session/_http.ts`) get the line from there, including the
early return from `requireContext` (401, 403, 503). Every other route exports its handler wrapped in
`withRequestLog(route, handler)`. `src/app/api/console.guard.test.ts` fails when a route handler is wrapped by
neither, or when a non-test file under `src/app/api` uses `console.warn` or `console.error`.

### Request id

The `x-request-id` request header is used when it matches `^[A-Za-z0-9_-]{1,64}$`. Otherwise a random UUID is used.
Lines written with `log.*` while the request runs carry the same id, so one request can be followed across lines.

## Redaction and hashing

Logged values can come from untrusted input.

- Every string value in the caller's fields, nested ones included, goes through the sync PII redaction in
  `src/lib/redact` (emails, phone numbers, IBANs, card numbers, titled names become `<TYPE>` placeholders).
- Errors are logged as `{name, message, stack}`, each redacted.
- Circular references become `"[Circular]"`, values nested more than 6 levels deep `"[Truncated]"`. Functions are dropped.
- The workspace id is never logged in clear. `workspace` is the first 16 hex characters of
  `sha256(salt + ":" + workspaceId)`. The salt is `FORWARDED_USER_SECRET`, else `SUPABASE_SERVICE_ROLE_KEY`, and is
  never logged. Without either (local mode) the field is the fixed marker `"local"`, never an unsalted hash.
- The user id, cookies, auth headers and request bodies are not logged.

## Reading logs on Vercel

1. Vercel dashboard, project, **Logs** (runtime logs). Filter by the function path, e.g. `/api/session`.
2. Search for a request id to see every line of one request, e.g. `3f0c...`.
3. Search `"event":"request"` with `"status":5` or `"thrown":true` to find failed requests.
4. CLI: `vercel logs <deployment-url>` streams the same lines. Pipe through `jq` to filter, e.g.
   `vercel logs <url> --json | jq -r '.message' | jq 'select(.event=="request" and .status>=500)'`.

To match a hashed `workspace` value to a workspace, compute the same hash locally with the production salt. Do not
paste the salt into tickets or chats.

## Sentry

Server only, nodejs runtime only, thrown errors and handled 500s only. Off unless `SENTRY_DSN` is set.

### Setup

- Set `SENTRY_DSN` in the Vercel project. Empty or unset means Sentry is off: `src/instrumentation.ts` imports nothing.
- `environment` comes from `VERCEL_ENV` (`development` when unset). `release` comes from `VERCEL_GIT_COMMIT_SHA` (unset when missing).
- A human creates the Sentry org in the EU region (ingest host `*.ingest.de.sentry.io`) and copies the DSN.
- Init is in `src/lib/observability/sentryServer.ts`: `dataCollection` fully off, `tracesSampleRate: 0`, `sendClientReports: false`, no logs integration, no replay, no profiling. Server sessions are off: the `ProcessSession` integration is filtered out and `Http` is re-created with `sessions: false`.

### What is sent

- Every event goes through the `beforeSend` allowlist in `src/lib/observability/beforeSend.ts`: `event_id`, `timestamp`, `level`, `platform`, `environment`, `release`, `message`, `exception` (type, value, mechanism, frames), tags `route` and `runtime`, and `request.method`. Everything else is dropped: user, extra, contexts, breadcrumbs, other tags.
- The request url, headers, cookies, query string and body are never sent.
- Redaction of `message` and exception values is regex-based and best effort. Personal data in an unusual format can get through.
- `dataCollection` is fully off: every field (user info, cookies, headers, bodies, query params, GraphQL, gen AI, database query data, queues, stack frame variables, context lines) is set to its most restrictive value. In 11.4.0 each of these collects by default.
- The SDK appends an `sdk` block after `beforeSend` (SDK name, version, integration names, package versions). The scrubber cannot remove it. With `dataCollection` off, `sdk.settings.infer_ip` is absent or `never`. The envelope header still carries the SDK name and the DSN.

### What is captured

- Errors thrown from routes, through `onRequestError` in `src/instrumentation.ts`, tagged with the route pattern and `runtime: nodejs`. After each capture it flushes for at most 2 s so the event leaves before a serverless function freezes. The hook never rejects and never logs the error.
- Handled 500s: a route that returns status 500 (for example `store_context_required` from `handle()` in `src/app/api/session/_http.ts`). The outermost request line in `src/lib/log` calls `captureHandled500` (`src/lib/observability/capture.ts`) right after the line is written: one `captureMessage("handled 500")` at level `error`, tagged with the route, then a flush of at most 2 s. A nested `logRequest` (`withApi` under `withRequestLog`) never captures, so each request is captured once. A throw is never captured here; `onRequestError` owns it. The SDK is imported only when `SENTRY_DSN` is set, and a failed import, SDK throw or flush timeout is swallowed: the response and the request line are the same either way.
- NOT captured: 4xx responses (400, 401, 403, 404, 409), 502 and 503 (expected states such as an unapplied migration or `supabase_not_configured`), errors in `src/proxy.ts` and any edge runtime, React render errors.
- Delivery on Vercel is unverified until the org exists.

### Browser

- Set `NEXT_PUBLIC_SENTRY_DSN` in the Vercel project. Empty or unset means the browser loads no Sentry code: `src/instrumentation-client.ts` checks the literal `process.env.NEXT_PUBLIC_SENTRY_DSN`, which Next inlines at build time, and only then imports `src/lib/observability/sentryClient.ts`. A failed import is swallowed.
- Init uses the same `beforeSend` allowlist as the server, `dataCollection` fully off (11.4.0 has no `sendDefaultPii` or `enableLogs`), `tracesSampleRate: 0`, `sendClientReports: false` and a `beforeSendTransaction` that drops every transaction. `environment` comes from `NEXT_PUBLIC_VERCEL_ENV`, `release` from `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`. The default `BrowserSession` and `BrowserTracing` integrations are removed through `integrations`. No replay, no profiling.
- Captured: uncaught window errors and unhandled promise rejections, from the moment the import resolves.
- NOT captured: React render errors (needs `src/app/global-error.tsx`, a known gap), errors thrown before the import resolves.
- Manual check: on a deployed preview, run `setTimeout(() => { throw new Error("sentry browser check") })` in the browser console and look for the event in Sentry.
- Rollback: the client DSN is baked into the bundle at build time. Unset `NEXT_PUBLIC_SENTRY_DSN` AND rebuild (redeploy without build cache); unsetting alone changes nothing.

### Smoke check

- `npm run sentry:smoke` sends one real event: it inits the server SDK, captures one exception and expects `flush(5000)` to resolve `true`. It needs `SENTRY_DSN` in the shell; without it, or without `SENTRY_SMOKE=1` (set by the script), `src/lib/observability/smoke.live.test.ts` is skipped, so a plain `npm test` never sends anything.

### Stack traces

Minified. `next.config.ts` has no `withSentryConfig`, so there is no source-map upload yet.

### Rollback

- Fast: unset `SENTRY_DSN` in Vercel and redeploy.
- Full removal: `git revert` this task's merge commit. That also reverts `package-lock.json`.
- `vercel.json` has only crons and no CSP today. If a CSP is added, allow the ingest host `o<org>.ingest.de.sentry.io` in `connect-src`.
