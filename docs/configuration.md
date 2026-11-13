# Configuration register

Every environment variable the repository reads, with what it is for, whether it is required, how it is validated, how to rotate it, and which file reads it, so that a missing or exposed setting can be found without reading the code.

Method and limits: the variable names, defaults and validation below were established by reading `src/`, `scripts/`, `.github/`, `android/app/build.gradle`, `next.config.ts`, `prisma.config.ts`, `capacitor.config.ts`, `tests/setup.ts` and the installed `next-auth` / `@auth/core` sources. Nothing was executed. **Real Render, Supabase, GitHub and Resend settings, plans, people and production values cannot be seen from the repository: they are marked UNVERIFIED (owner to fill in).** No `.env` file was read.

Terms: **Render** = the web service's environment variables (documented as the home of production values in [operations.md](operations.md) and [runbook-recovery.md](runbook-recovery.md); which variables are actually set there is UNVERIFIED). **checkConfig** = `checkConfig()` in `src/lib/config-check.ts`, the single validator used by the startup log (`src/instrumentation.ts`), the readiness probe (`/api/health/ready`) and `npm run check:config` (`scripts/check-config.mjs`). It reports variable names and the nature of the problem, never a value.

## 1. Application variables (set by the operator)

Local values live in a git-ignored `.env` (`.gitignore` ignores `.env*` except `.env.example`).

| Variable | Purpose | Required dev / prod | Sensitive | Set where | Default | Validation | Read by |
|---|---|---|---|---|---|---|---|
| `DATABASE_URL` | Postgres connection for the app pool; also the Prisma CLI's connection when `MIGRATE_DATABASE_URL` is unset | yes / yes | **Yes** (embeds the password) | local `.env`; Render | none | checkConfig: **error** if unset or not a `postgres:` / `postgresql:` URL. Scheme only; reachability is the readiness `SELECT 1` | `src/lib/db.ts`, `src/lib/config-check.ts`, `prisma.config.ts`, `scripts/audit-integrity.mjs`; fallback in `scripts/test-migrations.mjs`, `scripts/restore-drill.mjs` |
| `MIGRATE_DATABASE_URL` | Optional schema-owner connection used only by the Prisma CLI (pre-deploy `migrate deploy`), so `DATABASE_URL` can be a least-privilege role ([security.md](security.md) section 15) | no / no | **Yes** | local `.env`; Render only if the least-privilege setup is adopted (UNVERIFIED) | falls back to `DATABASE_URL` (an empty string also falls back) | not validated | `prisma.config.ts` only. The app never reads it; the scripts blank it |
| `SHADOW_DATABASE_URL` | Scratch database for `prisma migrate dev` and the CI drift check | no / no | **Yes** (credentials) | local `.env`; literal in `.github/workflows/ci.yml` | none | not validated | `prisma.config.ts` |
| `DB_POOL_MAX` | Maximum pooled connections | no / no | No | local `.env`; Render | 10; above 12 is clamped to 12; non-integer or below 1 becomes 10 | checkConfig: **warning** if set and not a positive integer. A value above 12 is clamped silently | `src/lib/db.ts`, `src/lib/config-check.ts` |
| `AUTH_SECRET` | Key material for the encrypted session JWT (via Auth.js); fallback key for operator join codes | yes / yes | **Yes** | local `.env`; Render | none (`tests/setup.ts` supplies a test literal) | checkConfig: **error** if unset, a placeholder (`replace-me`, `changeme`, `change-me`, `secret`, `password`, case-insensitive) or under 16 characters; **warning** under 32. Length only, not entropy | read by `next-auth` inside `NextAuth()` (`src/lib/auth.ts` has no direct read); `src/lib/services/operators.ts` (fallback); `src/lib/config-check.ts` |
| `AUTH_SECRET_PREVIOUS` | OPTIONAL. The PREVIOUS `AUTH_SECRET`, kept for at most the session lifetime (30 days) while rotating, so existing sessions keep working (section 8.2) | no / no | **Yes** | Render only, temporarily | unset | checkConfig: warns if set but equal to `AUTH_SECRET` (nothing to roll) | `src/lib/auth-secrets.ts` |
| `JOIN_CODE_SECRET` | HMAC key for operator join verification codes | no / recommended | **Yes** | local `.env`; Render | falls back to `AUTH_SECRET` | checkConfig, production only: **warning** if unset; **warning** if equal to `AUTH_SECRET`. No length or placeholder check | `src/lib/services/operators.ts` (`hashJoinCode`), `src/lib/config-check.ts` |
| `SUPPORT_ACCESS_PASSWORD` | Shared password of the hidden `/support` console | no / no | **Yes** | local `.env`; Render | unset = console disabled (login answers 404) | checkConfig: **warning** if set, production, and under 12 characters | `src/app/api/support/login/route.ts`, `src/lib/config-check.ts` |
| `APP_URL` | Public base URL of this deployment: password-reset links are built from it; trusted origin for the CSRF check | no / **yes** | No | local `.env`; Render | dev: `http://localhost:3000` (from `appUrl()`); production: none (`appUrl()` throws when it is needed) | checkConfig, production only: **error** if unset or not `https:`. Not validated in dev | `src/lib/config.ts` (`appUrl`, `trustedOrigins`), `src/lib/config-check.ts` |
| `ALLOWED_ORIGINS` | Extra comma-separated origins allowed to make state-changing requests (for example the `onrender.com` URL beside a custom domain) | no / no | No | local `.env`; Render | empty | checkConfig: **warning** naming the variable if any entry is not an `http:` / `https:` URL (first bad entry only). `config.ts` silently drops invalid entries | `src/lib/config.ts`, `src/lib/config-check.ts` |
| `TRUSTED_PROXY_HOPS` | Number of proxies appending to `X-Forwarded-For`; picks the client IP used as the rate-limit key | no / no (must match the real proxy chain) | No (security-relevant) | local `.env`; Render | 1 | checkConfig: **warning** if set and not an integer 0-5 (the code then uses 1) | `src/lib/config.ts`, `src/lib/config-check.ts` |
| `RESEND_API_KEY` | Resend API key for the password-reset e-mail (the only e-mail the app sends) | no / **yes in practice** (reset mail fails without it) | **Yes** | local `.env`; Render | none | checkConfig, production only: **warning** if unset. Presence only, not format | `src/lib/email.ts`, `src/lib/config-check.ts` |
| `RESEND_FROM_EMAIL` | From address of the reset e-mail | no / **yes in practice** | No | local `.env`; Render | none | **not validated.** `sendPasswordResetEmail` throws if this or the API key is unset | `src/lib/email.ts` |
| `GITHUB_RELEASE_REPO` | `owner/name` whose latest GitHub Release carries `version.json` (Android in-app update check) | no / no | No | local `.env`; Render | none; unset makes `/api/app-version` answer 503 `not_configured` | checkConfig: **warning** if set and not `owner/name` | `src/app/api/app-version/route.ts`, `src/lib/config-check.ts` |
| `GITHUB_API_TOKEN` | Optional token that lifts GitHub's unauthenticated rate limit on that check | no / no | **Yes** | local `.env`; Render. Whether it is set and its scopes: UNVERIFIED | none | **not validated** | `src/app/api/app-version/route.ts` |
| `LOG_LEVEL` | Minimum log level: `debug`, `info`, `warn`, `error` | no / no | No | local `.env`; Render | `info`; an unknown value also gives `info` | **not validated** | `src/lib/logger.ts` |
| `GROQ_API_KEY` | Groq key for the assistant: one key covers both the reasoning model and Whisper speech-to-text. **Server-side only** — it must never reach browser code, a generated manifest or a log | no / no | **Yes** | local `.env`; Render | none; unset makes the assistant answer that it is not set up, and the rest of the app is unaffected | **not validated** | `src/lib/agent/groq.ts`, `src/app/api/agent/listen/route.ts` |
| `GROQ_MODEL` | Overrides the reasoning model the assistant uses. It exists because which models an account can reach varies and changes: a name that works today can 404 tomorrow, and that failure is indistinguishable from a network blip without the upstream detail logged (`groq.request_failed`) | no / no | No | local `.env`; Render | `qwen/qwen3.8-27b` | **not validated**; a wrong name fails at the first request | `src/lib/agent/groq.ts` |

## 2. Rotation and exposure

| Variable | Rotation | Exposure |
|---|---|---|
| `DATABASE_URL` | Change the role's password in Supabase, update Render, redeploy ([runbook-recovery.md](runbook-recovery.md) scenario F). Whether this was ever rotated: UNVERIFIED. [assurance.md](assurance.md) records a database credential pasted into a chat as awaiting rotation (owner action) | Anyone with Render env access or the connection string bypasses every application control, including the audit trigger ([assurance.md](assurance.md)). Readiness answers only ok/failed per check; `tests/unit/health-and-headers.test.ts` asserts a secret marker never appears in the response |
| `MIGRATE_DATABASE_URL` | As above, for the schema-owner role | If set as a service-level Render variable it is also present in the running app's process environment, although the app never reads it (inference from `prisma.config.ts` and `db.ts`) |
| `SHADOW_DATABASE_URL` | Dev and CI scratch database only; rotate if the host is shared | Low: no production data. Keep it off the production database |
| `AUTH_SECRET` | Section 8. Roll it with `AUTH_SECRET_PREVIOUS` (no sign-out), or replace it outright (signs everyone out) | A leak lets an attacker mint session cookies. Every request still re-checks the account and its `tokenVersion` in the database ([ADR-0004](adr/0004-csrf-and-session-strategy.md)), which limits but does not remove the impact. Support sessions do not use it |
| `JOIN_CODE_SECRET` | Single key, no rolling mechanism (section 8.5). Rotating it makes every pending join request unapprovable | Codes are 6 digits: whoever holds the key and a stored hash can recover a code offline (10^6 candidates), which is why the hash is keyed |
| `SUPPORT_ACCESS_PASSWORD` | Change the variable. Existing support sessions are DB-backed, last at most 1 hour and are not ended by the change ([operations.md](operations.md)). Rotate when anyone who knew it leaves | One shared password opens every business. Login is limited to 3 attempts per 15 minutes per IP and 30 failed attempts per day platform-wide (comment in `support/login/route.ts`); use is audited with a written reason. Never logged |
| `APP_URL`, `ALLOWED_ORIGINS`, `GITHUB_RELEASE_REPO`, `RESEND_FROM_EMAIL`, `DB_POOL_MAX`, `LOG_LEVEL` | Nothing to rotate. A change needs a restart | Not secret. A wrong `APP_URL` or `ALLOWED_ORIGINS` blocks the app's own state-changing requests (CSRF check) |
| `TRUSTED_PROXY_HOPS` | Nothing to rotate; revisit when a proxy or CDN is added in front of Render | A value that does not match the real chain makes the per-IP rate-limit key either spoofable or shared by everyone ([security.md](security.md) section 3). Render's real hop count: UNVERIFIED |
| `RESEND_API_KEY` | Create a new key in Resend, update Render, redeploy, revoke the old key. Resend account details: UNVERIFIED | Sent only as a bearer header to `api.resend.com`; log fields whose key matches `api-key`, `secret`, `token`, etc. are redacted (`src/lib/logger.ts`) |
| `GITHUB_API_TOKEN` | Create a new token in GitHub, update Render, revoke the old one. Scope UNVERIFIED; the code only reads releases | Sent as a bearer header only on the call to `api.github.com`, not on the asset download |

## 3. Set by tooling, CI, release and tests

| Variable | Purpose and where it is set | Read by |
|---|---|---|
| `NODE_ENV` | The app treats exactly `production` as production: checkConfig's production rules, `SameSite=None; Secure` session cookie, HSTS and CSP headers, short stack traces, `appUrl()` throwing. Expected to be set by the Next.js tooling (`next dev` / `next build` / `next start`) rather than by hand; Render's actual value is UNVERIFIED. If it is not exactly `production` on Render, none of those production behaviours apply. Not validated | `src/lib/config.ts`, `src/lib/db.ts`, `src/lib/auth.ts`, `src/lib/logger.ts`, `next.config.ts`, `scripts/check-config.mjs` |
| `NEXT_RUNTIME` | Set by Next.js; the startup validation runs only when it is `nodejs` | `src/instrumentation.ts` |
| `BUILD_TARGET` | `android` selects the static-export build. Set only by `scripts/build-android.mjs`; never set by hand | `next.config.ts`, `scripts/build-android.mjs` |
| `PRISMA_MIGRATIONS_PATH` | Alternate migrations folder; default `prisma/migrations`. Set by `scripts/test-migrations.mjs` for its scenarios | `prisma.config.ts`, `scripts/test-migrations.mjs` |
| `TEST_DATABASE_URL` | Non-production database for DB-backed tests; overrides `DATABASE_URL` in tests when set. CI sets a literal pointing at its service container | `tests/setup.ts`, `scripts/test-migrations.mjs` |
| `DRILL_DATABASE_URL` | Target for the restore drill; falls back to `DATABASE_URL`. Optional, local only | `scripts/restore-drill.mjs` |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | **GitHub Actions secrets** (sensitive) for the signed APK. Passed by `env:` only to the decode step and the build step; the decoded keystore is deleted in an `always()` cleanup step. Whether they are set, who can read them: UNVERIFIED. Do not rotate casually: a new signing key is a new app identity for sideloaded updates ([runbook-recovery.md](runbook-recovery.md) scenario F) | `.github/workflows/release-android.yml`, `android/app/build.gradle` |
| `ANDROID_KEYSTORE_PATH` | Not secret. Set by the release workflow to the decoded keystore path; if empty, Gradle signs with the debug key | `android/app/build.gradle` |
| `GH_TOKEN` | Not a stored secret: the per-run `github.token`, used by `gh release create`. The workflow has `permissions: contents: write` | `.github/workflows/release-android.yml` |
| `GITHUB_REF_NAME`, `GITHUB_RUN_NUMBER` | GitHub built-ins used to derive the APK version name and code | `.github/workflows/release-android.yml` |
| `AUTH_SECRET` (CI), `APP_URL` (CI), `DATABASE_URL` (CI), `SHADOW_DATABASE_URL` (CI) | CI-only literals committed in `ci.yml`, pointing at a throwaway Postgres container. Not secrets; never reuse them elsewhere | `.github/workflows/ci.yml` |
| `NEXT_TELEMETRY_DISABLED` | `1` in `ci.yml`. Read by Next.js, not by repo code | `.github/workflows/ci.yml` |
| test defaults | `tests/setup.ts` defaults `AUTH_SECRET` (a test literal), `APP_URL`, `LOG_LEVEL=error`, `DB_POOL_MAX=6` when unset. Some tests set and restore `SUPPORT_ACCESS_PASSWORD`, `TRUSTED_PROXY_HOPS`, `GITHUB_RELEASE_REPO`, `LOG_LEVEL`, `TZ`; these are test manipulations of the variables above, not extra settings | `tests/**` |

## 4. Read by dependencies, not by repo code

`next-auth` 5.0.0-beta.32 and `@auth/core` 0.41.3 read further variables. None is set by the repo, none is checked by checkConfig, and whether any is set on Render is UNVERIFIED.

| Variable | Effect | Note |
|---|---|---|
| `NEXTAUTH_SECRET` | Fallback for `AUTH_SECRET` inside next-auth | Not seen by checkConfig: if only this were set, checkConfig would report `AUTH_SECRET` missing |
| `AUTH_SECRET_1` .. `AUTH_SECRET_3` | Extra keys for rolling rotation | **Ignored while `AUTH_SECRET` is set** (section 8.1) |
| `AUTH_URL`, `NEXTAUTH_URL` | If set, Auth.js rewrites the origin of every request it handles to this URL and may change its base path (`next-auth/lib/env.js`, `@auth/core/lib/utils/env.js`) | Leave unset unless there is a reason; a wrong value breaks sign-in |
| `AUTH_TRUST_HOST` | Would trust the proxy host header | No effect here: `trustHost: true` is set explicitly in `src/lib/auth.ts` |

## 5. Not validated by checkConfig

Setting any of these wrongly is not reported by startup, readiness or `check:config`.

| Variable | What happens if it is wrong |
|---|---|
| `RESEND_FROM_EMAIL` | Readiness stays green; reset e-mails fail at send time, are logged and not retried ([operations.md](operations.md) section 1) |
| `GITHUB_API_TOKEN` | A bad token makes the GitHub call fail; `/api/app-version` answers 502 `release_check_failed` and Android shows no update prompt |
| `LOG_LEVEL` | Falls back to `info` without a message |
| `MIGRATE_DATABASE_URL`, `SHADOW_DATABASE_URL` | Prisma CLI fails at migrate time (the deploy step) rather than at config time |
| `NODE_ENV` | See section 3: a non-production value silently switches off production behaviour |
| `APP_URL` in dev | Not checked; defaults to `http://localhost:3000` |
| `DB_POOL_MAX` above 12 | Clamped to 12 without a warning |
| `AUTH_SECRET` strength | Only length and a short placeholder list are checked, not randomness |
| `JOIN_CODE_SECRET` strength | Only "unset" and "equals `AUTH_SECRET`" are checked |
| `ALLOWED_ORIGINS` | Only the first bad entry is reported; `config.ts` drops bad entries silently |
| `DATABASE_URL` credentials | Only the scheme is checked; wrong credentials are caught by readiness, not by `check:config` |
| `NEXTAUTH_SECRET`, `AUTH_SECRET_*`, `AUTH_URL`, `NEXTAUTH_URL` | Section 4 |

## 6. Read by the code but missing from `.env.example`

`.env.example` is not edited by this document; the maintainer can add these.

| Variable | Suggested action |
|---|---|
| `DRILL_DATABASE_URL` | Add as an optional, commented entry (restore drill target; falls back to `DATABASE_URL`) |
| `PRISMA_MIGRATIONS_PATH` | Optional: internal to `scripts/test-migrations.mjs`; a one-line comment is enough |
| `NODE_ENV`, `NEXT_RUNTIME`, `BUILD_TARGET` | Intentionally absent (set by tooling). Consider a comment that they must not be set by hand |
| `ANDROID_KEYSTORE_*`, `ANDROID_KEY_*` | GitHub Actions secrets, not `.env` values; a pointer to this document is enough |
| `NEXT_TELEMETRY_DISABLED` | Optional |
| `AUTH_SECRET_1..3`, `NEXTAUTH_*`, `AUTH_URL` | Do not add values; a comment that they are ignored or unwanted (sections 4 and 8) avoids confusion |

Every variable that `.env.example` does list is read by the code.

## 7. Critical configuration errors do not fail the deploy

What happens today (from `src/instrumentation.ts`, `src/app/api/health/ready/route.ts`, [security.md](security.md) section 12):

| Where | Effect of a critical error (missing or malformed `DATABASE_URL`, bad `AUTH_SECRET`, production without an https `APP_URL`) |
|---|---|
| Process start | One structured `startup: configuration is invalid` error log. The process keeps running (a crash loop would hide the reason and take the liveness probe down: deliberate) |
| `/api/health/ready` | 503 `config: failed`. Useful only if an uptime monitor watches it; setting one up is UNVERIFIED |
| Render health check | The documented Health Check Path is `/api/health`, which is liveness and does not run checkConfig ([ci-cd.md](ci-cd.md); the Render setting itself is UNVERIFIED). A bad configuration therefore does not fail the health check or the deploy |
| CI | `ci.yml` does not run `check:config`; it only sets literals so tests and the build work. The unit tests call checkConfig with explicit inputs, never against a real environment |

**What would change that.** `scripts/check-config.mjs` exists and `package.json` defines `npm run check:config` (`node --experimental-strip-types scripts/check-config.mjs`); `tests/unit/check-config-script.test.ts` covers it. It runs the same validation and exits non-zero on an error (on warnings too with `--strict`). Using it as a gate is the recommendation in the script's own header:

* Render pre-deploy command: `npx prisma migrate deploy && npm run check:config -- --production`. A failing pre-deploy keeps the previous release serving (the same behaviour [ci-cd.md](ci-cd.md) relies on for failed migrations).
* **Whether this is configured on Render: UNVERIFIED.** [architecture.md](architecture.md) and [ci-cd.md](ci-cd.md) still describe the pre-deploy command as `npx prisma migrate deploy` only; update them if the owner adopts the new command.
* `--production` matters: a pre-deploy shell may not have `NODE_ENV=production`, and the https `APP_URL` and `JOIN_CODE_SECRET` rules apply only in production mode.
* The script needs Node 22.6 or newer (type stripping). CI uses Node 22; Render's Node version is UNVERIFIED.
* `--strict` also fails on warnings such as an unset `RESEND_API_KEY` or `JOIN_CODE_SECRET`; decide deliberately.
* It does not catch present-but-wrong values the validator does not check (section 5).

## 8. Rotating `AUTH_SECRET` without logging everyone out

### 8.1 What the installed code does

Read from `node_modules`, not executed. `@auth/core` 0.41.3, `next-auth` 5.0.0-beta.32.

| Step | Source | Behaviour |
|---|---|---|
| Key list from env vars | `@auth/core/lib/utils/env.js` lines 28-38 | Only when `config.secret` is empty: the list starts as `[AUTH_SECRET]`, then `AUTH_SECRET_1`, `_2`, `_3` are each **unshifted** if set. The highest-numbered variable that is set ends up **first**; `AUTH_SECRET` ends up **last** |
| Signing | `@auth/core/jwt.js` `encode` | Encrypts with the **first** key only |
| Reading | `@auth/core/jwt.js` `decode` | Derives each key in the list and uses the one whose thumbprint matches the token's `kid` header; none matches means "no matching decryption secret" and the cookie is cleared |
| Refresh | `@auth/core/lib/actions/session.js` | Every successful session read re-encrypts the token with the first key and a fresh expiry, so active users move to the new key on their own |
| **next-auth wrapper** | `next-auth/lib/env.js` line 22 | Runs first: `config.secret ??= AUTH_SECRET ?? NEXTAUTH_SECRET`. That is a non-empty **string**, so core's `!config.secret?.length` test is false and the `AUTH_SECRET_1..3` branch **never runs** while `AUTH_SECRET` is set |
| This repo | `src/lib/auth.ts` | Passes `secret: authSecrets()` ([`src/lib/auth-secrets.ts`](../src/lib/auth-secrets.ts)): the plain string normally, or `[AUTH_SECRET, AUTH_SECRET_PREVIOUS]` during a rotation. An explicit array is left untouched by the next-auth wrapper (its `??=` only fills an unset secret) |

Consequences:

* **Rolling rotation through `AUTH_SECRET_1..3` does not work** with next-auth 5.0.0-beta.32: the branch is reachable only with `AUTH_SECRET` and `NEXTAUTH_SECRET` both unset, and checkConfig treats an unset `AUTH_SECRET` as an **error** (readiness 503, `check:config` fails). Those variables are ignored; do not set them. The repo supports rotation through `AUTH_SECRET_PREVIOUS` instead (section 8.2).
* If you ever drop the explicit array, remember the order is the reverse of the variable names: the **new** key would go in the higher-numbered `AUTH_SECRET_N` (first, signs) and the old key would stay lower or in `AUTH_SECRET`. The supported route is `AUTH_SECRET_PREVIOUS`, whose order cannot be got wrong: `AUTH_SECRET` always signs.
* **Without `AUTH_SECRET_PREVIOUS`:** replace `AUTH_SECRET`, redeploy; every session fails to decrypt and every user signs in again ([runbook-recovery.md](runbook-recovery.md) scenario F). Use this when the old key leaked.

### 8.2 Rolling rotation with `AUTH_SECRET_PREVIOUS` (implemented and tested)

`@auth/core` accepts an array (newest first) and the next-auth wrapper leaves an explicit array alone, so `src/lib/auth.ts` now passes `authSecrets()`. [`tests/auth/auth-secrets.test.ts`](../tests/auth/auth-secrets.test.ts) uses Auth.js's real `encode`/`decode` to prove: a cookie sealed under the old key still decodes while it is kept as previous; new cookies are sealed with the new key; after the previous key is removed old cookies stop working; a cookie sealed with an unrelated key is rejected throughout. Procedure:

| Step | Action |
|---|---|
| 0 | Set `JOIN_CODE_SECRET` first (section 8.5), otherwise this rotation also invalidates pending join requests |
| 1 | Generate a new value (32 random bytes: the command in `.env.example`) |
| 2 | In Render: set `AUTH_SECRET_PREVIOUS` to the current `AUTH_SECRET`, then set `AUTH_SECRET` to the new value; redeploy once |
| 3 | Existing sessions keep working and are re-signed with the new key on their next session read |
| 4 | After the session lifetime (30 days, `maxAge` in `src/lib/auth.ts`), remove `AUTH_SECRET_PREVIOUS` and redeploy. Sessions not used in 30 days have expired anyway |

Not verified: the effect on Auth.js's own CSRF cookie, which is hashed with the key list (`@auth/core/lib/actions/callback/oauth/csrf-token.js`), for a login form open at the moment of the switch. The app's own protection is the Origin check ([ADR-0004](adr/0004-csrf-and-session-strategy.md)).

### 8.3 Revoking the old key immediately

| Situation | Action |
|---|---|
| Key leaked | Do not use a rolling window: during it the old key still decrypts. Replace `AUTH_SECRET` and accept that everyone signs in again (section 8.1) |
| One account or device at risk | The owner's "Sign out of all devices" (or a password or PIN change) bumps `tokenVersion`, which every request checks against the database, so sessions end at once without touching the key ([ADR-0004](adr/0004-csrf-and-session-strategy.md)) |

### 8.4 What `AUTH_SECRET` does not protect

Support-console sessions are opaque DB-backed tokens (`src/lib/supportTokens.ts`) and do not depend on it. Join codes depend on it only when `JOIN_CODE_SECRET` is unset.

### 8.5 Operator join codes

| Fact | Source |
|---|---|
| Key is `JOIN_CODE_SECRET`, or `AUTH_SECRET` when that is unset | `hashJoinCode` in `src/lib/services/operators.ts` |
| One key, no list, and the stored hash carries no key id | same file (`joinCodeMatches` compares a bare hex digest) |
| Therefore **no rolling mechanism**: changing the key makes every pending request unapprovable | [security.md](security.md) section 14 |
| Pending requests live up to 7 days | `JOIN_REQUEST_TTL_MS` in `operators.ts` |

Procedure: set `JOIN_CODE_SECRET` once to a value different from `AUTH_SECRET` (checkConfig warns in production while it is unset or equal), so later `AUTH_SECRET` rotations do not touch join codes. To rotate `JOIN_CODE_SECRET` itself, pick a quiet moment, change it, decline the pending requests in the admin UI and ask the operators to file again. Setting `JOIN_CODE_SECRET` for the first time after codes were issued under `AUTH_SECRET` has the same one-time effect ([assurance.md](assurance.md) lists this as a pending owner action).

## 9. UNVERIFIED (owner to fill in)

| Item | Value |
|---|---|
| Variables actually set on Render, and which are marked secret there | UNVERIFIED |
| Render `NODE_ENV`, Node version, pre-deploy command, Health Check Path | UNVERIFIED |
| Whether `JOIN_CODE_SECRET`, `SUPPORT_ACCESS_PASSWORD`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `GITHUB_RELEASE_REPO`, `GITHUB_API_TOKEN`, `MIGRATE_DATABASE_URL` are set in production | UNVERIFIED |
| Whether `AUTH_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `AUTH_SECRET_*` are set on Render | UNVERIFIED |
| Render proxy hop count behind `TRUSTED_PROXY_HOPS` | UNVERIFIED |
| `GITHUB_API_TOKEN` scopes and expiry | UNVERIFIED |
| GitHub Actions secrets present (`ANDROID_*`) and who can read them | UNVERIFIED |
| Resend sending domain and key scope | UNVERIFIED |
| Last rotation date of each secret; who holds each | UNVERIFIED (no rotation log exists; see [operations.md](operations.md)) |
