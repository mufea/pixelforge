# Implementation plan

Phase 0 is **PASS**. Decisions D1–D10 were approved on 14 October 2026. Phase 1 is **PASS**. A post-test code audit is in [POST_TEST_AUDIT.md](./POST_TEST_AUDIT.md). Phase 2 is **PASS**. Phase 3 is **PASS**, including a verified live OpenAI generate. Phase 4 is planning only — see [PHASE_4_PLAN.md](./PHASE_4_PLAN.md).

## Decisions (approved)

These are expensive to reverse. Implementation uses the **proposed** option.

| ID | Topic | Proposed | Alternatives |
| --- | --- | --- | --- |
| D1 | Repo shape | Single Next.js app + `worker/` sharing `lib/` | Turborepo packages |
| D2 | Auth | Better Auth + Prisma adapter | Auth.js v5 |
| D3 | Prisma major | Pin Prisma **7** (Better Auth adapter still needs Prisma Client; Prisma 8 is incompatible as of this audit) | Wait for adapter support |
| D4 | Credit settlement | Charge configured credits **only on job success**; release on failure/cancel | Charge on enqueue; charge provider-actual |
| D5 | Hosting | Docker Compose locally; Docker/VM/PaaS in production with a persistent worker | Next.js on Vercel **plus** a separate worker host |
| D6 | Indonesia payments | Midtrans **Snap** + server notification + Get Status | BI-SNAP Core API |
| D7 | First live AI | OpenAI Images API (`gpt-image-2.5-flare` / `sunburst`) in Phase 3 | Fal-first |
| D8 | Public API | Service layer in Phase 1–4; API keys and `/api/v1` only after studio jobs are stable | Ship keys in Phase 1 |
| D9 | Package manager | pnpm | npm |
| D10 | Credit unit | Integer credits (no floats). USD provider cost stored as integer micros | Decimal credits |

## Phase 0 — Audit and architecture

**Status: PASS (14 October 2026)**

Scope: inspect repo, document architecture, data model, providers, billing, security, env, plan. Do not generate the application.

Acceptance criteria: see [PHASE_0.md](./PHASE_0.md).

## Phase 1 — Foundation

**Status: PASS (14 October 2026)** — see [PHASE_1.md](./PHASE_1.md).

Scope:

- Scaffold Next.js (App Router, TypeScript strict, Tailwind, shadcn/ui, Lucide) on port `43127`
- Docker Compose: PostgreSQL, Redis, MinIO
- Prisma 7 schema for Better Auth + `UserProfile` + `AuditLog` + `SystemSetting`
- Better Auth: email/password, verify, reset, Google when configured, roles
- Public pages: landing, features, pricing (static from seed plans if DB up, else documented placeholders from seed file), tools directory, gallery shell, FAQ, terms, privacy, login, register
- Authenticated shell: dashboard home, profile
- Admin shell gated by role
- Health routes, pino logging, security headers, Zod env
- CI: lint, typecheck, unit tests
- Seed: admin user, plans stub, no fake generations

Out of scope: uploads, jobs, providers, payments.

Acceptance criteria:

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass
- `prisma migrate dev` applies on Compose Postgres
- Unauthenticated users cannot open `/app` or `/admin`
- Non-admin cannot open `/admin`
- Google button hidden when OAuth env is empty
- No provider keys in client bundles (`NEXT_PUBLIC_` audit)

Tests: registration, login, session, role guard, CSRF/cookie flags as applicable.

## Post-test audit (14 October 2026)

**Status: complete. Next phase not started.**

The 8 UI scenarios from the initial test report are consistent with Phase 1 code (auth, plans, admin counts, honest empty gallery). They do not demonstrate AI, uploads, credits, or payments.

Repository evidence:

- No `lib/ai` adapters, no Sharp, no S3 client, no BullMQ processors, no credit ledger, no payment webhooks.
- `GET /api/v1/generate` is 404 (no fabricated success path).
- Two in-scope defects were fixed during the audit: open redirect on login `next`, and auth-email JWT logging.

**Recommended next phase at audit time:** Phase 2. **Update 16 October 2026:** Phase 2 and Phase 3 are complete. Phase 4 has not started.

## Phase 2 — Projects and assets

**Status: PASS (15 October 2026)** — see [PHASE_2.md](./PHASE_2.md).

Scope: projects CRUD, presigned upload, magic-byte and dimension validation, EXIF strip, private download, quotas, ownership.

Acceptance criteria:

- User A cannot read User B's asset by ID
- Invalid files never become `Asset` rows; object is deleted
- Original filename is not used as a storage key
- Download URLs expire
- Empty/loading/error states on library pages

Tests: tenant isolation, MIME/signature rejection, oversized image, quota.

## Phase 3 — Image processing and first AI job

**Status: PASS (16 October 2026)** — converter, mock jobs, fail-closed generate when unconfigured, and live OpenAI generate after a server key was set. See [PHASE_3.md](./PHASE_3.md).

Scope:

- Sharp convert/resize/crop/compress (batch with limits)
- `AIJob` + BullMQ worker + status polling
- Mock provider for tests
- OpenAI adapter for `generate` when `OPENAI_API_KEY` is set; otherwise `PROVIDER_NOT_CONFIGURED`
- Generation history
- Per-user concurrency and job timeout
- Idempotent worker execution

Acceptance criteria:

- Converter reports original vs output bytes
- Jobs follow queued → processing → succeeded/failed
- Validation errors are not retried
- Worker crash does not duplicate output for the same job id
- No fake success images in live mode
- If OpenAI key is present in the environment, a documented smoke prompt may be run manually; automated CI uses mock only unless a secret is explicitly provided to CI (default: mock)

Tests: Sharp conversion, job transitions, retry backoff, timeout mapping, mock adapter, OpenAI adapter unit tests with recorded fixtures (not live).

**Blocker rule:** if OpenAI cannot be reached, keep the adapter and tests, document the blocker, continue with Sharp + mock.

## Phase 4 — AI image studio

**Status: IN PROGRESS** — see [PHASE_4_PLAN.md](./PHASE_4_PLAN.md). Slice 4.1 PASS. Slice 4.5 PASS. Slice 4.2 PASS. Slice 4.3 PASS. Slice 4.4 PASS. Slice 4.6 is not started.

Scope: generator, editor (incl. mask when capable), background remover, upscaler, object remover, variations, product studio, marketing studio (Sharp text overlay), converter UI. Google + Fal adapters. Registry-driven model picker.

Acceptance criteria:

- Each tool refuses unsupported capabilities with a clear error
- Original assets preserved
- Transparent PNG preview for background removal
- Marketing overlay export PNG/JPEG is deterministic
- Admin disable of a model removes it from the picker without a frontend change
- Real provider calls only when keys exist; otherwise configured-missing UX

Tests: capability validation per adapter, Fal/Google timeout and 429 mapping, overlay composition.

## Phase 5 — Credits and payments

Scope: ledger, reservations, plans, packages, Stripe adapter, Midtrans Snap adapter, webhooks, billing UI, admin pricing.

Acceptance criteria:

- Job enqueue without credits fails
- Concurrent spends cannot overdraw
- Duplicate webhook does not double-grant
- Invalid signatures grant nothing
- Redirect-only payment does not grant
- Admin credit adjust writes audit + ledger

Tests: listed in the master prompt section 14 for credits/payments.

## Phase 6 — Admin and operations

Scope: admin dashboards (users, subs, credits, providers, jobs, usage, payments, settings), budgets, kill switch, audit log viewer, cost estimates labeled as estimates.

Acceptance criteria:

- All figures that are estimates are labeled
- Disabling a provider blocks new jobs
- Job retry from admin respects idempotency
- Non-admin 404/403 on admin APIs

## Phase 7 — Hardening and deployment

Scope: security review, regression suite, production build, Dockerfiles, backup/restore notes, load test of enqueue + credit lock (not a fake AI load), CSP verification.

Acceptance criteria:

- Production build clean
- Migrate deploy on empty database succeeds
- Secrets scanner clean
- README commands match reality

## External dependencies

| Dependency | Required from | Notes |
| --- | --- | --- |
| Node.js 22 + pnpm | Phase 1 | |
| PostgreSQL 16 | Phase 1 | |
| Redis 7 | Phase 3 (Compose in Phase 1) | |
| MinIO / S3 | Phase 2 | |
| Better Auth, Prisma 7 | Phase 1 | |
| Sharp | Phase 2 decode/EXIF strip; Phase 3 converter UI | |
| OpenAI API key | Phase 3 live generate | Optional; app remains usable with mock/not-configured |
| Fal key | Phase 4 specialized ops | Optional |
| Google AI key | Phase 4 alternate generate/edit | Optional |
| Stripe keys | Phase 5 | Optional per market |
| Midtrans keys | Phase 5 | Optional per market |
| Resend or SMTP | Phase 1 verify email in prod | Dev may log links |
| Google OAuth client | Phase 1 social login | Optional |

## Known risks

| Risk | Mitigation |
| --- | --- |
| Vendor model IDs change quickly (OpenAI already retired DALL·E 3) | Registry in DB; adapters isolated; docs dated |
| Provider cost runaway | Reserve credits, concurrency, daily USD budget, kill switch |
| Prisma 8 vs Better Auth | Pin Prisma 7; revisit later |
| Worker + serverless mismatch | Do not treat Vercel as the full production story |
| Dual payment providers | Shared Payment/WebhookEvent model; per-adapter verification |
| Image bombs | Sharp pixel/edge caps, size caps, streaming |
| Fake-success temptation in demos | Mock mode explicit; live mode errors when unconfigured |
| Fal/OpenAI result URL expiry | Always copy bytes into our bucket before succeeding the job |
| Credit lock contention | Row lock + version column; tests under concurrency |

## Reporting template (end of each later phase)

1. Completed work
2. Commands run and results (lint, typecheck, tests, migrate, build)
3. Known limitations
4. Unresolved blockers
5. PASS or FAIL against that phase's acceptance criteria
6. Do not start the next phase on FAIL
