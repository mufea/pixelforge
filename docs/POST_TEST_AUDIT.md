# Post-test audit

**Date:** 14 October 2026  
**Scope:** Code, migrations, automated tests, production build, and live HTTP probes against the running app. The earlier 8-scenario UI report was treated as a hypothesis, not evidence.

**Overall:** Phase 1 foundation is real. The product described in the master prompt is not. Nothing in this repository generates, edits, stores, or bills for images.

## Verdict vs the 8 UI scenarios

Those scenarios exercised pages that exist and persist through PostgreSQL. They did **not** exercise AI, uploads, credits, or payments. Passing them does not mean PixelForge AI is an image studio.

| UI scenario | Code + HTTP evidence | Status |
| --- | --- | --- |
| Landing (dark navy, live plans) | `app/(marketing)/page.tsx` reads `Plan` via Prisma; `/` returns 200 | PASS |
| Public pages, real copy, gallery empty | Route files exist; gallery is an honest empty card | PASS |
| Login validation; no Google button | Zod + RHF; Google gated on both OAuth env vars | PASS |
| User login → `/app` | Better Auth + `UserProfile`; `/app` 307 without session, 200 with session | PASS |
| Profile save | `updateProfile` server action keys on `session.user.id` | PASS |
| Non-admin `/admin` | Layout calls `notFound()`; HTTP 404 | PASS |
| Admin dashboard counts | `prisma.user.count` / `plan.count` | PASS |
| Mobile menu | `SiteHeader` sheet; visually confirmed | PASS |

## Feature-by-feature implementation status

Statuses: **PASS**, **PARTIAL**, **FAIL**, **NOT VERIFIED**. FAIL here means the product requirement is not implemented, not that Phase 1 lied about it.

### Authentication and accounts

| Requirement | Status | Evidence |
| --- | --- | --- |
| Email/password register and login | PASS | `lib/auth/auth.ts`, `tests/integration/auth.test.ts`, HTTP `POST /api/auth/sign-in/email` |
| Sessions | PASS | `session` table; `Set-Cookie` is `HttpOnly; SameSite=Lax`; forged cookie cannot open `/app` (307 to login) |
| Role cannot be set from the browser | PASS | `additionalFields.role.input: false`; integration test supplies `role: "admin"` and stores `user` |
| Admin authorization | PASS | `app/(admin)/admin/layout.tsx` re-checks role; proxy cookie check is not treated as auth |
| Email verification | PARTIAL | Sent on sign-up; required only when `NODE_ENV=production`; no resend UI; delivery needs Resend/SMTP |
| Password reset | PARTIAL | Pages and Better Auth hooks exist; not covered by an HTTP test of a full token round-trip |
| Google OAuth | PARTIAL | Implemented, hidden when credentials are missing; live Google login is NOT VERIFIED |
| Rate limiting on auth | FAIL | No Redis limiter on `/api/auth/*` |
| CSRF | PARTIAL | Better Auth `trustedOrigins` + `SameSite=Lax`; no dedicated CSRF test |

### Database and persistence

| Requirement | Status | Evidence |
| --- | --- | --- |
| PostgreSQL + Prisma 7 | PASS | Migration `20261014140142_phase1_foundation`; `/api/health/ready` returns `postgres: "up"` |
| Users, sessions, profiles, plans | PASS | Schema + seed + live admin counts |
| Forward-only migrations | PASS | Single applied migration; not rewritten |
| `AuditLog` writes | FAIL | Table exists; no writer |
| Credit ledger / reservations | FAIL | Only `Plan.creditsGranted` (display). No `CreditAccount` |
| Projects, assets, jobs | FAIL | Not in `schema.prisma` |

### Assets, uploads, storage

| Requirement | Status | Evidence |
| --- | --- | --- |
| Upload validation | FAIL | No upload route, no magic-byte check, no Sharp |
| Object storage | FAIL | Compose defines MinIO; no S3 client, no presign, no `storageKey` |
| Asset ownership / IDOR tests | FAIL | No `Asset` model and no download handler to isolate |
| Downloads | FAIL | None |

Unconfigured storage does not produce fake files. There is simply no workflow.

### AI providers and processing

| Requirement | Status | Evidence |
| --- | --- | --- |
| Provider adapters (OpenAI / Gemini / Fal) | FAIL | No `lib/ai/`, no SDK calls, no model registry table |
| Mock vs live | PASS (for current code) | `AI_PROVIDER_MODE=mock` is rejected in production. There is no mock image generator in the app, and `GET /api/v1/generate` is 404 |
| Fabricated generation success | PASS | No generation endpoint exists to fake |
| Unconfigured provider error UX | NOT VERIFIED | No studio form to submit; cannot confirm user-facing `PROVIDER_NOT_CONFIGURED` |
| Background worker | PARTIAL | `worker/index.ts` heartbeats only. No BullMQ, no processors |
| Image conversion | FAIL | Sharp is not a dependency |

### Billing

| Requirement | Status | Evidence |
| --- | --- | --- |
| Credit reserve/settle | FAIL | No ledger |
| Stripe / Midtrans | FAIL | Env keys documented only |
| Webhook idempotency | FAIL | No webhook routes |

Pricing page amounts are seed data, explicitly not live checkout.

### API security

| Check | Status | Evidence |
| --- | --- | --- |
| Unauthenticated `/app` and `/admin` | PASS | 307 to `/login?next=…` |
| Forged session cookie | PASS | 307 to login (layout `getSession` fails) |
| `GET /api/auth/get-session` anonymous | PASS | `null` body, no user |
| Unknown `/api/v1/generate` | PASS | 404 |
| `POST /api/health` | PASS | 405 |
| Open redirect on `?next=` | PASS after fix | `safeInternalPath` rejects `https://…` and `//…` |
| Secrets in client bundle | PASS | No `NEXT_PUBLIC_` secret names; source-guard test |
| Provider keys in browser | PASS | Keys are server env only and unused |
| CSP | PARTIAL | Headers present; `script-src` allows `'unsafe-inline'` and `'unsafe-eval'` |
| `Secure` cookie flag | PARTIAL | Absent on HTTP localhost; expected until HTTPS |

### UI states

| State | Status | Notes |
| --- | --- | --- |
| Loading | PARTIAL | Skeletons on marketing + `/app`; many static pages have none |
| Empty | PARTIAL | Gallery and pricing-without-plans are honest; projects card is copy, not an empty list of rows |
| Error | PARTIAL | `app/error.tsx` exists; no retry UI for jobs (jobs do not exist) |
| Retry | FAIL | No job retry |

### Public API

FAIL. `PUBLIC_API_ENABLED` is parsed and unused. No `/api/v1` handlers, no API keys.

## Verified command results

Re-run during this audit (after the two in-scope fixes):

| Command | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | 16 passed (5 files) |
| `pnpm build` | Pass (Next.js 16.4.0) |
| `GET /api/health` | 200 `{ ok: true }` |
| `GET /api/health/ready` | 200 `{ postgres: "up" }` |

PostgreSQL 16 on `127.0.0.1:5432` was accepting connections. Redis responded to `PING` but is unused by application code.

## Critical security findings

| ID | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| A1 | Medium | Login `callbackURL` / `router.push` used raw `?next=`, allowing `https://` and `//` redirects | **Fixed** in this audit (`lib/security/paths.ts`) |
| A2 | Medium | Dev auth email logger wrote the full verify URL including JWT | **Fixed**; logs `to` + `kind` only; pino also redacts `url` |
| A3 | Low | Proxy only detects a session cookie; forged cookies still reach the layout | Acceptable: layouts call `getSession`. Do not treat proxy as authorization |
| A4 | Low | CSP includes `unsafe-eval` / `unsafe-inline` | Not changed; tightening can break Next.js. Track for Phase 7 |
| A5 | Low | `next-themes` injects a `<script>` (dev console: “Encountered a script tag while rendering React component”) | Cosmetic in development. Not rewritten |
| A6 | Info | Auth rate limiting absent | Expected Phase 1 gap; required before public registration at scale |
| A7 | Info | `AuditLog` is unused | No privileged credit/provider actions exist yet |

No evidence of client-side API keys, fake payment success, or fake AI success.

## Mock versus real provider integrations

There are **no** provider adapters and **no** mock image generator in the application runtime.

- `AI_PROVIDER_MODE` exists in `lib/env.ts`. Production refuses `mock`.
- Tests do not stub OpenAI/Fal/Google HTTP.
- Therefore: unconfigured providers cannot return a fabricated image, because nothing calls them.

Do not mark OpenAI, Gemini, or Fal as verified.

## Database and storage status

**Database:** Applied migration creates `user`, `session`, `account`, `verification`, `UserProfile`, `Plan`, `SystemSetting`, `AuditLog`. Seed writes plans, two settings, `admin@pixelforge.local`, and `user@pixelforge.local`. Profile updates persist.

**Storage:** Not implemented. `docker-compose.yml` includes MinIO for later phases. No buckets are used by the app.

**Redis:** Not used. Worker does not connect.

## Console warnings

| Warning | Severity | Action |
| --- | --- | --- |
| next-themes inline script during React render | Low | Leave; known ThemeProvider injection. `suppressHydrationWarning` is already on `<html>` |
| Vitest native config-loader warning for `vitest.config.ts` | Low | Noise; does not fail tests |
| React Fast Refresh / DevTools messages | Info | Dev only |

No application error overlay was observed during the UI pass.

## Missing backend (product, not Phase 1 regressions)

Must exist before any studio tool is called “working”:

1. Project + Asset + AssetVersion models, presigned upload, magic-byte and dimension checks, ownership on every read
2. BullMQ worker, `AIJob` state machine, no image bytes in Redis
3. Provider adapters with capability checks and `PROVIDER_NOT_CONFIGURED`
4. Credit reservation/settlement
5. Payment webhooks
6. Auth and upload rate limits
7. Audit writes for admin actions

## Missing tests (critical gaps)

Present: env parsing, role guards, source secret scan, register/login/role injection, cookie `HttpOnly`/`SameSite`, path sanitizer.

Absent and required before claiming later phases:

- HTTP non-admin `/admin` (currently layout-only + manual curl)
- Password reset token consumption
- Concurrent profile updates (low)
- Upload MIME/signature, quota, cross-tenant asset GET
- Job transitions, retry, credit overdraw
- Webhook signature + duplicate delivery

Phase 1 AC asked for CSRF/cookie tests: cookie flags are now asserted in `tests/integration/auth.test.ts`. CSRF token behavior is still not unit-tested.

## In-scope fixes applied during this audit

1. Sanitize post-login `next` / OAuth `callbackURL`.
2. Stop logging verification/reset URLs.
3. Assert session `Set-Cookie` flags in the auth integration test.

No Phase 2 features were added.

## Recommended next phase

**Phase 2 — Projects and assets**, as specified in `docs/IMPLEMENTATION_PLAN.md`.

Reasons from this repo:

- Phase 1 auth, RBAC, and Postgres persistence actually work.
- Image tools cannot be honest without owned, private blobs.
- Jumping to OpenAI generate without uploads/storage would recreate the demo trap this audit is meant to prevent.

Do not start Phase 2 until this audit is accepted. There is no remaining Phase 1 blocker that requires a rewrite.
