# Architecture

Excavator Manager is a multi-tenant SaaS for excavator/JCB owners: machines,
customers, operators, work-hour readings, salaries, servicing and billing. One
codebase ships as a web app (Render) and as an Android app (Capacitor).

```
 Browser / Android WebView
        │  (SWR + fetch, Idempotency-Key, expectedVersion)
        ▼
 src/proxy.ts ── CSRF (Origin / Sec-Fetch-Site) · CORS for the Android origin · request id
        ▼
 src/app/api/**/route.ts ── withApi(): request id · logging · error contract
        │   requireBusinessApi()/requireOperatorApi(): session + tenant + frozen check
        │   parseBody(zod) · rate limits (DB) · runIdempotent()
        ▼
 src/lib/services/*.ts ── business logic; every function takes businessId (+ actor)
        │   money.ts (Decimal) · audit.ts · tx.ts (locks, versions)
        ▼
 Prisma 7 + @prisma/adapter-pg ──► PostgreSQL (Supabase)
```

## Layers

| Layer | Where | Responsibility |
|---|---|---|
| UI | `src/app/(app)`, `(operator)`, `(auth)`, `src/components` | Client components. Fetch data with `useSWR` + `swrFetcher`, mutate with `apiFetch`. Types come from services via `Plain<…>`. Never imports server-only modules at runtime (ESLint rule). |
| Edge | `src/proxy.ts` | CSRF check for every state-changing `/api` request, CORS for the Android origin, request id. |
| API | `src/app/api/**` | Thin: authenticate, validate, call one service, translate the result into the standard error contract. |
| Services | `src/lib/services/**` | All business rules. Every query is scoped by `businessId` passed explicitly — never looked up by id alone. Expected failures are returned as `fail(code, message)`. |
| Cross-cutting | `src/lib/*.ts` | `money`, `audit`, `idempotency`, `rateLimit`, `csrf`, `logger`, `tx`, `pagination`, `config`. |
| Assistant | `src/lib/agent/**`, `src/components/agent/**`, `src/app/api/agent/**` | Voice/text assistant that drives the UI above as the owner. It has no database access and no API of its own for changing data: it fills the same forms, so every validation, audit entry and tenant check applies unchanged. See [assistant.md](assistant.md). |
| Data | `prisma/` | Schema + migrations (never `db push` in production). |

## The assistant

A voice and text assistant operates the app for owners who may not read
comfortably. It is a client of the layers above, not a layer beside them — it
plans a sequence of UI actions, drives real controls by `data-agent-id`, and
confirms a save only once the app's own screen shows the record. The model
chooses between registered capabilities; it never composes one. See
[assistant.md](assistant.md).

## Multi-tenancy

A *Business* is the tenant. Every table that holds business data carries
`businessId`, and **every service function takes `businessId` as an explicit
argument** that comes from the verified session (`requireBusinessApi`), never
from the request body. There is no row-level security in the database; tenant
isolation is enforced in the service layer and verified by tests that run two
tenants against each other (`tests/**`).

## Web + Android from one codebase

* **Web**: Next.js server on Render. Pages are client components fetching JSON
  from the API; the API lives in the same origin.
* **Android**: `npm run build:android` produces a **static export** that
  Capacitor bundles into the APK (`webDir: out`). The bundled UI runs from
  `https://localhost` and calls the deployed API cross-origin
  (`src/lib/api-client.ts` → `API_BASE`). That is why the session cookie is
  `SameSite=None; Secure`, why CORS is enabled for exactly that origin, and why
  CSRF is checked with Origin/Sec-Fetch-Site rather than a SameSite cookie.
  `scripts/build-android.mjs` temporarily moves `src/app/api`, `src/proxy.ts`
  and `src/instrumentation.ts` aside because static export cannot contain
  server code. `next.config.ts` only defines `headers()` for the web build.
* Consequence: **installed APKs embed an older UI** and keep calling the
  current API for months. API changes must be additive — see
  [api-conventions.md §10](api-conventions.md) and ADR-0005.

## Authentication & sessions

NextAuth v5, JWT sessions, three credential providers: owner (email/phone +
password), operator (mobile + PIN) and a support-impersonation provider that
only accepts a valid support session. The JWT carries `tokenVersion`; session
checks compare it with the database so password resets/PIN changes revoke
every existing session. See [security.md](security.md).

## Money

Postgres `NUMERIC` ⇄ `Prisma.Decimal`, ROUND_HALF_UP to 2 dp, one helper module
(`src/lib/money.ts`). JSON carries money as numbers. See ADR-0001.

## Reliability building blocks

* **Idempotent creates** (bills, payments, operator money): `Idempotency-Key`
  replays the stored response; exactly-once is enforced by a unique index
  inside the same transaction as the record (ADR-0002).
* **Row locks + CHECK constraints** around payments; `BillItem.workSessionId`
  is UNIQUE so a work session can only be billed once.
* **Optimistic concurrency**: `version` column, `expectedVersion` in PATCH bodies.
* **Append-only audit trail** (`AuditLog`, DB trigger) for every financial edit.
* **Health**: `GET /api/health` (liveness, no DB) and `GET /api/health/ready`
  (database + required config). Logs are structured JSON with request ids.
* **A hung-up client is not a 500.** When the phone loses signal mid-request,
  Node rejects the pending request with `aborted`/ECONNRESET, which reaches the
  handler looking like a server fault. `withApi` recognises that exact
  signature and answers 499 (`isClientDisconnect`), so it is logged as a
  request and not as a failure. This matters because of where the app runs: on
  a phone in a yard a dropped connection is ordinary, and counted as 500s they
  would make the error rate a measure of signal strength rather than of
  correctness. The check is deliberately narrow and runs *before* the
  database-unavailable check, which also matches ECONNRESET — a disconnect must
  never be reported to the owner as a database outage.

## Deployment

Render web service; `main` auto-deploys. Pre-deploy command:
`npx prisma migrate deploy` (optionally `&& npm run check:config -- --production`, which fails the
release on an invalid configuration; see [ci-cd.md](ci-cd.md)). Required environment variables are listed in
`.env.example`. CI (`.github/workflows/ci.yml`) must be green before deploy —
see [ci-cd.md](ci-cd.md). Android releases are cut by pushing a `v*` tag
(`release-android.yml`).

## Decisions

See `docs/adr/`.
