# Phase 4.9 — Production readiness and live verification

**Result:** local readiness only. This slice did not provision Render, apply production migrations, change production secrets, merge PR #3, or run paid Fal/Stability smokes.

## 1. Release integrity

Verified on `cursor/fal-stability-render-c224` at the start of this slice:

| Item | Actual |
| --- | --- |
| Branch | `cursor/fal-stability-render-c224` tracking `origin/cursor/fal-stability-render-c224` |
| Starting HEAD | `df5b986` (Phase 4.8 docs). Working tree was clean. |
| Starting commit named in the prompt | `9b4d3f5` is an ancestor. Commits since then: `9f75dfd` credits, `fa0b3aa` Fal edit/i2i/ZIP, `7f97c98` Next.js 16.4.1, `df5b986` Phase 4.8 docs. |
| `main` | `97c7ea9` |
| PR #3 | Open, unmerged. Head `cursor/fal-stability-render-c224`, base `feat/phase-4-6-credit-billing`, merge-base `feb5cba`. |
| Next.js | `16.4.1` with React `19.3.1` |
| Credit cherry-pick | Present as `9f75dfd` (Phase 4.6 ledger recovered; original `be9932a` content). |

Provider model identifiers (unchanged):

| Operation | Fal | Stability |
| --- | --- | --- |
| GENERATE | `fal-ai/flux/schnell` | `stability-image-ultra` (`/v2beta/stable-image/generate/ultra`) |
| EDIT | `fal-ai/flux-kontext/dev` (no mask) | `stability-image-inpaint` |
| IMAGE_TO_IMAGE | `fal-ai/flux/dev/image-to-image` | — |
| REMOVE_BACKGROUND | `fal-ai/bria/background/remove` | `stability-remove-background` |
| REMOVE_OBJECT | `fal-ai/object-removal/mask` | `stability-erase` |
| UPSCALE | `fal-ai/flux-vision-upscaler` | `stability-upscale-fast` (4×) |

Credits remain integer reserved-then-settled with `FOR UPDATE`, `availableCredits >= cost` CAS, unique reservation per `jobId`, and idempotency keys `reserve:{jobId}`, `settle:{reservationId}`, `release:{reservationId}`, `grant:{key}`. ZIP export remains 50 files / 100 MiB with ownership checks.

Gaps found and fixed locally in this slice:

- `pnpm worker` imported `server-only` and could not start outside Next.js (observed in the Cloud start log). The worker now `--require`s `worker/register-server-only.cjs` and closes the BullMQ worker + Redis connection on SIGTERM/SIGINT.
- `Dockerfile.worker` did not set `NODE_ENV=production`.
- Provider success followed by a storage write failure released credits. Persist now maps those errors to `STORAGE_UNAVAILABLE` / `STORAGE_NOT_CONFIGURED`, which keep the hold (same D4 policy as timeouts). Prices are unchanged.

## 2. Configuration

See [ENV_MATRIX.md](./ENV_MATRIX.md). Payments are not required at startup. Health liveness returns `{ ok, service, timestamp }`. Readiness adds `postgres`, `redis`, and `storage` driver name only.

## 3. Preflight

`pnpm preflight` and `pnpm preflight --connect`. Unit tests live in `tests/unit/preflight.test.ts`. The command does not migrate, create cloud resources, or submit provider jobs.

## 4. Live smokes

Reviewed. Procedure: [LIVE_SMOKE.md](./LIVE_SMOKE.md). Not executed in this phase.

## 5. Credit safety tests added

- One reservation per job id; conflicting replay is `CONFLICT`
- Cancelled job reconciliation releases once
- Provider success + storage failure keeps the pending reservation through the attempt cap

Existing tests already covered duplicate settle/release, concurrent overspend, queue-publish failure, and crash recovery of settlement.

## 6. Render / payments

Runbook: [RENDER_RUNBOOK.md](./RENDER_RUNBOOK.md). Payments remain plan-only: [PAYMENTS_PLAN.md](./PAYMENTS_PLAN.md).

## 7. Local verification (this slice)

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS — 186 tests, 32 files (baseline was 172 / 29) |
| `pnpm test:live` without the live flag | 1 file / 5 tests **skipped** (exit 0). Not a live PASS. |
| `pnpm build` | PASS — Next.js 16.4.1 |
| `pnpm preflight` | PASS — config/artifact only |
| `pnpm preflight --connect` | PASS — local Postgres `SELECT 1`, Redis `PING` |
| `git diff --check` | PASS |
| Worker boot | Worker started with `queueAttached: true`; SIGTERM logged `Worker shutting down` and exited 0 |
| `GET /api/health` | `{ ok, service, timestamp }` |
| `GET /api/health/ready` | `{ ok, postgres: up, redis: up, storage: local, timestamp }` |

CI was not run in this environment. Live Fal/Stability were not executed. Render was not provisioned.

## 8. Outstanding risks

- Render services are not provisioned.
- Production migrations are not applied.
- External S3 is required for production and is unconfirmed.
- Live Fal/Stability have not been run.
- Stripe/Midtrans are not implemented; users cannot buy credits.
- Exhausted retryable failures leave a pending reservation until an operator reconciles them (documented).
