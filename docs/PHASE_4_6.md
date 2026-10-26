# Phase 4.6 — Credits / billing (first slice)

**Result:** automated checks for this slice passed (`pnpm lint`, `pnpm typecheck`, `pnpm test` 147 passed / 23 files, `pnpm build`). Live OpenAI/Fal execution was **not** used to verify billing. Mock and database-backed tests exercise reservation, settlement, release, concurrency, and recovery. Do not treat that as a live provider PASS.

This slice meters the five asynchronous studio operations with integer credits. Convert, resize, and crop stay free and synchronous. There is no payment gateway, pack purchase, webhook, or admin grant API.

## Pricing (provisional defaults)

Costs live in `lib/billing/pricing.ts`. Route handlers and the worker do not hard-code prices. The server computes the charge from the trusted operation (and upscale factor). Client-supplied cost, balance, or user id is ignored.

| Operation | Credits |
| --- | ---: |
| GENERATE | 10 |
| EDIT | 10 |
| IMAGE_TO_IMAGE | 10 |
| REMOVE_BACKGROUND | 6 |
| REMOVE_OBJECT | 6 |
| UPSCALE factor 2 | 8 |
| UPSCALE factor 3 | 12 |
| UPSCALE factor 4 | 16 |
| CONVERT / RESIZE / CROP | 0 |

Unsupported billable configurations throw `UNSUPPORTED_BILLABLE_CONFIGURATION` or `UNSUPPORTED_UPSCALE_FACTOR`. They never silently cost zero.

## Accounting model

Reserved credits leave `CreditAccount.availableCredits` immediately and sit in `reservedCredits` until settle or release.

| Event | availableCredits | reservedCredits | Ledger |
| --- | --- | --- | --- |
| reserve (job create) | −N | +N | `reserve` (hold, not a final charge) |
| settle (confirmed success) | unchanged | −N, `lifetimeConsumed` +N | `settle` (delta 0) |
| release (confirmed terminal failure) | +N | −N | `release` |
| grant (tests / future admin; no HTTP) | +N | unchanged | `grant` |

Ledger rows are append-only. Refunds are new `release` rows, never updates or deletes.

Existing users are backfilled to **zero** available credits. The free-plan `creditsGranted` seed value is not applied here.

## Reservation, job create, and the queue

`createQueuedBillableJob` in `lib/jobs/service.ts` runs one PostgreSQL transaction:

1. Lock `CreditAccount` (`SELECT … FOR UPDATE`)
2. Reject with `INSUFFICIENT_CREDITS` (402) if `availableCredits < cost`
3. Insert `CreditReservation` (`pending`) and a `reserve` ledger row
4. Insert `AIJob` (`queued`) linked by `reservationId`
5. Insert the queued `AIJobEvent`

BullMQ `enqueueJob` runs **after** commit. Redis is not part of the transaction. If enqueue throws:

- The API fails
- The job remains `queued` with a pending reservation
- Recovery is `processJob(jobId)` or a later `enqueueJob` with the same BullMQ `jobId`
- Credits are not released because publication failure is not a provider outcome

Tests skip the broker (`NODE_ENV=test`) and call `processJob` directly, which is the same recovery path.

## Worker settlement and release

`processJob` does not change provider retry policy (three attempts, retryable codes `TIMEOUT` / `PROVIDER_RATE_LIMITED` / `PROVIDER_UNAVAILABLE`).

- Confirmed success, including `reuseExistingOutput`, settles in the same transaction as marking `succeeded`.
- Confirmed terminal failure (validation, safety, `PROVIDER_REJECTED`, missing config, etc.) releases in the same transaction as marking `failed`.
- Retryable errors requeue and keep the hold.
- After the attempt cap, a retryable code still **keeps** the hold. The job row may be `failed`, but the reservation stays `pending` for reconciliation. This slice does not auto-refund ambiguous provider outcomes.
- If output exists and completion/settlement throws, the job is requeued without release. The next claim reuses `sourceJobId` and settles once.
- `processJob` on an already `succeeded` job settles idempotently (crash after success, before settlement).
- Duplicate settle/release/worker execution is constrained by reservation status CAS plus unique ledger keys (`reserve:{jobId}`, `settle:{reservationId}`, `release:{reservationId}`).

## HTTP

Authenticated, owner-scoped, read-only. Mutations for purchases or grants are out of scope.

`GET /api/credits`

```json
{ "availableCredits": 15, "reservedCredits": 10 }
```

`GET /api/credits/ledger?limit=20&cursor=<id>`

```json
{
  "entries": [
    {
      "id": "…",
      "type": "reserve",
      "amount": 10,
      "delta": -10,
      "balanceAfter": 15,
      "jobId": "…",
      "reservationId": "…",
      "createdAt": "2026-10-17T00:00:00.000Z"
    }
  ],
  "nextCursor": "…"
}
```

`limit` is 1–100 (default 20). Ordering is `createdAt DESC`, `id DESC`. A cursor that is not one of the caller’s rows is `VALIDATION`. A client `userId` query param is rejected. Unauthenticated requests are 401.

## Migration

Name: `20261017120000_phase46_credits`

```bash
# PostgreSQL required. DATABASE_URL from .env / .env.local
pnpm db:migrate
# or
pnpm prisma migrate deploy
```

Additive only. Existing users, jobs, and assets are preserved. New accounts get a zero `CreditAccount` from the Better Auth create hook; the migration backfills existing users to zero.

Do not run `prisma migrate reset` against a database with user data.

## Tests and commands

| Command | Purpose |
| --- | --- |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest, including database-backed billing tests |
| `pnpm build` | Production build |

Automated tests do not call live OpenAI or Fal. Timeouts and 429s are stubbed `fetch`.

## Known limitations / next slice

- No purchases, Midtrans, Stripe, webhooks, or plan grants.
- `grantCredits` is a server function for tests and future admin use; it has no HTTP route.
- Exhausted retryable provider outcomes keep a pending reservation until a later reconciliation tool or an operator settles/releases them.
- There is no scheduled re-enqueue sweep. Recover `queued` rows from PostgreSQL as documented in `DEPLOYMENT.md`.
- Seed users start at zero credits.
